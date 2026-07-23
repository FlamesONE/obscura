//! HTML/CSS -> PNG rasterization for Obscura's Page.captureScreenshot.
//!
//! Obscura's own DOM (obscura-dom) is parse-only — no cascade/layout/paint.
//! This crate feeds Obscura's already-JS-executed HTML (serialized DOM) into
//! Blitz (Dioxus Labs' Stylo+Taffy HTML/CSS engine) for real CSS layout, then
//! rasterizes with anyrender's pure-CPU backend (no GPU needed on a headless
//! server) and encodes PNG directly. No JS runs inside Blitz — Obscura's V8
//! already executed all scripts; this stage is layout+paint only.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyrender::ImageRenderer as _;
use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::{BaseDocument, DocumentConfig};
use blitz_html::HtmlDocument;
use blitz_paint::paint_scene;
use blitz_traits::navigation::DummyNavigationProvider;
use blitz_traits::net::{Bytes, NetHandler, NetProvider, Request};
use blitz_traits::shell::{ColorScheme, Viewport};

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("PNG encode failed: {0}")]
    PngEncode(#[from] png::EncodingError),
}

/// Resolves every sub-resource fetch (external stylesheets, fonts, images)
/// immediately with empty bytes instead of leaving it pending forever.
///
/// Root cause this works around: Blitz treats certain resources (notably
/// `<link rel=stylesheet>`) as render-blocking — same as a real browser
/// delaying first paint until CSS loads. Real-world pages routinely ship
/// `<link rel=stylesheet>` alongside their critical inline `<style>` (Google's
/// homepage does), and Obscura has no net_provider wired up to actually fetch
/// them. `blitz_traits::net::DummyNetProvider` (the crate's own no-op) never
/// calls the handler at all, so the resource — and the whole document — stays
/// blocked in "pending" indefinitely, which rendered as a fully blank PNG
/// (confirmed by bisecting Google's captured HTML down to its `<link
/// rel=stylesheet>` tags). Since we're rendering an already-JS-executed HTML
/// snapshot, not live-navigating, the already-inlined `<style>` content is
/// normally what matters most anyway — an unresolved external stylesheet
/// degrading to empty is an acceptable tradeoff for "don't hang forever."
struct ImmediateEmptyNetProvider;

impl NetProvider for ImmediateEmptyNetProvider {
    fn fetch(&self, _doc_id: usize, request: Request, handler: Box<dyn NetHandler>) {
        handler.bytes(request.url.to_string(), Bytes::new());
    }
}

/// Rasterize `html` to a PNG image at `width`x`height` CSS pixels.
///
/// `base_url` resolves relative resource URLs (images, stylesheets); pass the
/// page's current URL. External resources (images, `<link rel=stylesheet>`,
/// fonts) resolve immediately to empty content via [`ImmediateEmptyNetProvider`]
/// rather than genuinely fetching — see its docs for why. Fonts still resolve
/// via the system font fallback (`system-fonts` feature, on by default).
/// Parse `html`, set the viewport and run Blitz's real Stylo+Taffy layout,
/// returning the laid-out document. Shared by [`render_html_to_png`] (which then
/// paints it) and [`layout_boxes`] (which reads its box tree).
fn build_laid_out_document(html: &str, base_url: &str, width: u32, height: u32) -> BaseDocument {
    let navigation_provider = Arc::new(DummyNavigationProvider);
    let net_provider = Arc::new(ImmediateEmptyNetProvider);

    let document = HtmlDocument::from_html(
        html,
        DocumentConfig {
            base_url: Some(base_url.to_string()),
            navigation_provider: Some(navigation_provider),
            net_provider: Some(net_provider),
            ..Default::default()
        },
    );

    let mut base_document: BaseDocument = document.into();

    let viewport = Viewport::new(width, height, 1.0, ColorScheme::Light);
    base_document.set_viewport(viewport);
    base_document.resolve(0.0);

    // Drain any resources (images/fonts) queued during the initial parse —
    // bounded so a hung fetch can't stall the CDP response forever.
    let deadline = Instant::now() + Duration::from_millis(500);
    while base_document.has_pending_critical_resources() && Instant::now() < deadline {
        base_document.resolve(0.0);
    }

    base_document
}

pub fn render_html_to_png(
    html: &str,
    base_url: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, RenderError> {
    let mut base_document = build_laid_out_document(html, base_url, width, height);

    let mut renderer = VelloCpuImageRenderer::new(width, height);
    let mut buf = Vec::with_capacity((width * height * 4) as usize);
    renderer.render_to_vec(
        |scene| {
            paint_scene(scene, &mut base_document, 1.0, width, height, 0, 0);
        },
        &mut buf,
    );

    encode_png(&buf, width, height)
}

/// Run Blitz layout on `html` and return the absolute box of every element that
/// carries a `data-onid="<u32>"` attribute (emitted by
/// `DomTree::outer_html_tagged`), as `(onid, x, y, width, height)` in CSS
/// pixels. Absolute position is a DFS from the root element accumulating each
/// node's Taffy `final_layout.location` (relative to its parent's box) onto the
/// parent's absolute origin. Elements not laid out (display:none) are simply
/// absent from the result.
pub fn layout_boxes(
    html: &str,
    base_url: &str,
    width: u32,
    height: u32,
) -> Vec<(u32, f32, f32, f32, f32)> {
    let doc = build_laid_out_document(html, base_url, width, height);
    let onid_name = blitz_dom::LocalName::from("data-onid");

    let mut out = Vec::new();
    // (node_id, parent_abs_x, parent_abs_y)
    let mut stack = vec![(doc.root_element().id, 0.0f32, 0.0f32)];
    while let Some((id, px, py)) = stack.pop() {
        let node = match doc.get_node(id) {
            Some(n) => n,
            None => continue,
        };
        let abs_x = px + node.final_layout.location.x;
        let abs_y = py + node.final_layout.location.y;

        if node.is_element() {
            if let Some(onid) = node.attr(onid_name.clone()).and_then(|v| v.parse::<u32>().ok()) {
                out.push((
                    onid,
                    abs_x,
                    abs_y,
                    node.final_layout.size.width,
                    node.final_layout.size.height,
                ));
            }
        }

        for &child in &node.children {
            stack.push((child, abs_x, abs_y));
        }
    }
    out
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, RenderError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(rgba)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decode PNG bytes and report whether any pixel has non-zero alpha.
    fn has_visible_content(png_bytes: &[u8]) -> bool {
        let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
        let mut reader = decoder.read_info().expect("valid PNG");
        let mut buf = vec![0u8; reader.output_buffer_size().expect("valid PNG size")];
        reader.next_frame(&mut buf).expect("decodable frame");
        buf.chunks_exact(4).any(|px| px[3] != 0)
    }

    #[test]
    fn layout_boxes_returns_real_geometry_for_tagged_element() {
        let html = r#"<html><body style="margin:0"><div data-onid="7" style="position:absolute;left:50px;top:30px;width:100px;height:20px"></div></body></html>"#;
        let boxes = layout_boxes(html, "https://example.com/", 1280, 720);
        let (_, x, y, w, h) = boxes
            .into_iter()
            .find(|(onid, ..)| *onid == 7)
            .expect("onid 7 must be laid out");
        let approx = |a: f32, b: f32| (a - b).abs() < 2.0;
        assert!(approx(x, 50.0), "x={x}");
        assert!(approx(y, 30.0), "y={y}");
        assert!(approx(w, 100.0), "w={w}");
        assert!(approx(h, 20.0), "h={h}");
    }

    #[test]
    fn renders_simple_styled_html() {
        let html = "<body style='background:white'><h1 style='color:blue'>Hi</h1></body>";
        let png = render_html_to_png(html, "https://example.com/", 200, 100).unwrap();
        assert!(has_visible_content(&png), "simple styled page must not render blank");
    }

    /// Regression: a `<link rel=stylesheet>` pointing at a URL that can
    /// never resolve (no net_provider does real fetching) used to leave the
    /// whole document's critical-resource state permanently "pending",
    /// which blitz-dom treats as render-blocking — painting a fully
    /// transparent buffer instead of the page's actual content. Found by
    /// bisecting Google's homepage HTML down to its `<link rel=stylesheet>`
    /// tags. ImmediateEmptyNetProvider fixes it by completing every fetch
    /// synchronously with empty bytes.
    #[test]
    fn external_stylesheet_link_does_not_block_rendering() {
        let html = concat!(
            "<html><head>",
            "<link rel=\"stylesheet\" href=\"https://unreachable.invalid/never-loads.css\">",
            "</head><body style='background:white'><h1 style='color:blue'>Hi</h1></body></html>",
        );
        let png = render_html_to_png(html, "https://example.com/", 200, 100).unwrap();
        assert!(
            has_visible_content(&png),
            "an unresolvable external stylesheet must not block the whole page from rendering"
        );
    }
}

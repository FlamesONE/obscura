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
pub fn render_html_to_png(
    html: &str,
    base_url: &str,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, RenderError> {
    let navigation_provider = Arc::new(DummyNavigationProvider);
    let net_provider = Arc::new(ImmediateEmptyNetProvider);

    let mut document = HtmlDocument::from_html(
        html,
        DocumentConfig {
            base_url: Some(base_url.to_string()),
            navigation_provider: Some(navigation_provider),
            net_provider: Some(net_provider),
            ..Default::default()
        },
    );

    let viewport = Viewport::new(width, height, 1.0, ColorScheme::Light);
    document.as_mut().set_viewport(viewport);
    document.as_mut().resolve(0.0);

    // Drain any resources (images/fonts) queued during the initial parse —
    // bounded so a hung fetch can't stall the CDP response forever.
    let deadline = Instant::now() + Duration::from_millis(500);
    while document.as_ref().has_pending_critical_resources() && Instant::now() < deadline {
        document.as_mut().resolve(0.0);
    }

    let mut base_document: BaseDocument = document.into();

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

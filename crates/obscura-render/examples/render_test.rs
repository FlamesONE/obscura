fn main() {
    let html = r#"<html><body style="background:white">
        <h1 style="color:blue">Hello Obscura</h1>
        <p>Rust-native rendering, no Chromium.</p>
    </body></html>"#;

    let png = obscura_render::render_html_to_png(html, "https://example.com/", 800, 400)
        .expect("render failed");

    std::fs::write("/tmp/obscura_render_test.png", &png).unwrap();
    println!("PNG written: {} bytes", png.len());
}

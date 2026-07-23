    use super::{truncate_on_char_boundary, url_matches_cdp_pattern, BrowserContext, LifecycleState, Page};
    use std::sync::Arc;
    use url::Url;

    #[test]
    fn truncate_never_splits_a_multibyte_char() {
        // A caller-supplied expression whose byte 80 lands inside a multi-byte
        // char would make `&expression[..80]` panic; the helper truncates safely.
        let s = format!("{}€tail", "a".repeat(79));
        assert!(!s.is_char_boundary(80), "setup: byte 80 splits the € char");
        let t = truncate_on_char_boundary(&s, 80);
        assert!(s.starts_with(t));
        assert_eq!(t.len(), 79, "should stop right before the € char");
        assert_eq!(truncate_on_char_boundary("short", 80), "short");
    }

    #[test]
    fn url_matches_cdp_pattern_handles_wildcards_across_url_parts() {
        assert!(url_matches_cdp_pattern(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTcviYwYZ8UA3.woff2",
        ));
        assert!(url_matches_cdp_pattern(
            "*://*.google.com/maps/vt/*",
            "https://www.google.com/maps/vt/pb=!1m4!1m3",
        ));
        assert!(url_matches_cdp_pattern(
            "https://example.com/assets/*",
            "https://example.com/assets/app.js",
        ));
        assert!(!url_matches_cdp_pattern(
            "https://example.com/assets/*",
            "https://cdn.example.com/assets/app.js",
        ));
        assert!(!url_matches_cdp_pattern(
            "*://*.gstatic.com/*.woff2",
            "https://fonts.gstatic.com/s/inter/v18/font.woff",
        ));
    }

    #[test]
    fn rebuild_root_child_frames_registers_iframes_with_resolved_urls() {
        let context = Arc::new(BrowserContext::new("test".to_string()));
        let mut page = Page::new("page-1".to_string(), context);
        page.url = Some(Url::parse("https://example.com/root/index.html").unwrap());
        page.dom = Some(obscura_dom::parse_html(
            r#"<!DOCTYPE html><html><body>
                <iframe name="same" src="/child"></iframe>
                <iframe src="https://other.example/frame"></iframe>
                <iframe src="about:blank"></iframe>
            </body></html>"#,
        ));

        page.rebuild_root_child_frames();

        let children = page.child_frames(&page.frame_id);
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].name.as_deref(), Some("same"));
        assert_eq!(
            children[0].url.as_ref().map(|u| u.as_str()),
            Some("https://example.com/child")
        );
        assert_eq!(
            children[1].url.as_ref().map(|u| u.as_str()),
            Some("https://other.example/frame")
        );
        let root_dom = page.dom.as_ref().expect("root dom present");
        let iframe_ids = root_dom.query_selector_all("iframe[src]").unwrap();
        let tagged = root_dom
            .with_node(iframe_ids[0], |node| node.get_attribute("data-obscura-frame-id").map(|s| s.to_string()))
            .flatten();
        assert!(tagged.is_some(), "iframe should be tagged with frame id");
    }

    #[tokio::test]
    async fn load_child_frames_populates_dom_and_lifecycle_for_data_iframe() {
        let context = Arc::new(BrowserContext::new("test".to_string()));
        let mut page = Page::new("page-1".to_string(), context);
        page.url = Some(Url::parse("https://example.com/root/index.html").unwrap());
        page.dom = Some(obscura_dom::parse_html(
            r#"<!DOCTYPE html><html><body>
                <iframe name="child" src="data:text/html,<html><head><title>Child</title></head><body><p id='x'>ok</p></body></html>"></iframe>
            </body></html>"#,
        ));

        page.rebuild_root_child_frames();
        page.load_child_frames().await;

        let children = page.child_frames(&page.frame_id);
        assert_eq!(children.len(), 1);
        let child = children[0];
        assert!(child.dom.is_some() || child.js.is_some(), "child frame dom/runtime should load");
        assert_eq!(child.title, "Child");
        assert!(matches!(child.lifecycle, LifecycleState::Loaded));
        let child_dom_text = if let Some(js) = child.js.as_ref() {
            js.with_dom(|dom| {
                let pid = dom.query_selector("#x").unwrap().expect("paragraph exists");
                dom.text_content(pid)
            }).unwrap_or_default()
        } else {
            let child_dom = child.dom.as_ref().expect("child dom present");
            let pid = child_dom.query_selector("#x").unwrap().expect("paragraph exists");
            child_dom.text_content(pid)
        };
        assert_eq!(child_dom_text, "ok");
    }

    #[tokio::test]
    async fn root_runtime_receives_same_origin_child_frame_snapshot() {
        let context = Arc::new(BrowserContext::new("test".to_string()));
        let mut page = Page::new("page-1".to_string(), context);
        page.url = Some(Url::parse("https://example.com/root/index.html").unwrap());
        page.dom = Some(obscura_dom::parse_html(
            r#"<!DOCTYPE html><html><body>
                <iframe name="child" src="data:text/html,<html><head><title>Child</title></head><body><p id='x'>ok</p></body></html>"></iframe>
            </body></html>"#,
        ));

        page.rebuild_root_child_frames();
        page.load_child_frames().await;
        page.init_js();

        let result = page.evaluate("(() => { const f = document.querySelector('iframe'); return [!!f.contentDocument, f.contentDocument && f.contentDocument.querySelector('#x') && f.contentDocument.querySelector('#x').textContent, !!f.contentWindow]; })()");
        assert_eq!(result, serde_json::json!([true, "ok", true]));
    }

    #[tokio::test]
    async fn load_child_frames_promotes_same_origin_iframe_to_live_runtime() {
        let context = Arc::new(BrowserContext::new("test".to_string()));
        let mut page = Page::new("page-1".to_string(), context);
        page.url = Some(Url::parse("https://example.com/root/index.html").unwrap());
        page.dom = Some(obscura_dom::parse_html(
            r#"<!DOCTYPE html><html><body>
                <iframe name="child" src="data:text/html,<html><head><title>Child</title></head><body><script>window.answer = 42;</script><p id='x'>ok</p></body></html>"></iframe>
            </body></html>"#,
        ));

        page.rebuild_root_child_frames();
        page.load_child_frames().await;

        let child_id = page.child_frames(&page.frame_id).into_iter().next().expect("child frame").frame_id.clone();
        let child = page.frame_mut(&child_id).expect("child frame by id");
        let js = child.js.as_mut().expect("same-origin child should have runtime");
        let answer = js.evaluate("window.answer").expect("script should run");
        assert_eq!(answer, serde_json::json!(42.0));
        let child_text = js.with_dom(|dom| {
            let pid = dom.query_selector("#x").unwrap().expect("paragraph exists");
            dom.text_content(pid)
        }).unwrap();
        assert_eq!(child_text, "ok");
    }

    #[tokio::test]
    async fn suspend_js_drops_child_runtime_but_preserves_dom_snapshot() {
        let context = Arc::new(BrowserContext::new("test".to_string()));
        let mut page = Page::new("page-1".to_string(), context);
        page.url = Some(Url::parse("https://example.com/root/index.html").unwrap());
        page.dom = Some(obscura_dom::parse_html(
            r#"<!DOCTYPE html><html><body>
                <iframe name="child" src="data:text/html,<html><head><title>Child</title></head><body><script>window.answer = 42;</script><p id='x'>ok</p></body></html>"></iframe>
            </body></html>"#,
        ));

        page.rebuild_root_child_frames();
        page.load_child_frames().await;
        page.init_js();
        page.suspend_js();

        assert!(page.js.is_none(), "root runtime should be gone");
        let child = page.child_frames(&page.frame_id).into_iter().next().expect("child frame");
        assert!(child.js.is_none(), "child runtime should be gone");
        let child_dom = child.dom.as_ref().expect("child dom snapshot should survive suspend");
        let pid = child_dom.query_selector("#x").unwrap().expect("paragraph exists");
        assert_eq!(child_dom.text_content(pid), "ok");
    }

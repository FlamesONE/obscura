use obscura_browser::Page;

pub(crate) fn dump_cookies(page: &Page) -> String {
    let cookies = page.context.cookie_jar.get_all_cookies();
    serde_json::to_string_pretty(&cookies).unwrap_or_else(|_| "[]".to_string())
}

pub(crate) fn dump_html(page: &Page) -> String {
    page.with_dom(|dom| {
        if let Ok(Some(html_node)) = dom.query_selector("html") {
            let html = dom.outer_html(html_node);
            format!("<!DOCTYPE html>\n{}", html)
        } else {
            let doc = dom.document();
            dom.inner_html(doc)
        }
    }).unwrap_or_default()
}

pub(crate) fn dump_text(page: &mut Page) -> String {
    page.with_dom(|dom| {
        if let Ok(Some(body)) = dom.query_selector("body") {
            let text = extract_readable_text(dom, body);
            text.trim().to_string()
        } else {
            String::new()
        }
    }).unwrap_or_default()
}

pub(crate) fn dump_markdown(page: &mut Page) -> String {
    let result = page.evaluate(obscura_browser::HTML_TO_MARKDOWN_JS);
    result.as_str().unwrap_or_default().to_string()
}

pub(crate) fn extract_readable_text(dom: &obscura_dom::DomTree, node_id: obscura_dom::NodeId) -> String {
    use obscura_dom::NodeData;

    // Iterative DFS over an explicit work stack. A recursive walk overflowed the
    // call stack (a hard abort, not a catchable panic) on deeply nested pages,
    // taking down the process on `--dump text` (issue #362, the CLI counterpart
    // of the serialize/textContent paths made iterative in obscura-dom). A
    // `Newline` work item emits a block element's trailing newline after its
    // children, matching the old pre/post-recursion output exactly.
    enum Work {
        Visit(obscura_dom::NodeId),
        Newline,
    }

    // Defense-in-depth cap mirroring DomTree::descendants; never reached on a
    // valid tree since append_child / insert_before reject cycles.
    const MAX_NODES: usize = 5_000_000;

    let mut result = String::new();
    let mut stack: Vec<Work> = vec![Work::Visit(node_id)];
    let mut visited = 0usize;

    while let Some(work) = stack.pop() {
        let id = match work {
            Work::Newline => {
                result.push('\n');
                continue;
            }
            Work::Visit(id) => id,
        };

        visited += 1;
        if visited > MAX_NODES {
            break;
        }

        let node = match dom.get_node(id) {
            Some(n) => n,
            None => continue,
        };

        match &node.data {
            NodeData::Text { contents } => {
                let trimmed = contents.trim();
                if !trimmed.is_empty() {
                    result.push_str(trimmed);
                }
            }
            NodeData::Element { name, .. } => {
                let tag = name.local.as_ref();

                // Boilerplate elements rarely contain content the user wants to
                // scrape — strip them so `--dump text` returns the article body
                // instead of menus, footers, and cookie banners.
                if matches!(tag, "script" | "style" | "nav" | "header" | "footer" | "aside") {
                    continue;
                }

                let is_block = matches!(
                    tag,
                    "div" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                        | "li" | "tr" | "br" | "hr" | "blockquote" | "pre"
                        | "section" | "article" | "header" | "footer" | "nav"
                        | "main" | "aside" | "figure" | "figcaption" | "table"
                        | "thead" | "tbody" | "tfoot" | "dl" | "dt" | "dd"
                        | "ul" | "ol"
                );

                if is_block {
                    result.push('\n');
                    // Processed after all children (stack is LIFO): the trailing newline.
                    stack.push(Work::Newline);
                }
                // Push children in reverse so they pop in document order.
                for child_id in dom.children(id).into_iter().rev() {
                    stack.push(Work::Visit(child_id));
                }
            }
            _ => {
                for child_id in dom.children(id).into_iter().rev() {
                    stack.push(Work::Visit(child_id));
                }
            }
        }
    }

    result
}

pub(crate) fn dump_links(page: &Page) -> String {
    let base_url = page.url.clone();
    page.with_dom(|dom| {
        let mut rendered = Vec::new();
        let links = dom.query_selector_all("a").unwrap_or_default();
        for link_id in links {
            if let Some(node) = dom.get_node(link_id) {
                let href = node.get_attribute("href").unwrap_or_default().to_string();
                let text = dom.text_content(link_id);
                let text = text.trim();

                let full_url = if href.starts_with("http://") || href.starts_with("https://") {
                    href.clone()
                } else if let Some(ref base) = base_url {
                    base.join(&href).map(|u| u.to_string()).unwrap_or(href.clone())
                } else {
                    href.clone()
                };

                if !full_url.is_empty() {
                    if text.is_empty() {
                        rendered.push(full_url);
                    } else {
                        rendered.push(format!("{}\t{}", full_url, text));
                    }
                }
            }
        }
        rendered.join("\n")
    }).unwrap_or_default()
}

/// Selectors paired with the attribute whose URL we extract and the
/// asset kind we surface. Order is stable so the output of
/// `--dump assets` is deterministic across runs.
const ASSET_SELECTORS: &[(&str, &str, &str)] = &[
    ("script[src]", "src", "script"),
    ("link[href]", "href", "link"),
    ("img[src]", "src", "image"),
    ("iframe[src]", "src", "iframe"),
    ("source[src]", "src", "media"),
    ("video[src]", "src", "video"),
    ("audio[src]", "src", "audio"),
    ("embed[src]", "src", "embed"),
    ("object[data]", "data", "object"),
];

/// Map a `<link>` element's `rel` token to a more specific asset
/// kind so consumers can filter (e.g. just stylesheets, just icons).
/// Unknown / missing `rel` falls back to a generic "link" so the
/// caller still sees the URL.
pub(crate) fn link_kind_from_rel(rel: &str) -> &'static str {
    match rel.split_ascii_whitespace().next().unwrap_or("").to_ascii_lowercase().as_str() {
        "stylesheet" => "stylesheet",
        "icon" | "shortcut" => "icon",
        "manifest" => "manifest",
        "preload" => "preload",
        "prefetch" => "prefetch",
        "modulepreload" => "modulepreload",
        "dns-prefetch" => "dns-prefetch",
        "preconnect" => "preconnect",
        "alternate" => "alternate",
        _ => "link",
    }
}

/// Resolve a raw `src`/`href`/`data` attribute against the page's
/// base URL. Mirrors `dump_links`'s logic so `--dump assets` and
/// `--dump links` agree on absolute-URL semantics.
pub(crate) fn resolve_asset_url(raw: &str, base_url: Option<&url::Url>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    if let Some(base) = base_url {
        if let Ok(joined) = base.join(trimmed) {
            return Some(joined.to_string());
        }
    }
    Some(trimmed.to_string())
}

/// Walk the rendered DOM and emit one NDJSON line per discoverable
/// sub-resource. Pure over `DomTree`/`Url` so unit tests can drive
/// it from a fixture HTML without standing up a browser.
pub(crate) fn extract_assets(dom: &obscura_dom::DomTree, base_url: Option<&url::Url>) -> String {
    let mut out: Vec<String> = Vec::new();
    for (selector, attr, default_kind) in ASSET_SELECTORS {
        let nodes = dom.query_selector_all(selector).unwrap_or_default();
        for node_id in nodes {
            let Some(node) = dom.get_node(node_id) else { continue };
            let raw = node.get_attribute(attr).unwrap_or_default().to_string();
            let Some(url) = resolve_asset_url(&raw, base_url) else { continue };

            let kind = if *default_kind == "link" {
                let rel = node.get_attribute("rel").unwrap_or_default().to_string();
                link_kind_from_rel(&rel)
            } else {
                *default_kind
            };

            let record = serde_json::json!({
                "url": url,
                "type": kind,
            });
            out.push(record.to_string());
        }
    }
    out.join("\n")
}

pub(crate) fn dump_assets(page: &Page) -> String {
    let base_url = page.url.clone();
    let dom_ndjson = page
        .with_dom(|dom| extract_assets(dom, base_url.as_ref()))
        .unwrap_or_default();

    let mut lines: Vec<String> =
        dom_ndjson.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect();

    // URLs already listed from static DOM attributes, so a resource the script
    // fetches that the markup also references is not emitted twice.
    let mut seen: std::collections::HashSet<String> = lines
        .iter()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
        .collect();

    // Resources pulled in by JS fetch()/XHR, which leave no static DOM tag
    // (issue #301).
    for url in page.fetched_urls() {
        if seen.insert(url.clone()) {
            lines.push(serde_json::json!({ "url": url, "type": "fetch" }).to_string());
        }
    }

    lines.join("\n")
}

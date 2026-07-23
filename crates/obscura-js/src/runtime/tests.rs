use super::*;
use obscura_dom::parse_html;

fn setup_runtime(html: &str) -> ObscuraJsRuntime {
    let dom = parse_html(html);
    let mut rt = ObscuraJsRuntime::new();
    rt.set_dom(dom);
    rt.set_url("http://example.com/test");
    rt.set_title("Test Page");
    rt.run_page_init();
    rt
}

#[test]
fn test_document_title() {
    let mut rt = setup_runtime("<html><head><title>Test</title></head><body></body></html>");
    let title = rt.evaluate("document.title").unwrap();
    assert_eq!(title, serde_json::json!("Test Page"));
}

#[test]
fn test_document_url() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let url = rt.evaluate("document.URL").unwrap();
    assert_eq!(url, serde_json::json!("http://example.com/test"));
}

#[test]
fn test_query_selector() {
    let mut rt = setup_runtime("<html><body><h1>Hello</h1><p>World</p></body></html>");
    let text = rt.evaluate("document.querySelector('h1').textContent").unwrap();
    assert_eq!(text, serde_json::json!("Hello"));
}

#[test]
fn test_query_selector_all() {
    let mut rt = setup_runtime("<ul><li>A</li><li>B</li><li>C</li></ul>");
    let count = rt.evaluate("document.querySelectorAll('li').length").unwrap();
    assert_eq!(count.as_f64().unwrap() as i64, 3);
}

#[test]
fn test_get_element_by_id() {
    let mut rt = setup_runtime(r#"<div id="test">Content</div>"#);
    let tag = rt.evaluate("document.getElementById('test').tagName").unwrap();
    assert_eq!(tag, serde_json::json!("DIV"));
}

#[test]
fn document_fragment_get_element_by_id_searches_descendants() {
    let mut rt = setup_runtime(r#"<div id="target">document</div>"#);
    let result = rt
        .evaluate(
            r#"
            (() => {
                const frag = document.createDocumentFragment();
                const section = document.createElement('section');
                section.innerHTML = '<div><span id="target">fragment</span></div><p id="a.b">literal</p>';
                frag.appendChild(section);

                const dup = document.createDocumentFragment();
                const deepParent = document.createElement('div');
                deepParent.innerHTML = '<span id="dup">deep</span>';
                const shallow = document.createElement('p');
                shallow.id = 'dup';
                shallow.textContent = 'shallow';
                dup.appendChild(deepParent);
                dup.appendChild(shallow);

                return [
                    frag.getElementById('target').textContent,
                    frag.getElementById('missing') === null,
                    frag.getElementById('a.b').textContent,
                    frag.getElementById(123) === null,
                    dup.getElementById('dup').textContent,
                ];
            })()
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!(["fragment", true, "literal", true, "deep"])
    );
}

/// Issue #461: FILTER_REJECT must prune the rejected node's whole subtree,
/// while FILTER_SKIP only skips the node and leaves descendants eligible.
/// Collapsing both into "not accepted" let a TreeWalker yield nodes from
/// inside a subtree the page explicitly rejected.
#[test]
fn tree_walker_filter_reject_prunes_the_whole_subtree() {
    let mut rt = setup_runtime(
        r#"<div id="root"><section><p>deep</p></section><a></a></div>"#,
    );
    rt.run_page_init();
    let result = rt
        .evaluate(
            r#"
            const root = document.getElementById('root');
            function walk(verdict) {
                const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                    acceptNode(node) {
                        return node.tagName === 'SECTION' ? verdict : NodeFilter.FILTER_ACCEPT;
                    }
                });
                const seen = [];
                let node;
                while ((node = w.nextNode())) seen.push(node.tagName);
                return seen;
            }
            return [walk(NodeFilter.FILTER_REJECT), walk(NodeFilter.FILTER_SKIP)];
            "#,
        )
        .unwrap();
    // REJECT drops <p> with its <section> parent; SKIP drops only <section>.
    assert_eq!(result, serde_json::json!([["A"], ["P", "A"]]));
}

/// Issue #462: previousNode() must walk reverse document order until a node
/// is accepted, not give up as soon as the first candidate is filtered out.
#[test]
fn previous_node_walks_reverse_document_order() {
    let mut rt = setup_runtime(r#"<div id="root"><a><b></b></a><c></c></div>"#);
    rt.run_page_init();
    let result = rt
        .evaluate(
            r#"
            const root = document.getElementById('root');
            const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode(node) {
                    return node.tagName === 'B'
                        ? NodeFilter.FILTER_SKIP
                        : NodeFilter.FILTER_ACCEPT;
                }
            });
            const forward = [];
            let node;
            while ((node = w.nextNode())) forward.push(node.tagName);
            const backward = [];
            while ((node = w.previousNode())) backward.push(node.tagName);
            return [forward, backward];
            "#,
        )
        .unwrap();
    // From <c>, the previous sibling's deepest last child <b> is skipped, so
    // the walk must keep going up to <a> instead of returning null.
    assert_eq!(result, serde_json::json!([["A", "C"], ["A"]]));
}

/// Issue #462: a backward walk must retrace a forward walk exactly, and stop
/// at the root without ever returning it.
#[test]
fn previous_node_retraces_a_full_forward_walk() {
    let mut rt = setup_runtime(
        r#"<div id="root"><section><p>one</p><span></span></section><a><b></b></a></div>"#,
    );
    rt.run_page_init();
    let result = rt
        .evaluate(
            r#"
            const root = document.getElementById('root');
            const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            const forward = [];
            let node;
            while ((node = w.nextNode())) forward.push(node.tagName);
            const backward = [];
            while ((node = w.previousNode())) backward.push(node.tagName);
            backward.reverse();
            // previousNode never yields root, and never yields the node the
            // forward walk ended on, so compare against forward minus its last.
            // A failed traversal leaves currentNode untouched (DOM 6.1), so
            // it stays on the last node previousNode did return.
            return [forward, backward, w.currentNode.tagName];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([
            ["SECTION", "P", "SPAN", "A", "B"],
            ["SECTION", "P", "SPAN", "A"],
            "SECTION"
        ])
    );
}

/// Issue #462: FILTER_REJECT prunes a subtree in the backward direction too
/// — the descent into a rejected node's last children must stop.
#[test]
fn previous_node_honours_filter_reject_subtree_pruning() {
    let mut rt = setup_runtime(
        r#"<div id="root"><a></a><section><p>deep</p></section><c></c></div>"#,
    );
    rt.run_page_init();
    let result = rt
        .evaluate(
            r#"
            const root = document.getElementById('root');
            const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode(node) {
                    return node.tagName === 'SECTION'
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_ACCEPT;
                }
            });
            while (w.nextNode()) { /* advance to the last accepted node */ }
            const backward = [];
            let node;
            while ((node = w.previousNode())) backward.push(node.tagName);
            return backward;
            "#,
        )
        .unwrap();
    // <p> lives inside the rejected <section>, so the backward walk from <c>
    // must jump straight to <a>.
    assert_eq!(result, serde_json::json!(["A"]));
}

/// Issue #461: NodeIterator has no subtree pruning — DOM 6.2 says
/// FILTER_REJECT behaves as FILTER_SKIP there. The shared walker must not
/// leak TreeWalker's pruning into it.
#[test]
fn node_iterator_treats_filter_reject_as_skip() {
    let mut rt = setup_runtime(
        r#"<div id="root"><section><p>deep</p></section><a></a></div>"#,
    );
    rt.run_page_init();
    let result = rt
        .evaluate(
            r#"
            const root = document.getElementById('root');
            const it = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode(node) {
                    return node.tagName === 'SECTION'
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_ACCEPT;
                }
            });
            const seen = [];
            let node;
            while ((node = it.nextNode())) seen.push(node.tagName);
            return seen;
            "#,
        )
        .unwrap();
    assert_eq!(result, serde_json::json!(["P", "A"]));
}

#[test]
fn append_child_flattens_document_fragment() {
    let mut rt = setup_runtime(r#"<main id="host"></main>"#);
    let result = rt
        .evaluate(
            r#"
            const host = document.getElementById('host');
            const fragment = document.createDocumentFragment();
            const first = document.createElement('article');
            const second = document.createElement('article');
            first.id = 'first';
            second.id = 'second';
            first.className = second.className = 'quote';
            fragment.appendChild(first);
            fragment.appendChild(second);

            const returned = host.appendChild(fragment);
            return [
                returned === fragment,
                Array.from(host.children).map(node => node.id),
                host.querySelectorAll('.quote').length,
                fragment.childNodes.length,
                first.parentNode === host,
                first.parentElement === host,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([true, ["first", "second"], 2, 0, true, true])
    );
}

#[test]
fn insert_before_flattens_document_fragment_in_order() {
    let mut rt = setup_runtime(r#"<main id="host"><article id="last"></article></main>"#);
    let result = rt
        .evaluate(
            r#"
            const host = document.getElementById('host');
            const last = document.getElementById('last');
            const fragment = document.createDocumentFragment();
            const first = document.createElement('article');
            const second = document.createElement('article');
            first.id = 'first';
            second.id = 'second';
            fragment.appendChild(first);
            fragment.appendChild(second);

            const returned = host.insertBefore(fragment, last);
            return [
                returned === fragment,
                Array.from(host.children).map(node => node.id),
                fragment.childNodes.length,
                first.parentElement === host,
                second.parentElement === host,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([true, ["first", "second", "last"], 0, true, true])
    );
}

#[test]
fn replace_child_flattens_document_fragment_and_removes_old_child() {
    let mut rt = setup_runtime(
        r#"<main id="host"><article id="old"></article><article id="tail"></article></main>"#,
    );
    let result = rt
        .evaluate(
            r#"
            const host = document.getElementById('host');
            const old = document.getElementById('old');
            const fragment = document.createDocumentFragment();
            const first = document.createElement('article');
            const second = document.createElement('article');
            first.id = 'first';
            second.id = 'second';
            fragment.appendChild(first);
            fragment.appendChild(second);

            const returned = host.replaceChild(fragment, old);
            return [
                returned === old,
                Array.from(host.children).map(node => node.id),
                fragment.childNodes.length,
                old.parentNode === null,
                first.parentElement === host,
                second.parentElement === host,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([true, ["first", "second", "tail"], 0, true, true, true])
    );
}

#[test]
fn test_inner_html() {
    let mut rt = setup_runtime(r#"<div id="x"><p>Hello</p></div>"#);
    let html = rt.evaluate("document.getElementById('x').innerHTML").unwrap();
    assert!(html.as_str().unwrap().contains("<p>"));
}

#[test]
fn test_script_execution() {
    let mut rt = setup_runtime("<ul><li>A</li><li>B</li></ul>");
    rt.execute_script(
        "test",
        r#"
        globalThis.__result = [];
        document.querySelectorAll('li').forEach(function(el) {
            globalThis.__result.push(el.textContent);
        });
    "#,
    )
    .unwrap();
    let result = rt.evaluate("globalThis.__result").unwrap();
    assert_eq!(result, serde_json::json!(["A", "B"]));
}

/// Regression test for #147: a TypeError in one script must not poison
/// the runtime so that subsequent scripts (or DOM queries) collapse to
/// empty. The reporter saw `--dump text` return 1 byte after offside.js
/// crashed; that cascade should never happen.
#[test]
fn script_typeerror_does_not_poison_subsequent_execution() {
    let mut rt = setup_runtime(
        "<html><body><p id=hit>BODY_TEXT</p></body></html>",
    );

    // 1. First script throws the same flavor of error offside.js produced
    //    (`Cannot read properties of undefined (reading 'classList')`).
    let err = rt
        .execute_script("buggy", "var x; x.classList.add('y');")
        .unwrap_err();
    assert!(err.contains("classList") || err.contains("undefined"),
            "expected classList/undefined error, got: {}", err);

    // 2. The runtime must still be usable: a follow-up script runs.
    rt.execute_script("ok", "globalThis.__after_error = 'still alive';")
        .unwrap();
    let result = rt.evaluate("globalThis.__after_error").unwrap();
    assert_eq!(result, serde_json::json!("still alive"));

    // 3. DOM queries still work after the script error.
    let text = rt
        .evaluate("document.querySelector('#hit').textContent")
        .unwrap();
    assert_eq!(text, serde_json::json!("BODY_TEXT"));
}

/// Regression test for #355: an explicit `throw` in one inline <script> must
/// not stop later independent <script>s from running. Each <script> executes
/// as its own `execute_script` call, mirroring how page.rs runs them, so a
/// thrown error is reported but the next script still runs.
#[test]
fn thrown_error_in_one_script_does_not_stop_later_scripts() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.execute_script("s1", "globalThis.__ran1 = true;").unwrap();
    let err = rt
        .execute_script("s2", "throw new Error('only one instance of babel-polyfill is allowed');")
        .unwrap_err();
    assert!(err.contains("babel-polyfill"), "expected the thrown message, got: {}", err);
    rt.execute_script("s3", "globalThis.__ran3 = true;").unwrap();
    let ran = rt
        .evaluate("JSON.stringify([globalThis.__ran1 === true, globalThis.__ran3 === true])")
        .unwrap();
    assert_eq!(ran, serde_json::json!("[true,true]"));
}

/// Regression test for #356: the `in` operator and `Object.keys` must work on
/// `el.style` (CSSStyleDeclaration) and `el.dataset` (DOMStringMap), `_props`
/// must not leak, and cssText must serialize dashed names with a trailing
/// semicolon.
#[test]
fn style_and_dataset_support_in_operator_and_keys() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt
        .evaluate(
            r#"(() => {
                const el = document.createElement('div');
                el.style.color = 'red';
                el.style.fontSize = '14px';
                el.dataset.foo = 'bar';
                const keys = Object.keys(el.style);
                return JSON.stringify({
                    colorInStyle: 'color' in el.style,
                    objectFitInStyle: 'object-fit' in el.style,
                    keysHasSet: keys.includes('color') && keys.includes('fontSize'),
                    noPropsLeak: !keys.includes('_props'),
                    fooInDataset: 'foo' in el.dataset,
                    datasetKeys: Object.keys(el.dataset),
                    cssText: el.style.cssText,
                    length: el.style.length,
                    getByDash: el.style.getPropertyValue('font-size')
                });
            })()"#,
        )
        .unwrap();
    let p: serde_json::Value = serde_json::from_str(result.as_str().unwrap()).unwrap();
    assert_eq!(p["colorInStyle"], true);
    assert_eq!(p["objectFitInStyle"], true);
    assert_eq!(p["keysHasSet"], true);
    assert_eq!(p["noPropsLeak"], true);
    assert_eq!(p["fooInDataset"], true);
    assert_eq!(p["datasetKeys"], serde_json::json!(["foo"]));
    assert_eq!(p["cssText"], "color: red; font-size: 14px;");
    assert_eq!(p["length"], 2);
    assert_eq!(p["getByDash"], "14px");
}

/// Regression for #105: `element.querySelector` and `querySelectorAll`
/// must scope to the receiver's subtree, not the whole document.
#[test]
fn element_query_selector_is_scoped_to_subtree() {
    let mut rt = setup_runtime(
        r#"<div id="a"><span class="x">in a</span></div><div id="b"><span class="x">in b</span></div>"#,
    );
    let text = rt
        .evaluate("document.getElementById('a').querySelector('.x').textContent")
        .unwrap();
    assert_eq!(text, serde_json::json!("in a"));

    let count_in_a = rt
        .evaluate("document.getElementById('a').querySelectorAll('.x').length")
        .unwrap();
    assert_eq!(count_in_a.as_f64().unwrap() as i64, 1);

    // Document-scoped query still sees both.
    let count_doc = rt.evaluate("document.querySelectorAll('.x').length").unwrap();
    assert_eq!(count_doc.as_f64().unwrap() as i64, 2);
}

#[test]
fn document_evaluate_exposes_basic_xpath_result() {
    let mut rt = setup_runtime("");

    let exposed = rt
        .evaluate("`${typeof XPathResult}:${typeof Document.prototype.evaluate}:${XPathResult.FIRST_ORDERED_NODE_TYPE}`")
        .unwrap();
    assert_eq!(exposed, serde_json::json!("function:function:9"));
}

/// Regression for #105: `document.forms` / `images` / `links` must be
/// live, not hardcoded `[]`. jQuery 1.x's submit-event setup iterates
/// `document.forms` and crashes when it's empty for pages that have forms.
#[test]
fn document_forms_images_links_are_live() {
    let mut rt = setup_runtime(
        r#"<form></form><form></form><img><a href="x">l</a><a>no-href</a>"#,
    );
    assert_eq!(rt.evaluate("document.forms.length").unwrap().as_f64().unwrap() as i64, 2);
    assert_eq!(rt.evaluate("document.images.length").unwrap().as_f64().unwrap() as i64, 1);
    assert_eq!(rt.evaluate("document.links.length").unwrap().as_f64().unwrap() as i64, 1);
}

/// Regression for #105: `HTMLFormElement` must expose `.elements` so
/// frameworks that probe form field collections work.
#[test]
fn html_form_element_exposes_elements_collection() {
    let mut rt = setup_runtime(
        r#"<form id="f"><input name=a><input name=b><textarea></textarea></form>"#,
    );
    let n = rt
        .evaluate("document.getElementById('f').elements.length")
        .unwrap();
    assert_eq!(n.as_f64().unwrap() as i64, 3);
    let is_form = rt
        .evaluate("document.getElementById('f') instanceof HTMLFormElement")
        .unwrap();
    assert_eq!(is_form, serde_json::json!(true));
}

/// Regression for #105: `Element.prepend` must actually insert at the
/// start, not silently no-op.
#[test]
fn element_prepend_inserts_at_start() {
    let mut rt = setup_runtime(r#"<div id="c"><span>existing</span></div>"#);
    rt.evaluate(
        r#"
        const c = document.getElementById('c');
        const n = document.createElement('span');
        n.id = 'first';
        c.prepend(n);
        "#,
    )
    .unwrap();
    let first_id = rt.evaluate("document.getElementById('c').firstChild.id").unwrap();
    assert_eq!(first_id, serde_json::json!("first"));
    let count = rt.evaluate("document.getElementById('c').childNodes.length").unwrap();
    assert_eq!(count.as_f64().unwrap() as i64, 2);
}

/// Regression for #105: `isEqualNode` compares structure, not identity.
/// Framework diff algorithms rely on this.
#[test]
fn is_equal_node_does_structural_compare() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt
        .evaluate(
            r#"
            const a = document.createElement('div'); a.setAttribute('class', 'x'); a.innerHTML = '<span>hi</span>';
            const b = document.createElement('div'); b.setAttribute('class', 'x'); b.innerHTML = '<span>hi</span>';
            const c = document.createElement('div'); c.innerHTML = '<span>bye</span>';
            return [a.isEqualNode(b), a.isEqualNode(c), a.isSameNode(b)];
            "#,
        )
        .unwrap();
    assert_eq!(result, serde_json::json!([true, false, false]));
}

/// Regression for the long-standing insert_before arg-order bug noted
/// in CLAUDE.md: bootstrap.js was passing (parent, new, ref) but `_dom`
/// forwards only two args, silently dropping `ref`. With the fix,
/// `insertBefore` actually inserts.
#[test]
fn insert_before_inserts_node_at_correct_position() {
    let mut rt = setup_runtime(r#"<div id="p"><span id="b">b</span><span id="c">c</span></div>"#);
    let order = rt
        .evaluate(
            r#"
            const p = document.getElementById('p');
            const a = document.createElement('span');
            a.id = 'a';
            p.insertBefore(a, document.getElementById('b'));
            return Array.from(p.children).map(e => e.id).join(',');
            "#,
        )
        .unwrap();
    assert_eq!(order, serde_json::json!("a,b,c"));
}

#[test]
fn test_console_log() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.execute_script("test", "console.log('Hello from V8!')").unwrap();
}

#[test]
fn test_location() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let href = rt.evaluate("location.href").unwrap();
    assert_eq!(href, serde_json::json!("http://example.com/test"));
}

#[test]
fn test_button_click_dispatches_listener() {
    let mut rt = setup_runtime(r#"<button id="go">Go</button>"#);
    let result = rt.evaluate(r#"
        const button = document.getElementById('go');
        button.addEventListener('click', () => { button.dataset.clicked = 'yes'; });
        button.click();
        return button.dataset.clicked;
    "#).unwrap();
    assert_eq!(result, serde_json::json!("yes"));
}

#[test]
fn test_dispatch_mouse_event_runs_listener() {
    let mut rt = setup_runtime(r#"<button id="go">Go</button>"#);
    let result = rt.evaluate(r#"
        const button = document.getElementById('go');
        let count = 0;
        button.addEventListener('click', () => { count += 1; });
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return count;
    "#).unwrap();
    assert_eq!(result.as_f64().unwrap() as i64, 1);
}

#[test]
fn test_location_href_assignment_updates_navigation_state() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let href = rt.evaluate("const next = '/next'; location.href = next; return location.href;").unwrap();
    assert_eq!(href, serde_json::json!("http://example.com/next"));
    assert_eq!(
        rt.take_pending_navigation(),
        Some(("http://example.com/next".to_string(), "GET".to_string(), "".to_string()))
    );
}

#[test]
fn test_submit_button_click_handler_can_prevent_default_and_navigate() {
    let mut rt = setup_runtime(r#"<form><button type="submit" id="submit">Submit</button></form>"#);
    let href = rt.evaluate(r#"
        const form = document.querySelector('form');
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            location.href = '/submitted';
        });
        document.getElementById('submit').click();
        return location.href;
    "#).unwrap();
    assert_eq!(href, serde_json::json!("http://example.com/submitted"));
    assert_eq!(
        rt.take_pending_navigation(),
        Some(("http://example.com/submitted".to_string(), "GET".to_string(), "".to_string()))
    );
}

#[test]
fn test_navigator() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let ua = rt.evaluate("navigator.userAgent").unwrap();
    assert!(ua.as_str().unwrap().contains("Chrome"), "UA should contain Chrome: {}", ua);
    let wd = rt.evaluate("navigator.webdriver").unwrap();
    assert_eq!(wd, serde_json::json!(false));
    let plugins = rt.evaluate("navigator.plugins.length").unwrap();
    assert!(plugins.as_f64().unwrap() > 0.0, "Should have plugins");
    let chrome = rt.evaluate("typeof window.chrome").unwrap();
    assert_eq!(chrome, serde_json::json!("object"));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_no_args() {
    let mut rt = setup_runtime("<html><head><title>Test</title></head><body></body></html>");
    let result = rt
        .call_function_on("() => document.title", None, &[], true)
        .await.unwrap();
    assert_eq!(result.value.unwrap(), serde_json::json!("Test Page"));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_with_args() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let args = vec![
        serde_json::json!({"value": 10}),
        serde_json::json!({"value": 20}),
    ];
    let result = rt.call_function_on("(a, b) => a + b", None, &args, true).await.unwrap();
    assert_eq!(result.value.unwrap().as_f64().unwrap() as i64, 30);
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_with_string_args() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let args = vec![
        serde_json::json!({"value": "hello"}),
        serde_json::json!({"value": " world"}),
    ];
    let result = rt.call_function_on("(a, b) => a + b", None, &args, true).await.unwrap();
    assert_eq!(result.value.unwrap(), serde_json::json!("hello world"));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_with_object_args() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let args = vec![serde_json::json!({"value": {"name": "test", "count": 5}})];
    let result = rt
        .call_function_on("(obj) => obj.name + ':' + obj.count", None, &args, true)
        .await.unwrap();
    assert_eq!(result.value.unwrap(), serde_json::json!("test:5"));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_return_object() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt
        .call_function_on("() => ({a: 1, b: 2})", None, &[], true)
        .await.unwrap();
    assert_eq!(result.value.unwrap(), serde_json::json!({"a": 1, "b": 2}));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_object_ref_preserves_methods() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt
        .call_function_on(
            "() => ({ items: [1,2,3], getLen: function() { return this.items.length; } })",
            None,
            &[],
            false,
        )
        .await.unwrap();
    let oid = result.object_id.unwrap();

    let result2 = rt
        .call_function_on("function() { return this.getLen(); }", Some(&oid), &[], true)
        .await.unwrap();
    assert_eq!(result2.value.unwrap().as_f64().unwrap() as i64, 3);
}

#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_detects_node() {
    let mut rt = setup_runtime("<html><body><h1>Hello</h1></body></html>");
    let result = rt
        .evaluate_for_cdp("document.querySelector('h1')", false, false)
        .await.unwrap();
    assert_eq!(result.subtype.as_deref(), Some("node"));
    assert_eq!(result.js_type, "object");
    assert!(result.object_id.is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_detects_document() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate_for_cdp("document", false, false).await.unwrap();
    assert_eq!(result.subtype.as_deref(), Some("node"));
    assert_eq!(result.class_name, "HTMLDocument");
}


#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_awaits_resolved_promise() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate_for_cdp("Promise.resolve(42)", true, true).await.unwrap();
    assert_eq!(result.value.unwrap().as_f64().unwrap() as i64, 42);
}

#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_awaits_timer_promise() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate_for_cdp("new Promise(resolve => setTimeout(() => resolve('done'), 1))", true, true).await.unwrap();
    assert_eq!(result.value.unwrap().as_str().unwrap(), "done");
}

#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_awaits_async_function() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate_for_cdp("(async () => 'async-ok')()", true, true).await.unwrap();
    assert_eq!(result.value.unwrap().as_str().unwrap(), "async-ok");
}

#[tokio::test(flavor = "current_thread")]
async fn test_evaluate_for_cdp_reports_promise_rejection() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let err = rt.evaluate_for_cdp("Promise.reject(new Error('boom'))", true, true).await.unwrap_err();
    assert!(err.contains("boom"));
}

#[tokio::test(flavor = "current_thread")]
async fn test_call_function_on_dom_interaction() {
    let mut rt = setup_runtime(r#"<div id="items"><span>A</span><span>B</span></div>"#);
    let args = vec![serde_json::json!({"value": "span"})];
    let result = rt
        .call_function_on(
            "(sel) => document.querySelectorAll(sel).length",
            None,
            &args,
            true,
        )
        .await.unwrap();
    assert_eq!(result.value.unwrap().as_f64().unwrap() as i64, 2);
}

#[test]
fn test_inner_html_setter() {
    let mut rt = setup_runtime(r#"<div id="target"><p>Old</p></div>"#);
    rt.execute_script("test", r#"
        var el = document.getElementById('target');
        el.innerHTML = '<strong>Bold</strong><em>Italic</em>';
    "#).unwrap();
    let result = rt.evaluate("document.getElementById('target').innerHTML").unwrap();
    let html = result.as_str().unwrap();
    assert!(html.contains("<strong>"), "innerHTML should contain <strong>, got: {}", html);
    assert!(html.contains("<em>"), "innerHTML should contain <em>, got: {}", html);
    assert!(!html.contains("Old"), "innerHTML should not contain old content, got: {}", html);
}

#[test]
fn test_inner_html_with_nested() {
    let mut rt = setup_runtime(r#"<div id="root"></div>"#);
    rt.execute_script("test", r#"
        var el = document.getElementById('root');
        el.innerHTML = '<ul><li>A</li><li>B</li><li>C</li></ul>';
    "#).unwrap();
    let count = rt.evaluate("document.querySelectorAll('li').length").unwrap();
    assert_eq!(count.as_f64().unwrap() as i64, 3, "Should find 3 li elements after innerHTML set");

    let text = rt.evaluate("document.querySelector('li').textContent").unwrap();
    assert_eq!(text, serde_json::json!("A"));
}

#[test]
fn test_input_value() {
    let mut rt = setup_runtime(r#"<form><input id="name" type="text" value="initial"><textarea id="bio">old text</textarea></form>"#);
    let val = rt.evaluate("document.getElementById('name').value").unwrap();
    assert_eq!(val, serde_json::json!("initial"));
    rt.execute_script("test", "document.getElementById('name').value = 'new value';").unwrap();
    let val2 = rt.evaluate("document.getElementById('name').value").unwrap();
    assert_eq!(val2, serde_json::json!("new value"));
    let bio = rt.evaluate("document.getElementById('bio').value").unwrap();
    assert_eq!(bio, serde_json::json!("old text"));
}

#[test]
fn test_sequential_runtime_swap() {
    let mut rt1 = setup_runtime("<html><body><h1>Page1</h1></body></html>");
    let title1 = rt1.evaluate("document.querySelector('h1').textContent").unwrap();
    assert_eq!(title1, serde_json::json!("Page1"));

    let dom1 = rt1.take_dom();
    drop(rt1);

    let mut rt2 = setup_runtime("<html><body><h1>Page2</h1></body></html>");
    let title2 = rt2.evaluate("document.querySelector('h1').textContent").unwrap();
    assert_eq!(title2, serde_json::json!("Page2"));
    drop(rt2);

    if let Some(dom) = dom1 {
        let mut rt1b = ObscuraJsRuntime::new();
        rt1b.set_dom(dom);
        rt1b.set_url("http://example.com");
        rt1b.set_title("Page1");
        rt1b.run_page_init();
        let title1b = rt1b.evaluate("document.querySelector('h1').textContent").unwrap();
        assert_eq!(title1b, serde_json::json!("Page1"));
    }
}

#[test]
fn test_checkbox_checked() {
    let mut rt = setup_runtime(r#"<input id="cb" type="checkbox" checked>"#);
    let checked = rt.evaluate("document.getElementById('cb').checked").unwrap();
    assert_eq!(checked, serde_json::json!(true));
    rt.execute_script("test", "document.getElementById('cb').checked = false;").unwrap();
    let checked2 = rt.evaluate("document.getElementById('cb').checked").unwrap();
    assert_eq!(checked2, serde_json::json!(false));
}

// Issue #324: React/Preact/Vue install a value tracker by redefining `value`
// on the element instance so they can tell a real edit from their own
// controlled write. __obscura_setFieldValue must write through the prototype
// setter, leaving that per-instance tracker stale, so the following input
// event reads as a genuine change and onChange fires. A plain assignment
// keeps the tracker in sync and suppresses onChange.
#[test]
fn set_field_value_bypasses_instance_value_wrapper() {
    let mut rt = setup_runtime(r#"<input id="i">"#);
    let result = rt
        .evaluate(
            r#"
            (function(){
                var el = document.getElementById('i');
                var d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
                var set = d.set, get = d.get, tracked = '' + el.value;
                Object.defineProperty(el, 'value', {
                    configurable: true,
                    get: function(){ return get.call(this); },
                    set: function(v){ tracked = '' + v; set.call(this, v); },
                });
                el.value = 'wrapped';
                var afterDirect = { value: el.value, tracked: tracked };
                globalThis.__obscura_setFieldValue(el, 'value', 'native');
                var afterHelper = { value: el.value, tracked: tracked };
                return JSON.stringify({ afterDirect: afterDirect, afterHelper: afterHelper });
            })()
            "#,
        )
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(result.as_str().unwrap()).unwrap();
    // Direct assignment keeps tracker == value (the change that suppresses onChange).
    assert_eq!(parsed["afterDirect"]["value"], "wrapped");
    assert_eq!(parsed["afterDirect"]["tracked"], "wrapped");
    // The helper updates the value but leaves the tracker stale, so onChange fires.
    assert_eq!(parsed["afterHelper"]["value"], "native");
    assert_eq!(parsed["afterHelper"]["tracked"], "wrapped");
}

// Issue #324: React feature-detects the modern input-event path with
// `('oninput' in document)`. If the GlobalEventHandlers on* attributes are
// only on window (not Document/Element), that check fails and React falls
// back to a legacy change-detection path, so controlled-input onChange never
// fires. These must be present on document and Element.prototype too.
#[test]
fn global_event_handlers_present_on_document_and_element() {
    let mut rt = setup_runtime("<div></div>");
    let result = rt
        .evaluate(
            r#"JSON.stringify({
                docInput: ('oninput' in document),
                docChange: ('onchange' in document),
                docClick: ('onclick' in document),
                elProtoInput: ('oninput' in Element.prototype),
                winInput: ('oninput' in window)
            })"#,
        )
        .unwrap();
    let p: serde_json::Value = serde_json::from_str(result.as_str().unwrap()).unwrap();
    assert_eq!(p["docInput"], true);
    assert_eq!(p["docChange"], true);
    assert_eq!(p["docClick"], true);
    assert_eq!(p["elProtoInput"], true);
    assert_eq!(p["winInput"], true);
}

#[test]
fn test_matches_and_closest() {
    let mut rt = setup_runtime(r#"<div class="outer"><div class="inner"><span id="target">Hi</span></div></div>"#);
    let matches = rt.evaluate("document.getElementById('target').matches('span')").unwrap();
    assert_eq!(matches, serde_json::json!(true));
    let closest = rt.evaluate("document.getElementById('target').closest('.outer').className").unwrap();
    assert_eq!(closest, serde_json::json!("outer"));
    let no_match = rt.evaluate("document.getElementById('target').closest('.nonexistent')").unwrap();
    assert_eq!(no_match, serde_json::Value::Null);
}

#[test]
fn test_clone_node_deep() {
    let mut rt = setup_runtime(r#"<div id="src"><p>A</p><p>B</p></div>"#);
    rt.execute_script("test", r#"
        var src = document.getElementById('src');
        var clone = src.cloneNode(true);
        document.body.appendChild(clone);
    "#).unwrap();
    let count = rt.evaluate("document.querySelectorAll('p').length").unwrap();
    assert!(count.as_f64().unwrap() as i64 >= 4, "Deep clone should duplicate <p> children, got: {}", count);
}

#[test]
fn test_evaluate_multistatement() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate("var x = 5; var y = 10; return x + y;").unwrap();
    assert_eq!(result.as_f64().unwrap() as i64, 15);
}

#[tokio::test(flavor = "current_thread")]
async fn test_object_ref_as_argument() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let obj = rt
        .call_function_on("() => ({ x: 42 })", None, &[], false)
        .await.unwrap();
    let oid = obj.object_id.unwrap();

    let args = vec![serde_json::json!({"objectId": oid})];
    let result = rt
        .call_function_on("(obj) => obj.x * 2", None, &args, true)
        .await.unwrap();
    assert_eq!(result.value.unwrap().as_f64().unwrap() as i64, 84);
}

fn setup_runtime_with_cookies(html: &str) -> (ObscuraJsRuntime, std::sync::Arc<obscura_net::CookieJar>) {
    let dom = obscura_dom::parse_html(html);
    let jar = std::sync::Arc::new(obscura_net::CookieJar::new());
    let mut rt = ObscuraJsRuntime::new();
    rt.set_dom(dom);
    rt.set_url("http://example.com/test");
    rt.set_title("Test Page");
    rt.set_cookie_jar(jar.clone());
    rt.run_page_init();
    (rt, jar)
}

#[test]
fn test_document_cookie_reads_http_cookies() {
    let (mut rt, jar) = setup_runtime_with_cookies("<html><body></body></html>");
    let url = url::Url::parse("http://example.com/test").unwrap();
    jar.set_cookie("session=abc123; Path=/", &url);
    jar.set_cookie("theme=dark; Path=/", &url);
    let result = rt.evaluate("document.cookie").unwrap();
    let cookie_str = result.as_str().unwrap();
    assert!(cookie_str.contains("session=abc123"), "expected session cookie, got: {}", cookie_str);
    assert!(cookie_str.contains("theme=dark"), "expected theme cookie, got: {}", cookie_str);
}

#[test]
fn test_document_cookie_excludes_httponly() {
    let (mut rt, jar) = setup_runtime_with_cookies("<html><body></body></html>");
    let url = url::Url::parse("http://example.com/test").unwrap();
    jar.set_cookie("visible=yes; Path=/", &url);
    jar.set_cookie("secret=token; Path=/; HttpOnly", &url);
    let result = rt.evaluate("document.cookie").unwrap();
    let cookie_str = result.as_str().unwrap();
    assert!(cookie_str.contains("visible=yes"), "expected visible cookie, got: {}", cookie_str);
    assert!(!cookie_str.contains("secret"), "httpOnly cookie should not be visible to JS, got: {}", cookie_str);
}

#[test]
fn test_document_cookie_setter_stores_in_jar() {
    let (mut rt, jar) = setup_runtime_with_cookies("<html><body></body></html>");
    rt.evaluate("document.cookie = 'foo=bar; Path=/'").unwrap();
    let url = url::Url::parse("http://example.com/test").unwrap();
    let result = rt.evaluate("document.cookie").unwrap();
    assert!(result.as_str().unwrap().contains("foo=bar"));
    let header = jar.get_cookie_header(&url);
    assert!(header.contains("foo=bar"), "cookie should be in jar, got: {}", header);
}

#[test]
fn test_document_cookie_delete_via_max_age() {
    let (mut rt, jar) = setup_runtime_with_cookies("<html><body></body></html>");
    let url = url::Url::parse("http://example.com/test").unwrap();
    rt.evaluate("document.cookie = 'temp=val; Path=/'").unwrap();
    assert!(rt.evaluate("document.cookie").unwrap().as_str().unwrap().contains("temp=val"));
    rt.evaluate("document.cookie = 'temp=; Max-Age=0'").unwrap();
    let result = rt.evaluate("document.cookie").unwrap();
    assert!(!result.as_str().unwrap().contains("temp="), "cookie should be deleted, got: {}", result);
    assert!(!jar.get_cookie_header(&url).contains("temp="));
}

#[test]
fn test_document_cookie_js_and_http_merge() {
    let (mut rt, jar) = setup_runtime_with_cookies("<html><body></body></html>");
    let url = url::Url::parse("http://example.com/test").unwrap();
    jar.set_cookie("server_sid=xyz; Path=/", &url);
    rt.evaluate("document.cookie = 'client_pref=light'").unwrap();
    let result = rt.evaluate("document.cookie").unwrap();
    let cookie_str = result.as_str().unwrap();
    assert!(cookie_str.contains("server_sid=xyz"), "expected server cookie, got: {}", cookie_str);
    assert!(cookie_str.contains("client_pref=light"), "expected client cookie, got: {}", cookie_str);
}

#[test]
fn test_document_cookie_empty_when_no_cookies() {
    let (mut rt, _jar) = setup_runtime_with_cookies("<html><body></body></html>");
    let result = rt.evaluate("document.cookie").unwrap();
    assert_eq!(result.as_str().unwrap(), "");
}

#[test]
fn test_document_cookie_no_jar_returns_empty() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate("document.cookie").unwrap();
    assert_eq!(result.as_str().unwrap(), "");
}

#[test]
fn test_document_write_appends_to_body() {
    let mut rt = setup_runtime("<html><body><p>Existing</p></body></html>");
    rt.evaluate("document.write('<div>Added</div>')").unwrap();
    let html = rt.evaluate("document.body.innerHTML").unwrap();
    let body = html.as_str().unwrap();
    assert!(body.contains("Existing"), "existing content should remain, got: {}", body);
    assert!(body.contains("Added"), "written content should appear, got: {}", body);
}

#[test]
fn test_document_writeln() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.evaluate("document.writeln('Hello')").unwrap();
    let html = rt.evaluate("document.body.innerHTML").unwrap();
    assert!(html.as_str().unwrap().contains("Hello"));
}

#[test]
fn test_document_write_multiple_args() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.evaluate("document.write('Hello', ' ', 'World')").unwrap();
    let text = rt.evaluate("document.body.textContent").unwrap();
    assert_eq!(text.as_str().unwrap().trim(), "Hello World");
}

#[test]
fn test_document_open_clears_body() {
    let mut rt = setup_runtime("<html><body><p>Old content</p></body></html>");
    rt.evaluate("document.open()").unwrap();
    let html = rt.evaluate("document.body.innerHTML").unwrap();
    assert_eq!(html.as_str().unwrap(), "");
}

#[test]
fn test_document_write_html_elements() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.evaluate(r#"document.write('<h1 id="title">Test</h1><p>Para</p>')"#).unwrap();
    let h1 = rt.evaluate("document.querySelector('h1').textContent").unwrap();
    assert_eq!(h1.as_str().unwrap(), "Test");
    let p = rt.evaluate("document.querySelector('p').textContent").unwrap();
    assert_eq!(p.as_str().unwrap(), "Para");
}

#[test]
fn test_url_relative_resolution() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate("new URL('data.json', 'http://example.com/path/page.html').href").unwrap();
    assert_eq!(result.as_str().unwrap(), "http://example.com/path/data.json");

    let result = rt.evaluate("new URL('/api/data', 'http://example.com/path/page.html').href").unwrap();
    assert_eq!(result.as_str().unwrap(), "http://example.com/api/data");

    let result = rt.evaluate("new URL('https://other.com/foo', 'http://example.com/bar').href").unwrap();
    assert_eq!(result.as_str().unwrap(), "https://other.com/foo");

    let result = rt.evaluate("new URL('sub/file.js', 'http://example.com/a/b/c.html').href").unwrap();
    assert_eq!(result.as_str().unwrap(), "http://example.com/a/b/sub/file.js");

    let result = rt.evaluate("new URL('api.json', 'http://localhost:8080/dir/index.html').href").unwrap();
    assert_eq!(result.as_str().unwrap(), "http://localhost:8080/dir/api.json");
}

#[tokio::test(flavor = "current_thread")]
async fn test_fetch_url_input_decodes_binary_body_base64() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.call_function_on_for_cdp(
        r#"async () => {
            const originalFetchOp = Deno.core.ops.op_fetch_url;
            try {
                Deno.core.ops.op_fetch_url = (url) => {
                    globalThis.__capturedFetchUrl = url;
                    return JSON.stringify({
                        status: 200,
                        headers: { "content-type": "application/wasm" },
                        bodyBase64: "AGFzbQEAAAA=",
                        url,
                    });
                };
                const response = await fetch(new URL("/pkg/app_bg.wasm", document.URL));
                const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
                return { url: globalThis.__capturedFetchUrl, bytes };
            } finally {
                Deno.core.ops.op_fetch_url = originalFetchOp;
            }
        }"#,
        None,
        &[],
        true,
        true,
    ).await.unwrap();

    assert_eq!(
        result.value.unwrap(),
        serde_json::json!({
            "url": "http://example.com/pkg/app_bg.wasm",
            "bytes": [0, 97, 115, 109, 1, 0, 0, 0],
        })
    );
}

#[tokio::test(flavor = "current_thread")]
async fn test_response_array_buffer_preserves_typed_array_view() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.call_function_on_for_cdp(
        r#"async () => {
            const bytes = new Uint8Array([9, 0, 97, 115, 109, 1, 8]);
            const response = new Response(bytes.subarray(1, 6));
            return Array.from(new Uint8Array(await response.arrayBuffer()));
        }"#,
        None,
        &[],
        true,
        true,
    ).await.unwrap();

    assert_eq!(result.value.unwrap(), serde_json::json!([0, 97, 115, 109, 1]));
}

#[tokio::test(flavor = "current_thread")]
async fn test_wasm_instantiate_streaming_uses_response_array_buffer() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.call_function_on_for_cdp(
        r#"async () => {
            const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
            const result = await WebAssembly.instantiateStreaming(
                Promise.resolve(new Response(bytes)),
                {},
            );
            return result.instance instanceof WebAssembly.Instance;
        }"#,
        None,
        &[],
        true,
        true,
    ).await.unwrap();

    assert_eq!(result.value.unwrap(), serde_json::json!(true));
}

#[test]
fn test_text_decoder_respects_typed_array_view() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate(
        "new TextDecoder().decode(new Uint8Array([65, 66, 67]).subarray(1, 2))"
    ).unwrap();
    assert_eq!(result.as_str().unwrap(), "B");
}

#[test]
fn test_document_doctype() {
    let mut rt = setup_runtime("<!DOCTYPE html><html><body></body></html>");
    let result = rt.evaluate("document.doctype !== null").unwrap();
    assert_eq!(result, serde_json::json!(true));

    let name = rt.evaluate("document.doctype.name").unwrap();
    assert_eq!(name, serde_json::json!("html"));

    let node_type = rt.evaluate("document.doctype.nodeType").unwrap();
    assert_eq!(node_type.as_f64().unwrap() as i64, 10);
}

#[test]
fn test_document_doctype_null_when_missing() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let result = rt.evaluate("document.doctype === null").unwrap();
    assert_eq!(result, serde_json::json!(true));
}

#[test]
fn test_xml_serializer_doctype() {
    let mut rt = setup_runtime("<!DOCTYPE html><html><body></body></html>");
    let result = rt.evaluate(
        "new XMLSerializer().serializeToString(document.doctype)"
    ).unwrap();
    assert_eq!(result.as_str().unwrap(), "<!DOCTYPE html>");
}

#[test]
fn test_xml_serializer_element() {
    let mut rt = setup_runtime(r#"<html><body><div id="x">Hello</div></body></html>"#);
    let result = rt.evaluate(
        "new XMLSerializer().serializeToString(document.getElementById('x'))"
    ).unwrap();
    let html = result.as_str().unwrap();
    assert!(html.contains("<div"));
    assert!(html.contains("Hello"));
}

#[test]
fn test_create_event_custom_event_has_init_method() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let kind = rt
        .evaluate("typeof document.createEvent('CustomEvent').initCustomEvent")
        .unwrap();
    assert_eq!(kind, serde_json::json!("function"));
}

#[test]
fn test_init_custom_event_sets_fields() {
    let mut rt = setup_runtime("<html><body></body></html>");
    rt.execute_script(
        "test",
        r#"
        globalThis.__e = document.createEvent('CustomEvent');
        globalThis.__e.initCustomEvent('myevent', true, false, {hello: 'world'});
    "#,
    )
    .unwrap();
    let t = rt.evaluate("globalThis.__e.type").unwrap();
    assert_eq!(t, serde_json::json!("myevent"));
    let b = rt.evaluate("globalThis.__e.bubbles").unwrap();
    assert_eq!(b, serde_json::json!(true));
    let c = rt.evaluate("globalThis.__e.cancelable").unwrap();
    assert_eq!(c, serde_json::json!(false));
    let d = rt.evaluate("globalThis.__e.detail.hello").unwrap();
    assert_eq!(d, serde_json::json!("world"));
}

#[test]
fn test_create_event_returns_correct_class() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let cust = rt
        .evaluate("document.createEvent('CustomEvent') instanceof CustomEvent")
        .unwrap();
    assert_eq!(cust, serde_json::json!(true));
    let mouse = rt
        .evaluate("document.createEvent('MouseEvent') instanceof MouseEvent")
        .unwrap();
    assert_eq!(mouse, serde_json::json!(true));
    let mouses = rt
        .evaluate("document.createEvent('MouseEvents') instanceof MouseEvent")
        .unwrap();
    assert_eq!(mouses, serde_json::json!(true));
    let kb = rt
        .evaluate("document.createEvent('KeyboardEvent') instanceof KeyboardEvent")
        .unwrap();
    assert_eq!(kb, serde_json::json!(true));
}

#[test]
fn test_create_event_unknown_type_returns_event() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let kind = rt
        .evaluate("document.createEvent('NotARealType') instanceof Event")
        .unwrap();
    assert_eq!(kind, serde_json::json!(true));
}

#[test]
fn test_html_to_markdown_headings() {
    let mut rt = setup_runtime("<html><body><h1>Title</h1><h2>Sub</h2><p>Body</p></body></html>");
    let md = rt
        .evaluate(crate::HTML_TO_MARKDOWN_JS)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(md.contains("# Title"), "missing H1: {}", md);
    assert!(md.contains("## Sub"), "missing H2: {}", md);
    assert!(md.contains("Body"), "missing paragraph text: {}", md);
}

#[test]
fn test_html_to_markdown_links_and_inline() {
    let mut rt = setup_runtime(
        r#"<html><body><p>Hello <strong>world</strong> <a href="https://x.test/">link</a> <em>em</em></p></body></html>"#,
    );
    let md = rt
        .evaluate(crate::HTML_TO_MARKDOWN_JS)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(md.contains("**world**"), "missing strong: {}", md);
    assert!(md.contains("*em*"), "missing em: {}", md);
    assert!(
        md.contains("[link](https://x.test/)"),
        "missing link: {}",
        md
    );
}

#[test]
fn test_html_to_markdown_lists() {
    let mut rt = setup_runtime(
        "<html><body><ul><li>A</li><li>B</li></ul><ol><li>X</li><li>Y</li></ol></body></html>",
    );
    let md = rt
        .evaluate(crate::HTML_TO_MARKDOWN_JS)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(md.contains("- A"), "missing unordered A: {}", md);
    assert!(md.contains("- B"), "missing unordered B: {}", md);
    assert!(md.contains("1. X"), "missing ordered X: {}", md);
}

#[test]
fn test_html_to_markdown_skips_script_and_style() {
    let mut rt = setup_runtime(
        "<html><body><p>Text</p><script>alert(1)</script><style>body{color:red}</style></body></html>",
    );
    let md = rt
        .evaluate(crate::HTML_TO_MARKDOWN_JS)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    assert!(md.contains("Text"), "missing visible text: {}", md);
    assert!(!md.contains("alert"), "leaked script content: {}", md);
    assert!(!md.contains("color:red"), "leaked style content: {}", md);
}

#[test]
fn test_page_content_puppeteer_pattern() {
    let mut rt = setup_runtime("<!DOCTYPE html><html><head></head><body><p>Test</p></body></html>");
    let result = rt.evaluate(
        "(function() { let retVal = ''; if (document.doctype) retVal = new XMLSerializer().serializeToString(document.doctype); if (document.documentElement) retVal += document.documentElement.outerHTML; return retVal; })()"
    ).unwrap();
    let html = result.as_str().unwrap();
    assert!(html.starts_with("<!DOCTYPE html>"));
    assert!(html.contains("<html>"));
    assert!(html.contains("<p>Test</p>"));
}

#[test]
fn test_element_from_point_is_function() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let kind = rt.evaluate("typeof document.elementFromPoint").unwrap();
    assert_eq!(kind, serde_json::json!("function"));
    let kind2 = rt.evaluate("typeof document.elementsFromPoint").unwrap();
    assert_eq!(kind2, serde_json::json!("function"));
}

#[test]
fn test_element_from_point_in_viewport_returns_body() {
    let mut rt = setup_runtime("<html><body><h1>Hi</h1></body></html>");
    let tag = rt.evaluate("document.elementFromPoint(10, 10)?.tagName").unwrap();
    assert_eq!(tag, serde_json::json!("BODY"));
}

#[test]
fn test_element_from_point_out_of_viewport_returns_null() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let neg_x = rt.evaluate("document.elementFromPoint(-1, 10)").unwrap();
    assert_eq!(neg_x, serde_json::Value::Null);
    let neg_y = rt.evaluate("document.elementFromPoint(10, -1)").unwrap();
    assert_eq!(neg_y, serde_json::Value::Null);
    let huge = rt.evaluate("document.elementFromPoint(99999, 99999)").unwrap();
    assert_eq!(huge, serde_json::Value::Null);
}

#[test]
fn test_elements_from_point_returns_array() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let len_in = rt.evaluate("document.elementsFromPoint(10, 10).length").unwrap();
    assert_eq!(len_in.as_f64().unwrap() as i64, 1);
    let len_out = rt.evaluate("document.elementsFromPoint(-1, -1).length").unwrap();
    assert_eq!(len_out.as_f64().unwrap() as i64, 0);
}

#[test]
fn test_element_from_point_non_numeric_returns_null() {
    let mut rt = setup_runtime("<html><body></body></html>");
    let nan = rt.evaluate("document.elementFromPoint(NaN, 10)").unwrap();
    assert_eq!(nan, serde_json::Value::Null);
    let inf = rt.evaluate("document.elementFromPoint(Infinity, 10)").unwrap();
    assert_eq!(inf, serde_json::Value::Null);
}

// Issue #139 — proxy_url must thread through to both the ES-module
// loader (module_loader.rs) and op_fetch_url's reqwest client
// (ops.rs::build_request_client). Pre-fix both built clients with
// `Client::builder().build()` — no proxy — so JS fetch/XHR and
// dynamic imports silently bypassed BrowserContext.proxy_url.
//
// Phase 5.5 RED check: each test references a symbol that does NOT
// exist on main (proxy_url() accessor, with_proxy ctor,
// with_base_url_and_proxy ctor), so the tests fail to compile without
// the prod fix.
#[test]
fn http_client_round_trips_proxy_url() {
    use obscura_net::{CookieJar, ObscuraHttpClient};
    let jar = std::sync::Arc::new(CookieJar::new());
    let configured =
        ObscuraHttpClient::with_options(jar.clone(), Some("http://proxy.test:8080"));
    assert_eq!(
        configured.proxy_url(),
        Some("http://proxy.test:8080"),
        "proxy_url() must expose the value passed to with_options"
    );

    let direct = ObscuraHttpClient::with_options(jar, None);
    assert_eq!(
        direct.proxy_url(),
        None,
        "proxy_url() must return None when no proxy was configured"
    );
}

#[test]
fn module_loader_stores_proxy_for_dynamic_imports() {
    use crate::module_loader::ObscuraModuleLoader;
    let loader = ObscuraModuleLoader::with_proxy(
        "https://example.com/",
        Some("http://proxy.test:8080".to_string()),
    );
    assert_eq!(loader.proxy_url.as_deref(), Some("http://proxy.test:8080"));
    assert_eq!(loader.base_url, "https://example.com/");

    // Default constructor must keep the historical "no proxy" behaviour.
    let direct = ObscuraModuleLoader::new("https://example.com/");
    assert_eq!(direct.proxy_url, None);
}

#[test]
fn runtime_with_base_url_and_proxy_constructs_successfully() {
    // Sanity-check the public ctor that page.rs uses to thread proxy
    // through to the module loader. Direct (None) and proxied paths
    // must both initialise the JS environment.
    let _direct = ObscuraJsRuntime::with_base_url_and_proxy("https://example.com/", None);
    let _proxied = ObscuraJsRuntime::with_base_url_and_proxy(
        "https://example.com/",
        Some("http://proxy.test:8080".to_string()),
    );
}

// ── Issue #45 (Playwright actionability) regression tests ────────────────
// Kept at the end of the module so they don't share textual context with
// unrelated test additions in other branches (avoids spurious merge
// conflicts when both this branch and an unrelated bootstrap.js change
// add tests near the start of `mod tests`).

/// Playwright >= 1.25 calls `element.checkVisibility(...)` before every
/// input event. If the method isn't defined Playwright retries until its
/// action timeout fires. Without a layout engine we can't compute it
/// properly, so the stub always returns true — still strictly better
/// than the undefined path.
#[test]
fn element_check_visibility_is_callable() {
    let mut rt = setup_runtime(r#"<div id="x">x</div>"#);
    let result = rt
        .evaluate("document.getElementById('x').checkVisibility({checkOpacity: true})")
        .unwrap();
    assert_eq!(result, serde_json::json!(true));

    let typeof_method = rt
        .evaluate("typeof document.getElementById('x').checkVisibility")
        .unwrap();
    assert_eq!(typeof_method, serde_json::json!("function"));
}

/// Playwright's `getByRole` / `getByLabel` locators resolve via ARIA
/// reflection properties. Without the getters those locators always
/// fail. Reflect the underlying aria-* attributes.
#[test]
fn element_aria_reflection_properties_read_aria_attrs() {
    let mut rt = setup_runtime(
        r#"<button id="b" role="tab" aria-label="Settings" aria-selected="true">x</button>"#,
    );
    let result = rt
        .evaluate(
            r#"
            const el = document.getElementById('b');
            return [el.role, el.ariaLabel, el.ariaSelected];
            "#,
        )
        .unwrap();
    assert_eq!(result, serde_json::json!(["tab", "Settings", "true"]));
}

/// Setting an ARIA reflection property must write through to the
/// underlying attribute so frameworks that toggle state via
/// `el.ariaExpanded = 'true'` actually update the DOM.
/// Regression: React 18 / mobile SPAs (e.g. goofish.com) call
/// addEventListener on navigator.connection (NetworkInformation) and
/// navigator.serviceWorker (ServiceWorkerContainer). Both are EventTargets
/// in real browsers; missing the method crashed the app bundle with
/// "addEventListener is not a function".
#[test]
fn navigator_eventtarget_stubs_expose_add_event_listener() {
    let mut rt = setup_runtime("<div></div>");
    let result = rt
        .evaluate(
            r#"
            const connection = navigator.connection;
            let calls = 0;
            let receiverMatches = false;
            function listener(event) {
                calls += 1;
                receiverMatches = this === connection && event.type === 'change';
            }
            connection.addEventListener('change', listener);
            const dispatchResult = connection.dispatchEvent(new Event('change'));
            connection.removeEventListener('change', listener);
            connection.dispatchEvent(new Event('change'));
            return [
                typeof connection.addEventListener,
                typeof connection.removeEventListener,
                typeof connection.dispatchEvent,
                typeof navigator.serviceWorker.addEventListener,
                dispatchResult,
                calls,
                receiverMatches,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([
            "function", "function", "function", "function", true, 1, true
        ])
    );
}

/// Regression test for #285: DDoS-Guard's challenge calls
/// `t.insertAdjacentText(...)` and dies with `TypeError: ... is not a
/// function` because `Element.prototype.insertAdjacentText` was missing.
/// Verify all four positions place a Text node (NOT parsed HTML) at the
/// right spot. Tests `insertAdjacentText` exists, is callable, and that
/// inserted content remains literal text — angle brackets must not be
/// parsed as markup, which is the whole point of the API.
#[test]
fn element_insert_adjacent_text_polyfill() {
    let mut rt = setup_runtime(r#"<div id="p"><span id="t">X</span></div>"#);
    let result = rt
        .evaluate(
            r#"
            const t = document.getElementById('t');
            t.insertAdjacentText('afterbegin', 'AB');
            t.insertAdjacentText('beforeend', 'BE');
            t.insertAdjacentText('beforebegin', 'BB');
            t.insertAdjacentText('afterend', 'AE');
            t.insertAdjacentText('beforeend', '<b>raw</b>');
            return [
                typeof Element.prototype.insertAdjacentText,
                document.getElementById('p').textContent,
                t.getElementsByTagName('b').length,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!(["function", "BBABXBE<b>raw</b>AE", 0])
    );
}

/// Regression test for #285: `Element.prototype.insertAdjacentElement`
/// was missing alongside `insertAdjacentText`. Verify all four positions
/// place the given element correctly and that the inserted element is
/// returned (per spec — that's the contract callers rely on for chaining).
#[test]
fn element_insert_adjacent_element_polyfill() {
    let mut rt = setup_runtime(r#"<div id="p"><span id="t">X</span></div>"#);
    let result = rt
        .evaluate(
            r#"
            const t = document.getElementById('t');
            const before = document.createElement('b');  before.id = 'before';
            const after  = document.createElement('i');  after.id  = 'after';
            const inside = document.createElement('em'); inside.id = 'inside';
            const last   = document.createElement('u');  last.id   = 'last';
            const r1 = t.insertAdjacentElement('beforebegin', before);
            const r2 = t.insertAdjacentElement('afterend',    after);
            const r3 = t.insertAdjacentElement('afterbegin',  inside);
            const r4 = t.insertAdjacentElement('beforeend',   last);
            const siblings = Array.from(document.getElementById('p').children).map(c => c.id);
            const inT = Array.from(t.children).map(c => c.id);
            return [
                typeof Element.prototype.insertAdjacentElement,
                r1 === before && r2 === after && r3 === inside && r4 === last,
                siblings,
                inT,
            ];
            "#,
        )
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!([
            "function",
            true,
            ["before", "t", "after"],
            ["inside", "last"]
        ])
    );
}

#[test]
fn console_log_error_does_not_trigger_prepare_stack_trace() {
    let mut rt = setup_runtime("<div></div>");
    let result = rt.evaluate(r#"
        let called = false;
        const saved = Error.prepareStackTrace;
        Error.prepareStackTrace = function() { called = true; return saved; };
        const e = new Error("test");
        console.log(e);
        Error.prepareStackTrace = saved;
        return called;
    "#).unwrap();
    assert_eq!(result, serde_json::json!(false));
}

#[test]
fn element_aria_reflection_setters_write_through() {
    let mut rt = setup_runtime(r#"<div id="d"></div>"#);
    let result = rt
        .evaluate(
            r#"
            const el = document.getElementById('d');
            el.role = 'menu';
            el.ariaExpanded = 'true';
            return [el.getAttribute('role'), el.getAttribute('aria-expanded')];
            "#,
        )
        .unwrap();
    assert_eq!(result, serde_json::json!(["menu", "true"]));
}

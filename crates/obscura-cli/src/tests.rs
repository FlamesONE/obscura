use crate::cli::{Args, Command, DumpFormat};
use crate::commands::{
    fetch_original_bytes, read_urls_from_file, write_or_print, write_or_print_bytes,
};
use crate::dump::{extract_assets, extract_readable_text, link_kind_from_rel, resolve_asset_url};
use crate::{
    effective_v8_flags, is_quiet_command, merge_proxy, normalize_v8_flags, select_log_filter,
    DEFAULT_V8_FLAGS,
};
use clap::Parser;
use obscura_dom::parse_html;

// Issue #117 — `--dump original` short-circuits the browser stack and
// streams the raw response body verbatim, including for binary payloads.
//
// Two tests below pin the behaviour:
//   1. clap accepts `--dump original` as a valid DumpFormat variant.
//   2. `fetch_original_bytes` returns the exact bytes a `file://` URL
//      points at (binary-safe round-trip — no UTF-8 decode, no trailing
//      newline, no DOM mutation).
//   3. `write_or_print_bytes` writes raw bytes to a file without the
//      trailing newline that `println!` would add.
#[test]
fn parsed_fetch_dump_original_is_accepted_by_clap() {
    let args = Args::try_parse_from([
        "obscura",
        "fetch",
        "--dump",
        "original",
        "https://example.com/image.jpg",
    ])
    .expect("clap should accept --dump original");
    match args.command {
        Some(Command::Fetch { dump, .. }) => {
            assert_eq!(dump, Some(DumpFormat::Original));
        }
        _ => panic!("expected Fetch command"),
    }
}

// Issue #349 — batch mode: `fetch --file urls.txt --dump original
// --concurrency N` with no positional URL.
#[test]
fn parsed_fetch_file_and_concurrency() {
    let args = Args::try_parse_from([
        "obscura",
        "fetch",
        "--file",
        "urls.txt",
        "--dump",
        "original",
        "--concurrency",
        "25",
    ])
    .expect("clap should accept --file with --concurrency and no positional URL");
    match args.command {
        Some(Command::Fetch { url, file, concurrency, dump, .. }) => {
            assert!(url.is_none());
            assert_eq!(file, Some(std::path::PathBuf::from("urls.txt")));
            assert_eq!(concurrency.get(), 25);
            assert_eq!(dump, Some(DumpFormat::Original));
        }
        _ => panic!("expected Fetch command"),
    }
}

#[test]
fn concurrency_rejects_zero() {
    // NonZeroUsize means --concurrency 0 is a parse error, not a silent hang
    // on a zero-permit semaphore.
    let err = Args::try_parse_from(["obscura", "fetch", "--file", "u.txt", "--concurrency", "0"]);
    assert!(err.is_err());
}

#[test]
fn read_urls_skips_blanks_and_comments() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("obscura_urls_{}.txt", std::process::id()));
    std::fs::write(
        &path,
        "https://a.example/one.js\n\n  # a comment\n   https://b.example/two.css  \nhttps://c.example/three.json\n",
    )
    .unwrap();
    let urls = read_urls_from_file(&path).unwrap();
    std::fs::remove_file(&path).ok();
    assert_eq!(
        urls,
        vec![
            "https://a.example/one.js".to_string(),
            "https://b.example/two.css".to_string(),
            "https://c.example/three.json".to_string(),
        ]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn fetch_original_bytes_returns_file_contents_verbatim() {
    // A real binary payload: a 1×1 transparent PNG (89 50 4E 47 …) —
    // exactly the kind of resource #117 wants to stream without HTML/
    // JS rendering.
    const PNG_BYTES: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
        0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
        0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    let path = std::env::temp_dir().join(format!(
        "obscura-fetch-original-test-{}.png",
        std::process::id()
    ));
    let _ = tokio::fs::remove_file(&path).await;
    tokio::fs::write(&path, PNG_BYTES)
        .await
        .expect("seed temp PNG fixture");

    let file_url = format!("file://{}", path.display());
    let bytes = fetch_original_bytes(&file_url, None, None, 5)
        .await
        .expect("fetch_original_bytes should round-trip the file body");

    let _ = tokio::fs::remove_file(&path).await;

    assert_eq!(bytes, PNG_BYTES, "raw response body must match the file byte-for-byte");
}

#[tokio::test(flavor = "current_thread")]
async fn write_or_print_bytes_writes_without_trailing_newline() {
    // Regression guard for #117: stdout must receive raw bytes. The file
    // path used here exercises the file-output branch — println!-style
    // output (used by write_or_print) would append a 0x0A byte and
    // corrupt binary payloads. write_or_print_bytes must not.
    let payload: &[u8] = &[0x00, 0xFF, b'h', b'i', 0x00];
    let path = std::env::temp_dir().join(format!(
        "obscura-write-bytes-test-{}.bin",
        std::process::id()
    ));
    let _ = tokio::fs::remove_file(&path).await;

    write_or_print_bytes(payload, Some(&path))
        .await
        .expect("write_or_print_bytes should write the file");

    let read_back = tokio::fs::read(&path).await.expect("read back");
    let _ = tokio::fs::remove_file(&path).await;

    assert_eq!(read_back, payload, "file bytes must match the payload exactly");
}

#[tokio::test(flavor = "current_thread")]
async fn write_or_print_writes_output_file_with_tokio_fs() {
    let path = std::env::temp_dir().join(format!(
        "obscura-fetch-output-test-{}.txt",
        std::process::id()
    ));
    let _ = tokio::fs::remove_file(&path).await;

    write_or_print("rendered output".to_string(), Some(&path))
        .await
        .expect("write output file");

    let content = tokio::fs::read_to_string(&path)
        .await
        .expect("read output file");
    let _ = tokio::fs::remove_file(&path).await;

    assert_eq!(content, "rendered output");
}

#[test]
fn default_filter_is_warn() {
    assert_eq!(select_log_filter(false, false), "warn");
}

#[test]
fn verbose_filter_is_debug() {
    assert_eq!(select_log_filter(true, false), "debug");
}

#[test]
fn quiet_filter_is_off() {
    assert_eq!(select_log_filter(false, true), "off");
}

#[test]
fn verbose_wins_over_quiet() {
    assert_eq!(select_log_filter(true, true), "debug");
}

#[test]
fn parsed_fetch_with_quiet_flag_is_detected() {
    let args = Args::try_parse_from([
        "obscura",
        "fetch",
        "--quiet",
        "https://example.com",
    ])
    .expect("clap should accept --quiet on fetch");
    assert!(is_quiet_command(&args.command));
}

#[test]
fn parsed_fetch_without_quiet_is_not_detected() {
    let args = Args::try_parse_from(["obscura", "fetch", "https://example.com"])
        .expect("clap should accept fetch without --quiet");
    assert!(!is_quiet_command(&args.command));
}

#[test]
fn parsed_serve_command_is_not_quiet() {
    let args = Args::try_parse_from(["obscura", "serve"])
        .expect("clap should accept serve");
    assert!(!is_quiet_command(&args.command));
}

#[test]
fn no_subcommand_is_not_quiet() {
    assert!(!is_quiet_command(&None));
}

#[test]
fn parsed_v8_flags_global_arg() {
    let args = Args::try_parse_from([
        "obscura",
        "--v8-flags",
        "--max-old-space-size=4096 --max-semi-space-size=64",
        "fetch",
        "https://example.com",
    ])
    .expect("clap should accept --v8-flags as a global arg");
    assert_eq!(
        args.v8_flags.as_deref(),
        Some("--max-old-space-size=4096 --max-semi-space-size=64"),
    );
}

#[test]
fn v8_flags_default_is_none() {
    let args = Args::try_parse_from(["obscura", "fetch", "https://example.com"])
        .expect("clap should accept fetch without --v8-flags");
    assert!(args.v8_flags.is_none());
}

#[test]
fn parsed_v8_flags_with_serve_subcommand() {
    let args = Args::try_parse_from([
        "obscura",
        "--v8-flags",
        "--max-old-space-size=2048",
        "serve",
        "--port",
        "9333",
    ])
    .expect("clap should accept --v8-flags with serve");
    assert_eq!(args.v8_flags.as_deref(), Some("--max-old-space-size=2048"));
}

#[test]
fn parsed_v8_flags_with_scrape_subcommand() {
    let args = Args::try_parse_from([
        "obscura",
        "--v8-flags",
        "--expose-gc",
        "scrape",
        "https://a.com",
        "https://b.com",
    ])
    .expect("clap should accept --v8-flags with scrape");
    assert_eq!(args.v8_flags.as_deref(), Some("--expose-gc"));
}

#[test]
fn parsed_v8_flags_empty_string_is_accepted() {
    let args = Args::try_parse_from([
        "obscura",
        "--v8-flags",
        "",
        "fetch",
        "https://example.com",
    ])
    .expect("clap should accept empty --v8-flags value");
    assert_eq!(args.v8_flags.as_deref(), Some(""));
}

#[test]
fn normalize_v8_flags_returns_none_when_unset() {
    assert_eq!(normalize_v8_flags(None), None);
}

#[test]
fn normalize_v8_flags_returns_none_for_empty_or_whitespace() {
    assert_eq!(normalize_v8_flags(Some("")), None);
    assert_eq!(normalize_v8_flags(Some("   ")), None);
    assert_eq!(normalize_v8_flags(Some("\t\n")), None);
}

#[test]
fn normalize_v8_flags_trims_surrounding_whitespace() {
    assert_eq!(
        normalize_v8_flags(Some("  --max-old-space-size=4096  ")).as_deref(),
        Some("--max-old-space-size=4096"),
    );
}

#[test]
fn normalize_v8_flags_preserves_multi_flag_string() {
    let input = "--max-old-space-size=4096 --max-semi-space-size=64 --expose-gc";
    assert_eq!(normalize_v8_flags(Some(input)).as_deref(), Some(input));
}

#[test]
fn effective_v8_flags_returns_default_when_unset() {
    assert_eq!(effective_v8_flags(None), DEFAULT_V8_FLAGS);
    assert_eq!(effective_v8_flags(Some("")), DEFAULT_V8_FLAGS);
    assert_eq!(effective_v8_flags(Some("   ")), DEFAULT_V8_FLAGS);
}

#[test]
fn effective_v8_flags_user_overrides_default() {
    // V8 parses left-to-right and later wins, so the user value must
    // come after the default in the merged string.
    let user = "--max-old-space-size=8192";
    let merged = effective_v8_flags(Some(user));
    assert!(merged.starts_with(DEFAULT_V8_FLAGS));
    assert!(merged.ends_with(user));
}

#[test]
fn effective_v8_flags_appends_user_extras() {
    let merged = effective_v8_flags(Some("--expose-gc"));
    assert!(merged.contains(DEFAULT_V8_FLAGS));
    assert!(merged.contains("--expose-gc"));
}

#[test]
fn parsed_fetch_quiet_resolves_to_off_filter() {
    let args = Args::try_parse_from([
        "obscura",
        "fetch",
        "--quiet",
        "https://example.com",
    ])
    .unwrap();
    let filter = select_log_filter(args.verbose, is_quiet_command(&args.command));
    assert_eq!(filter, "off");
}

#[test]
fn matcher_still_uses_fetch_variant() {
    let cmd = Some(Command::Fetch {
        url: Some("https://x".to_string()),
        dump: Some(DumpFormat::Html),
        selector: None,
        file: None,
        concurrency: std::num::NonZeroUsize::new(1).unwrap(),
        wait: 5,
        timeout: 30,
        wait_until: "load".to_string(),
        user_agent: None,
        eval: None,
        quiet: true,
        output: None,
        storage_dir: None,
    });
    assert!(is_quiet_command(&cmd));
}

fn body_text(html: &str) -> String {
    let dom = parse_html(html);
    let body = dom
        .query_selector("body")
        .ok()
        .flatten()
        .expect("body must exist");
    extract_readable_text(&dom, body).split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn skips_nav_header_footer_aside() {
    let text = body_text(
        r#"<html><body>
            <header>SITE HEADER</header>
            <nav>NAV LINKS</nav>
            <aside>SIDEBAR</aside>
            <main><p>Article body.</p></main>
            <footer>FOOTER</footer>
        </body></html>"#,
    );
    assert!(text.contains("Article body."), "main content kept: {text}");
    for boilerplate in ["SITE HEADER", "NAV LINKS", "SIDEBAR", "FOOTER"] {
        assert!(
            !text.contains(boilerplate),
            "boilerplate '{boilerplate}' leaked through: {text}"
        );
    }
}

#[test]
fn still_skips_script_and_style() {
    // Regression guard for the original skip list.
    let text = body_text(
        r#"<html><body>
            <p>Hello.</p>
            <script>console.log("nope")</script>
            <style>.x { color: red }</style>
        </body></html>"#,
    );
    assert!(text.contains("Hello."));
    assert!(!text.contains("console.log"));
    assert!(!text.contains("color: red"));
}

#[test]
fn command_proxy_overrides_global_proxy() {
    let proxy = merge_proxy(
        Some("http://global.example:8080".to_string()),
        Some("socks5://127.0.0.1:1080".to_string()),
    );

    assert_eq!(proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
}

#[test]
fn global_proxy_is_used_when_command_proxy_is_absent() {
    let proxy = merge_proxy(Some("http://global.example:8080".to_string()), None);

    assert_eq!(proxy.as_deref(), Some("http://global.example:8080"));
}

#[test]
fn parsed_fetch_dump_assets_is_accepted_by_clap() {
    let args = Args::try_parse_from([
        "obscura",
        "fetch",
        "--dump",
        "assets",
        "https://example.com",
    ])
    .expect("clap should accept --dump assets");
    match args.command {
        Some(Command::Fetch { dump, .. }) => {
            assert_eq!(dump, Some(DumpFormat::Assets));
        }
        _ => panic!("expected Fetch command"),
    }
}

#[test]
fn resolve_asset_url_keeps_absolute_unchanged() {
    let base = url::Url::parse("https://page.test/a/b").unwrap();
    let abs = "https://cdn.test/x.js";
    assert_eq!(resolve_asset_url(abs, Some(&base)).as_deref(), Some(abs));
}

#[test]
fn resolve_asset_url_joins_relative_against_base() {
    let base = url::Url::parse("https://page.test/a/b").unwrap();
    let rel = "/static/x.js";
    assert_eq!(
        resolve_asset_url(rel, Some(&base)).as_deref(),
        Some("https://page.test/static/x.js"),
    );
}

#[test]
fn resolve_asset_url_drops_empty() {
    let base = url::Url::parse("https://page.test/").unwrap();
    assert!(resolve_asset_url("", Some(&base)).is_none());
    assert!(resolve_asset_url("   ", Some(&base)).is_none());
}

#[test]
fn link_kind_from_rel_handles_common_values() {
    assert_eq!(link_kind_from_rel("stylesheet"), "stylesheet");
    assert_eq!(link_kind_from_rel("icon"), "icon");
    // First token wins for multi-token rel (e.g. "shortcut icon").
    assert_eq!(link_kind_from_rel("shortcut icon"), "icon");
    assert_eq!(link_kind_from_rel("manifest"), "manifest");
    assert_eq!(link_kind_from_rel("preload"), "preload");
    assert_eq!(link_kind_from_rel("prefetch"), "prefetch");
    assert_eq!(link_kind_from_rel("modulepreload"), "modulepreload");
    assert_eq!(link_kind_from_rel("dns-prefetch"), "dns-prefetch");
    assert_eq!(link_kind_from_rel("preconnect"), "preconnect");
    assert_eq!(link_kind_from_rel("alternate"), "alternate");
    // Empty / unknown falls back to generic "link" so URL is still emitted.
    assert_eq!(link_kind_from_rel(""), "link");
    assert_eq!(link_kind_from_rel("noopener"), "link");
}

#[test]
fn extract_assets_covers_every_resource_tag() {
    let html = r#"<html><head>
        <link rel="stylesheet" href="/site.css">
        <link rel="icon" href="/favicon.ico">
        <link rel="preload" href="/font.woff2">
        <link href="/no-rel.css">
        <script src="/app.js"></script>
    </head><body>
        <img src="/logo.png">
        <iframe src="/frame.html"></iframe>
        <video src="/clip.mp4"><source src="/clip.webm"></video>
        <audio src="/track.mp3"></audio>
        <embed src="/widget.swf">
        <object data="/doc.pdf"></object>
    </body></html>"#;
    let dom = obscura_dom::parse_html(html);
    let base = url::Url::parse("https://example.test/page").unwrap();
    let ndjson = extract_assets(&dom, Some(&base));
    let records: Vec<serde_json::Value> = ndjson
        .lines()
        .map(|line| serde_json::from_str(line).expect("each line must be valid JSON"))
        .collect();

    // Every emitted record must have an absolute URL on example.test
    // and a non-empty type string. Pin specific entries so a regression
    // in selectors or kind mapping fails loudly.
    for r in &records {
        let url = r["url"].as_str().unwrap();
        assert!(
            url.starts_with("https://example.test/"),
            "url not absolute: {url}",
        );
        assert!(!r["type"].as_str().unwrap().is_empty());
    }

    let pairs: Vec<(String, String)> = records
        .iter()
        .map(|r| {
            (
                r["url"].as_str().unwrap().to_string(),
                r["type"].as_str().unwrap().to_string(),
            )
        })
        .collect();

    assert!(pairs.contains(&(
        "https://example.test/app.js".to_string(),
        "script".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/site.css".to_string(),
        "stylesheet".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/favicon.ico".to_string(),
        "icon".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/font.woff2".to_string(),
        "preload".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/no-rel.css".to_string(),
        "link".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/logo.png".to_string(),
        "image".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/frame.html".to_string(),
        "iframe".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/clip.mp4".to_string(),
        "video".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/clip.webm".to_string(),
        "media".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/track.mp3".to_string(),
        "audio".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/widget.swf".to_string(),
        "embed".to_string(),
    )));
    assert!(pairs.contains(&(
        "https://example.test/doc.pdf".to_string(),
        "object".to_string(),
    )));
}

#[test]
fn extract_assets_skips_empty_attributes() {
    let html = r#"<html><body>
        <script src=""></script>
        <img src="   ">
        <iframe src="/ok.html"></iframe>
    </body></html>"#;
    let dom = obscura_dom::parse_html(html);
    let base = url::Url::parse("https://example.test/").unwrap();
    let ndjson = extract_assets(&dom, Some(&base));
    let lines: Vec<&str> = ndjson.lines().collect();
    // Only the iframe with a non-empty src survives.
    assert_eq!(lines.len(), 1, "got {lines:?}");
    assert!(lines[0].contains("\"https://example.test/ok.html\""));
    assert!(lines[0].contains("\"iframe\""));
}

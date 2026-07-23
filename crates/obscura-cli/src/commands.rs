use std::sync::Arc;
use std::time::Instant;

use obscura_browser::{BrowserContext, Page};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

use crate::cli::DumpFormat;
use crate::dump::{dump_assets, dump_cookies, dump_html, dump_links, dump_markdown, dump_text};

pub(crate) async fn run_multi_worker_serve(
    port: u16,
    host: String,
    workers: u16,
    proxy: Option<String>,
    stealth: bool,
    user_agent: Option<String>,
) -> anyhow::Result<()> {
    use tokio::net::TcpListener;
    use tokio::io::AsyncWriteExt as _;

    let exe = std::env::current_exe()?;
    let mut children = Vec::new();

    for i in 0..workers {
        let worker_port = port + 1 + i;
        let mut cmd = std::process::Command::new(&exe);
        cmd.arg("serve").arg("--port").arg(worker_port.to_string());
        if let Some(ref p) = proxy {
            // Pass the proxy (which may embed credentials) via the environment,
            // not argv. A --proxy flag is visible in `ps`/`/proc/<pid>/cmdline`
            // to any local user; OBSCURA_PROXY is only readable by the owner
            // (issue #366). The worker's serve path reads this env as a fallback.
            cmd.env("OBSCURA_PROXY", p);
        }
        if let Some(ref ua) = user_agent {
            cmd.arg("--user-agent").arg(ua);
        }
        if stealth {
            cmd.arg("--stealth");
        }
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        let child = cmd.spawn()?;
        tracing::info!("Worker {} on port {}", i + 1, worker_port);
        children.push(child);
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Bind the load balancer to the requested host, not hardcoded loopback.
    // With --host 0.0.0.0 (e.g. in Docker) the single-worker path already binds
    // all interfaces; the multi-worker balancer must too, or the mapped port is
    // refused from outside the container (issue #336). Workers stay on loopback
    // and are only reached by the balancer.
    let listener = TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!("Load balancer on {}:{}, {} workers", host, port, workers);

    let mut next_worker: u16 = 0;

    loop {
        let (client_stream, peer_addr) = listener.accept().await?;
        let worker_port = port + 1 + (next_worker % workers);
        next_worker = next_worker.wrapping_add(1);

        tracing::debug!("Routing {} to worker port {}", peer_addr, worker_port);

        let mut peek_buf = [0u8; 4];
        client_stream.peek(&mut peek_buf).await?;

        if &peek_buf == b"GET " {
            let mut full_peek = [0u8; 256];
            let n = client_stream.peek(&mut full_peek).await?;
            let request_line = String::from_utf8_lossy(&full_peek[..n]);

            if request_line.contains("/json") {
                let worker_addr = format!("127.0.0.1:{}", worker_port);
                match tokio::net::TcpStream::connect(&worker_addr).await {
                    Ok(mut worker_stream) => {
                        tokio::spawn(async move {
                            let std_stream = match client_stream.into_std() {
                                Ok(s) => s,
                                Err(e) => {
                                    tracing::error!(
                                        "/json: failed to convert client to std stream: {}",
                                        e
                                    );
                                    return;
                                }
                            };
                            let mut client = match tokio::net::TcpStream::from_std(std_stream) {
                                Ok(c) => c,
                                Err(e) => {
                                    tracing::error!(
                                        "/json: failed to recreate tokio TcpStream: {}",
                                        e
                                    );
                                    return;
                                }
                            };
                            let _ = tokio::io::copy_bidirectional(
                                &mut client,
                                &mut worker_stream,
                            )
                            .await;
                        });
                    }
                    Err(e) => {
                        tracing::warn!("/json worker {} unreachable: {}", worker_addr, e);
                        tokio::spawn(async move {
                            let mut s = client_stream;
                            let _ = s
                                .write_all(
                                    b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n",
                                )
                                .await;
                            let _ = s.shutdown().await;
                        });
                    }
                }
                continue;
            }
        }

        let worker_addr = format!("127.0.0.1:{}", worker_port);
        tokio::spawn(async move {
            match tokio::net::TcpStream::connect(&worker_addr).await {
                Ok(mut worker_stream) => {
                    let mut client = client_stream;
                    let _ =
                        tokio::io::copy_bidirectional(&mut client, &mut worker_stream).await;
                }
                Err(e) => {
                    tracing::warn!("worker {} unreachable: {}", worker_addr, e);
                    let mut s = client_stream;
                    let _ = s
                        .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                        .await;
                    let _ = s.shutdown().await;
                }
            }
        });
    }
}

pub(crate) async fn run_fetch(
    url_str: &str,
    dump: Option<DumpFormat>,
    selector: Option<String>,
    wait_secs: u64,
    timeout_secs: u64,
    wait_until: &str,
    user_agent: Option<String>,
    stealth: bool,
    eval: Option<String>,
    output: Option<std::path::PathBuf>,
    quiet: bool,
    proxy: Option<String>,
    storage_dir: Option<std::path::PathBuf>,
    allow_private_network: bool,
) -> anyhow::Result<()> {
    // Whether the user explicitly passed --dump. With --eval also present this
    // decides whether we return the eval value or read the page after the
    // eval's async work settles (issue #248).
    let dump_specified = dump.is_some();
    let dump = dump.unwrap_or(DumpFormat::Html);

    // --dump original short-circuits the browser stack entirely: fetch the raw
    // response body via HTTP and stream the bytes verbatim. Useful for binary
    // payloads (images, fonts, …) and any non-HTML resource where parsing the
    // body through the DOM/JS layer would corrupt or discard data.
    if dump == DumpFormat::Original {
        let bytes = fetch_original_bytes(
            url_str,
            proxy,
            user_agent.clone(),
            timeout_secs,
        )
        .await?;
        write_or_print_bytes(&bytes, output.as_ref()).await?;
        return Ok(());
    }

    let context = Arc::new(BrowserContext::with_storage_and_network(
        "fetch".to_string(),
        proxy,
        stealth,
        user_agent.clone(),
        storage_dir.clone(),
        allow_private_network,
    ));
    let mut page = Page::new("fetch-page".to_string(), context.clone());

    if let Some(ref ua) = user_agent {
        page.http_client.set_user_agent(ua).await;
    }

    let wait_condition = obscura_browser::lifecycle::WaitUntil::from_str(wait_until);

    if !quiet {
        eprintln!("Fetching {}...", url_str);
    }

    // Process-level hard deadline. A synchronous hang inside a Rust op invoked
    // from page JS cannot be cancelled by tokio (there is no await to interrupt)
    // nor by the V8 watchdog (terminate_execution only unwinds JS bytecode, not
    // native Rust running beneath a V8->op call). As an absolute backstop so one
    // fetch can never wedge the worker, a daemon thread force-exits if the whole
    // operation overruns timeout + wait + grace. A normal fetch returns first and
    // the process exits before this fires.
    {
        let hard = Duration::from_secs(timeout_secs.saturating_add(wait_secs).saturating_add(10));
        std::thread::spawn(move || {
            std::thread::sleep(hard);
            eprintln!("obscura: hard timeout exceeded ({}s); forcing exit", hard.as_secs());
            std::process::exit(124);
        });
    }

    match timeout(Duration::from_secs(timeout_secs), page.navigate_with_wait(url_str, wait_condition)).await {
        Ok(result) => result.map_err(|e| anyhow::anyhow!("Failed to navigate to {}: {}", url_str, e))?,
        Err(_) => anyhow::bail!(
            "Timed out navigating to {} after {}s",
            url_str,
            timeout_secs
        ),
    }

    if !quiet {
        eprintln!("Page loaded: {} - \"{}\"", page.url_string(), page.title);
    }

    // --wait is a post-load settle: drive the event loop so timers, async work,
    // and completion callbacks (e.g. testharness's add_completion_callback) run
    // before we read the page. Returns early once the loop is idle, so static
    // pages stay fast.
    page.settle(wait_secs.saturating_mul(1000)).await;

    if let Some(ref expr) = eval {
        // Bound the eval by the same budget as navigation so a runaway
        // expression (infinite loop, never-settling sync work) cannot hang.
        let result = page.evaluate_with_timeout(expr, Duration::from_secs(timeout_secs));

        // A bare --eval (no --selector, no --dump) returns the eval value
        // directly, so synchronous expressions (JSON.stringify, ...) are
        // unchanged.
        if !dump_specified && selector.is_none() {
            let rendered = match result {
                serde_json::Value::String(s) => s,
                serde_json::Value::Null => "null".to_string(),
                other => other.to_string(),
            };
            write_or_print(rendered, output.as_ref()).await?;
            context.save_cookies();
            return Ok(());
        }

        // --eval combined with --selector and/or --dump: the eval typically
        // kicks off async work (a fetch promise, a timer) that writes the DOM.
        // Drive the event loop again so that work completes, then fall through
        // to the selector wait and the dump path instead of returning the
        // still-pending eval value (issue #248).
        page.settle(wait_secs.saturating_mul(1000)).await;
    }

    if let Some(ref sel) = selector {
        let found = wait_for_selector(&mut page, sel, wait_secs).await;
        if !found {
            eprintln!("Warning: selector '{}' not found after {}s", sel, wait_secs);
        }
    }

    let rendered = match dump {
        DumpFormat::Html => dump_html(&page),
        DumpFormat::Text => dump_text(&mut page),
        DumpFormat::Links => dump_links(&page),
        DumpFormat::Markdown => dump_markdown(&mut page),
        DumpFormat::Assets => dump_assets(&page),
        DumpFormat::Cookies => dump_cookies(&page),
        // Handled above via the short-circuit branch; unreachable here.
        DumpFormat::Original => unreachable!("Original dump handled before page navigation"),
    };
    write_or_print(rendered, output.as_ref()).await?;

    // Save cookies to disk if storage_dir is configured
    context.save_cookies();

    Ok(())
}

async fn fetch_original_response(
    url_str: &str,
    proxy: Option<String>,
    user_agent: Option<String>,
    timeout_secs: u64,
) -> anyhow::Result<obscura_net::Response> {
    let url = url::Url::parse(url_str)
        .map_err(|e| anyhow::anyhow!("Invalid URL '{}': {}", url_str, e))?;

    let client = obscura_net::ObscuraHttpClient::with_options(
        Arc::new(obscura_net::CookieJar::new()),
        proxy.as_deref(),
    );
    if let Some(ua) = user_agent {
        client.set_user_agent(&ua).await;
    }

    match timeout(Duration::from_secs(timeout_secs), client.fetch(&url)).await {
        Ok(Ok(resp)) => Ok(resp),
        Ok(Err(e)) => anyhow::bail!("Failed to fetch {}: {}", url_str, e),
        Err(_) => anyhow::bail!("Timed out fetching {} after {}s", url_str, timeout_secs),
    }
}

pub(crate) async fn fetch_original_bytes(
    url_str: &str,
    proxy: Option<String>,
    user_agent: Option<String>,
    timeout_secs: u64,
) -> anyhow::Result<Vec<u8>> {
    Ok(fetch_original_response(url_str, proxy, user_agent, timeout_secs).await?.body)
}

/// Read newline-delimited URLs from `path` (or stdin when `path` is `-`).
/// Blank lines and `#` comments are dropped, and surrounding whitespace is
/// trimmed so a list copy-pasted with indentation still works.
pub(crate) fn read_urls_from_file(path: &std::path::Path) -> anyhow::Result<Vec<String>> {
    let content = if path == std::path::Path::new("-") {
        use std::io::Read;
        let mut s = String::new();
        std::io::stdin()
            .read_to_string(&mut s)
            .map_err(|e| anyhow::anyhow!("Failed to read URLs from stdin: {}", e))?;
        s
    } else {
        std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("Failed to read {}: {}", path.display(), e))?
    };

    Ok(content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(String::from)
        .collect())
}

/// Batch raw fetch: run `--dump original` over many URLs concurrently and print
/// one JSON status line per URL (issue #349). This is the raw-resource-check
/// counterpart to `scrape`; it never renders, so there is no browser/JS cost
/// per URL. Output stays in input order regardless of completion order.
pub(crate) async fn run_batch_fetch(
    urls: Vec<String>,
    concurrency: usize,
    timeout_secs: u64,
    user_agent: Option<String>,
    proxy: Option<String>,
    output: Option<std::path::PathBuf>,
    quiet: bool,
) -> anyhow::Result<()> {
    let total = urls.len();
    if total == 0 {
        anyhow::bail!("No URLs to fetch (--file was empty).");
    }

    if !quiet {
        eprintln!(
            "Fetching {} URLs with {} concurrent request(s) (per-fetch timeout: {}s)...",
            total, concurrency, timeout_secs
        );
    }

    let start = Instant::now();
    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let user_agent = Arc::new(user_agent);
    let proxy = Arc::new(proxy);

    let mut handles = Vec::with_capacity(total);
    for (i, url) in urls.into_iter().enumerate() {
        let sem = semaphore.clone();
        let user_agent = user_agent.clone();
        let proxy = proxy.clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let task_start = Instant::now();
            let result =
                fetch_original_response(&url, (*proxy).clone(), (*user_agent).clone(), timeout_secs)
                    .await;
            let elapsed_ms = task_start.elapsed().as_millis();

            let line = match result {
                Ok(resp) => serde_json::json!({
                    "url": url,
                    "ok": (200..400).contains(&resp.status),
                    "status": resp.status,
                    "content_type": resp.headers.get("content-type").cloned().unwrap_or_default(),
                    "bytes": resp.body.len(),
                    "elapsed_ms": elapsed_ms,
                }),
                Err(e) => serde_json::json!({
                    "url": url,
                    "ok": false,
                    "error": e.to_string(),
                    "elapsed_ms": elapsed_ms,
                }),
            };
            (i, line)
        }));
    }

    let mut results: Vec<Option<serde_json::Value>> = vec![None; total];
    let mut failures = 0usize;
    for handle in handles {
        if let Ok((i, line)) = handle.await {
            if !line["ok"].as_bool().unwrap_or(false) {
                failures += 1;
            }
            results[i] = Some(line);
        } else {
            failures += 1;
        }
    }

    let mut out = String::new();
    for line in results.into_iter().flatten() {
        out.push_str(&serde_json::to_string(&line).unwrap_or_default());
        out.push('\n');
    }

    if let Some(path) = output {
        tokio::fs::write(&path, out.as_bytes())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        let mut stdout = tokio::io::stdout();
        stdout
            .write_all(out.as_bytes())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write to stdout: {}", e))?;
        stdout
            .flush()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to flush stdout: {}", e))?;
    }

    if !quiet {
        eprintln!(
            "Done: {} URLs in {:.1}s ({} ok, {} failed).",
            total,
            start.elapsed().as_secs_f64(),
            total - failures,
            failures
        );
    }

    Ok(())
}

pub(crate) async fn write_or_print(content: String, output: Option<&std::path::PathBuf>) -> anyhow::Result<()> {
    if let Some(path) = output {
        tokio::fs::write(path, content)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        println!("{}", content);
    }
    Ok(())
}

pub(crate) async fn write_or_print_bytes(
    bytes: &[u8],
    output: Option<&std::path::PathBuf>,
) -> anyhow::Result<()> {
    if let Some(path) = output {
        tokio::fs::write(path, bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write {}: {}", path.display(), e))?;
    } else {
        // Write raw bytes to stdout — never println! (would append a newline
        // and break binary payloads like JPEG/PNG).
        let mut stdout = tokio::io::stdout();
        stdout
            .write_all(bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write to stdout: {}", e))?;
        stdout
            .flush()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to flush stdout: {}", e))?;
    }
    Ok(())
}

async fn wait_for_selector(page: &mut Page, selector: &str, timeout_secs: u64) -> bool {
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_secs);
    loop {
        let found = page.with_dom(|dom| {
            dom.query_selector(selector).ok().flatten().is_some()
        }).unwrap_or(false);

        if found {
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

pub(crate) async fn run_parallel_scrape(
    urls: Vec<String>,
    eval: Option<String>,
    concurrency: usize,
    format: &str,
    timeout_secs: u64,
    quiet: bool,
    proxy: Option<String>,
    stealth: bool,
) -> anyhow::Result<()> {
    let total = urls.len();
    let start = Instant::now();

    if total == 0 {
        anyhow::bail!("No URLs provided. Pass at least one URL to scrape.");
    }

    if !quiet {
        eprintln!(
            "Scraping {} URLs with {} concurrent workers (per-worker timeout: {}s)...",
            total, concurrency, timeout_secs
        );
    }

    let worker_name = if cfg!(windows) { "obscura-worker.exe" } else { "obscura-worker" };
    let worker_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(worker_name)))
        .unwrap_or_else(|| std::path::PathBuf::from(worker_name));

    if !worker_path.exists() {
        anyhow::bail!(
            "Worker binary not found at {}. Build with: cargo build --release",
            worker_path.display()
        );
    }

    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let eval = Arc::new(eval);
    let worker_path = Arc::new(worker_path);
    let worker_timeout = Duration::from_secs(timeout_secs);
    let read_timeout = Duration::from_secs(timeout_secs.min(30));
    let shutdown_timeout = Duration::from_secs(5);

    let mut handles = Vec::new();

    for (i, url) in urls.into_iter().enumerate() {
        let sem = semaphore.clone();
        let eval = eval.clone();
        let worker_path = worker_path.clone();
        let proxy = proxy.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let task_start = Instant::now();

            let mut child = match TokioCommand::new(worker_path.as_ref())
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .env("OBSCURA_PROXY", proxy.as_deref().unwrap_or(""))
                .env("OBSCURA_STEALTH", if stealth { "1" } else { "" })
                .spawn()
            {
                Ok(c) => c,
                Err(e) => {
                    return serde_json::json!({
                        "url": url,
                        "error": format!("Failed to spawn worker: {}", e),
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                }
            };

            let mut stdin = match child.stdin.take() {
                Some(stdin) => stdin,
                None => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    return serde_json::json!({
                        "url": url,
                        "error": "Failed to open worker stdin",
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                }
            };
            let stdout = match child.stdout.take() {
                Some(stdout) => stdout,
                None => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    return serde_json::json!({
                        "url": url,
                        "error": "Failed to open worker stdout",
                        "time_ms": task_start.elapsed().as_millis(),
                    });
                }
            };
            let mut reader = BufReader::new(stdout);

            let worker_result: Result<serde_json::Value, String> = match timeout(worker_timeout, async {
                let nav_cmd = serde_json::json!({"cmd": "navigate", "url": url});
                let mut line = serde_json::to_string(&nav_cmd).unwrap();
                line.push('\n');
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    return Err("Write failed".to_string());
                }
                if stdin.flush().await.is_err() {
                    return Err("Write failed".to_string());
                }

                let mut resp_line = String::new();
                match timeout(read_timeout, reader.read_line(&mut resp_line)).await {
                    Ok(Ok(bytes)) if bytes > 0 => {}
                    Ok(Ok(_)) | Ok(Err(_)) => return Err("Read failed".to_string()),
                    Err(_) => return Err("timeout".to_string()),
                };

                let nav_resp: serde_json::Value =
                    serde_json::from_str(resp_line.trim()).unwrap_or(serde_json::json!({"ok": false}));

                if !nav_resp["ok"].as_bool().unwrap_or(false) {
                    return Err(
                        nav_resp["error"]
                            .as_str()
                            .unwrap_or("navigate failed")
                            .to_string(),
                    );
                }

                let title = nav_resp["result"]["title"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();

                let eval_result = if let Some(ref expr) = *eval {
                    let eval_cmd = serde_json::json!({"cmd": "evaluate", "expression": expr});
                    let mut line = serde_json::to_string(&eval_cmd).unwrap();
                    line.push('\n');
                    if stdin.write_all(line.as_bytes()).await.is_err() {
                        return Err("Write failed".to_string());
                    }
                    if stdin.flush().await.is_err() {
                        return Err("Write failed".to_string());
                    }

                    let mut resp_line = String::new();
                    match timeout(read_timeout, reader.read_line(&mut resp_line)).await {
                        Ok(Ok(bytes)) if bytes > 0 => {
                            let resp: serde_json::Value = serde_json::from_str(resp_line.trim())
                                .unwrap_or(serde_json::json!({"ok": false}));
                            resp["result"].clone()
                        }
                        Ok(Ok(_)) | Ok(Err(_)) => return Err("Read failed".to_string()),
                        Err(_) => return Err("timeout".to_string()),
                    }
                } else {
                    serde_json::Value::Null
                };

                let shutdown_cmd = serde_json::json!({"cmd": "shutdown"});
                let mut line = serde_json::to_string(&shutdown_cmd).unwrap();
                line.push('\n');
                let _ = stdin.write_all(line.as_bytes()).await;
                let _ = stdin.flush().await;
                let _ = timeout(shutdown_timeout, child.wait()).await;

                Ok(serde_json::json!({
                    "url": url,
                    "title": title,
                    "eval": eval_result,
                    "time_ms": task_start.elapsed().as_millis(),
                    "worker": i,
                }))
            })
            .await
            {
                Ok(result) => result,
                Err(_) => Err("timeout".to_string()),
            };

            match worker_result {
                Ok(result) => result,
                Err(error) => {
                    let _ = timeout(shutdown_timeout, child.kill()).await;
                    serde_json::json!({
                        "url": url,
                        "error": error,
                        "time_ms": task_start.elapsed().as_millis(),
                    })
                }
            }
        });

        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => results.push(serde_json::json!({"error": e.to_string()})),
        }
    }

    let total_time = start.elapsed();

    if format == "json" {
        let output = serde_json::json!({
            "total_urls": total,
            "concurrency": concurrency,
            "total_time_ms": total_time.as_millis(),
            "avg_time_ms": total_time.as_millis() as f64 / total as f64,
            "results": results,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for r in &results {
            let url = r["url"].as_str().unwrap_or("?");
            let title = r["title"].as_str().unwrap_or("");
            let time = r["time_ms"].as_u64().unwrap_or(0);
            let eval = &r["eval"];
            if eval.is_null() {
                println!("{}ms\t{}\t{}", time, url, title);
            } else {
                println!("{}ms\t{}\t{}", time, url, eval);
            }
        }
        if !quiet {
            eprintln!(
                "\nTotal: {}ms for {} URLs ({} concurrent)",
                total_time.as_millis(),
                total,
                concurrency
            );
        }
    }

    Ok(())
}

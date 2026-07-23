use super::*;

impl Page {
    pub(crate) fn should_block_url(&self, url: &str) -> bool {
        for pattern in &self.blocked_url_patterns {
            if url_matches_cdp_pattern(pattern, url) {
                return true;
            }
        }
        if self.intercept_enabled {
            for pattern in &self.intercept_block_patterns {
                if url_matches_cdp_pattern(pattern, url) {
                    return true;
                }
            }
        }
        false
    }

    pub(crate) async fn do_fetch(&self, url: &Url) -> Result<Response, ObscuraNetError> {
        #[cfg(feature = "stealth")]
        if let Some(ref stealth) = self.stealth_client {
            return stealth.fetch(url).await;
        }
        self.http_client
            .fetch_with_callbacks(url, Some(&self.callbacks))
            .await
    }
    pub(crate) fn init_js(&mut self) {
        self.suspend_child_frame_runtimes();
        self.js = None;

        // Thread the BrowserContext's proxy through to the ES-module loader
        // and op_fetch_url so dynamic imports and JS fetch() honour the
        // configured upstream proxy (#139). When proxy_url is None this is
        // equivalent to with_base_url() (direct connection).
        let mut rt = ObscuraJsRuntime::with_options(
            &self.url_string(),
            self.context.proxy_url.clone(),
            self.context.cookie_jar.clone(),
            #[cfg(feature = "stealth")]
            self.stealth_client.is_some(),
            #[cfg(not(feature = "stealth"))]
            false,
        );
        rt.set_url(&self.url_string());
        rt.set_encoding(&self.encoding);
        rt.set_title(&self.title);

        let fp = crate::fingerprint::FingerprintConfig::global();

        #[cfg(feature = "stealth")]
        if self.stealth_client.is_some() {
            rt.set_stealth(true);
            // Config wins over the Linux STEALTH_* defaults so an operator who
            // pins a Windows/macOS TLS profile can present a matching JS identity.
            rt.set_user_agent(fp.user_agent.as_deref().unwrap_or(obscura_net::STEALTH_USER_AGENT));
            rt.set_platform(
                fp.platform.as_deref().unwrap_or(obscura_net::STEALTH_NAVIGATOR_PLATFORM),
                fp.ua_platform.as_deref().unwrap_or(obscura_net::STEALTH_UA_PLATFORM),
                fp.ua_platform_version.as_deref().unwrap_or(obscura_net::STEALTH_UA_PLATFORM_VERSION),
            );
        } else {
            if let Ok(ua) = self.http_client.user_agent.try_read() {
                rt.set_user_agent(&ua);
            }
            rt.set_platform(
                &self.context.platform,
                &self.context.ua_platform,
                &self.context.ua_platform_version,
            );
        }
        #[cfg(not(feature = "stealth"))]
        {
            if let Ok(ua) = self.http_client.user_agent.try_read() {
                rt.set_user_agent(&ua);
            }
            rt.set_platform(
                &self.context.platform,
                &self.context.ua_platform,
                &self.context.ua_platform_version,
            );
        }
        if let Some((lat, lon)) =
            env_geolocation().or_else(|| fp.geolocation.map(|g| (g[0], g[1])))
        {
            rt.set_geolocation(lat, lon);
        }

        rt.set_cookie_jar(self.context.cookie_jar.clone());
        rt.set_http_client(self.http_client.clone());
        rt.set_callbacks(self.callbacks.clone());
        rt.set_blocked_urls(self.blocked_url_patterns.clone());
        #[cfg(feature = "stealth")]
        if let Some(ref stealth) = self.stealth_client {
            rt.set_stealth_client(stealth.clone());
        }

        if let Some(tx) = &self.intercept_tx {
            rt.set_intercept_tx(tx.clone());
        }
        // Re-apply intercept_enabled: enable_interception()/enable_intercept()
        // called before the first navigation sets this on the Page while the
        // runtime does not exist yet, so the new runtime would otherwise start
        // with interception disabled and op_fetch_url would never intercept.
        rt.set_intercept_enabled(self.intercept_enabled);

        if let Some(dom) = self.dom.take() {
            rt.set_dom(dom);
        }

        // Apply CDP Emulation overrides, falling back to the fingerprint config.
        if let Some(lang) = &self.emulation_locale {
            let langs = self.emulation_languages.clone().unwrap_or_else(|| vec![lang.clone()]);
            rt.set_locale(lang, &langs);
        } else if let Some(langs) = &fp.languages {
            if let Some(first) = langs.first() {
                rt.set_locale(first, langs);
            }
        }
        if let Some(hw) = self.emulation_hardware_concurrency.or(fp.hardware_concurrency) {
            rt.set_hardware_concurrency(hw);
        }
        if let Some(json) = fp.js_cfg_json() {
            rt.set_fingerprint_cfg(&json);
        }

        rt.set_fp_seed(fp.fp_seed.unwrap_or_else(|| fp_seed_for(&self.context.id)));
        rt.run_page_init();
        self.js = Some(rt);
        self.sync_frame_snapshots_to_root_runtime();
    }

    /// Resolve the document base URL per HTML spec:
    /// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url
    /// Falls back to self.url when no <base href> exists.
    fn resolve_base_url(&self) -> Option<url::Url> {
        let doc_url = self.url.as_ref()?;
        let base_href: Option<String> = self.js.as_ref().and_then(|js| {
            js.with_dom(|dom| {
                match dom.query_selector("base[href]") {
                    Ok(Some(nid)) => {
                        dom.get_node(nid).and_then(|n| n.get_attribute("href").map(|s| s.to_string()))
                    }
                    _ => None,
                }
            }).flatten()
        });
        match base_href {
            Some(href) => doc_url.join(&href).ok(),
            None => Some(doc_url.clone()),
        }
    }

    async fn execute_scripts(&mut self) {
        tracing::info!("execute_scripts called, js runtime exists: {}", self.js.is_some());
        // Compute document base URL, respecting <base href>.
        let document_base = self.resolve_base_url();
        // Soft deadline on the entire script-execution phase. Heavy SPAs
        // (GitHub, Linear, CodeSandbox) ship 50+ scripts and our serial
        // fetch + execute loop can blow past a Puppeteer/Playwright goto
        // timeout. The old 10s default was too tight: a heavy React/Vue/Angular
        // SPA had its remaining scripts skipped before the app booted, so it
        // never fired its XHR/fetch calls and page.on('response') saw nothing
        // (issue #361). Only pages that actually run past the deadline are
        // affected; fast pages finish and return well before it, so a larger
        // budget costs them nothing. 30s gives an app room to initialize while
        // the per-phase watchdog (armed at this + 1s) still bounds a real
        // synchronous hang. Raise it further with OBSCURA_SCRIPT_DEADLINE_MS=<ms>
        // for very heavy SPAs on slow networks (pair it with a matching client
        // navigation timeout).
        let script_deadline_ms: u64 = std::env::var("OBSCURA_SCRIPT_DEADLINE_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000);
        let script_deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_millis(script_deadline_ms);

        // Hard backstop over the WHOLE script-execution phase. Inline scripts
        // run back-to-back with no await between them, so neither the soft
        // deadline above (only checked between scripts) nor the per-script guard
        // can interrupt a page that burns the budget across many synchronous
        // scripts (the real-world SPA / anti-bot busy-loop hang). This watchdog
        // terminates the isolate if cumulative synchronous script work overruns.
        let exec_wd = self
            .js
            .as_mut()
            .map(|js| js.arm_watchdog(std::time::Duration::from_millis(script_deadline_ms + 1000)));

        #[derive(Debug)]
        struct ScriptInfo {
            src: Option<String>,
            inline: String,
            is_defer: bool,
            is_async: bool,
            is_module: bool,
            nid: u32,
        }

        let all_scripts = match &self.js {
            Some(js) => {
                js.with_dom(|dom| {
                    let script_ids = dom.query_selector_all("script").unwrap_or_default();
                    let mut scripts = Vec::new();

                    for sid in script_ids {
                        if let Some(node) = dom.get_node(sid) {
                            let src = node.get_attribute("src").map(|s| s.to_string());
                            let script_type = node.get_attribute("type").unwrap_or("").to_string();
                            let is_defer = node.get_attribute("defer").is_some();
                            let is_async = node.get_attribute("async").is_some();
                            let is_module = script_type == "module";

                            if !script_type.is_empty()
                                && script_type != "text/javascript"
                                && script_type != "application/javascript"
                                && script_type != "module"
                            {
                                continue;
                            }

                            let inline_code = if src.is_none() {
                                dom.text_content(sid)
                            } else {
                                String::new()
                            };

                            if src.is_some() || !inline_code.trim().is_empty() {
                                scripts.push(ScriptInfo {
                                    src,
                                    inline: inline_code,
                                    is_defer,
                                    is_async,
                                    is_module,
                                    nid: sid.raw(),
                                });
                            }
                        }
                    }
                    scripts
                }).unwrap_or_default()
            }
            None => return,
        };

        let mut regular = Vec::new();
        let mut deferred = Vec::new();
        let mut async_scripts = Vec::new();

        let mut module_scripts = Vec::new();

        for script in all_scripts {
            if script.is_module {
                module_scripts.push(script);
                continue;
            }
            if script.is_defer {
                deferred.push(script);
            } else if script.is_async {
                async_scripts.push(script);
            } else {
                regular.push(script);
            }
        }

        let scripts = regular;

        tracing::info!("Found {} regular + {} deferred + {} async scripts", scripts.len(), deferred.len(), async_scripts.len());
        let all_to_execute: Vec<ScriptInfo> = scripts.into_iter()
            .chain(deferred.into_iter())
            .chain(async_scripts.into_iter())
            .collect();

        let mut resolved: Vec<(usize, String)> = Vec::new();
        let mut fetch_tasks: Vec<(usize, String)> = Vec::new();

        for (i, script) in all_to_execute.iter().enumerate() {
            if let Some(src_url) = &script.src {
                let full_url = if src_url.starts_with("http://") || src_url.starts_with("https://") {
                    src_url.clone()
                } else if let Some(base) = &document_base {
                    base.join(src_url).map(|u| u.to_string()).unwrap_or_else(|_| src_url.clone())
                } else {
                    src_url.clone()
                };

                if !subresource_allowed(self.url.as_ref(), &full_url) {
                    // Block file://, data:, javascript:, and other
                    // off-origin schemes from being injected as a
                    // <script src>. Without this an http page can
                    // include <script src="file:///etc/passwd"> and
                    // see the body parsed as JS source.
                    tracing::warn!(
                        "blocking cross-scheme <script src>: page={} src={}",
                        self.url_string(),
                        full_url,
                    );
                    continue;
                }
                if self.should_block_url(&full_url) {
                    tracing::info!("Blocked script by interception: {}", full_url);
                    continue;
                }
                resolved.push((i, full_url.clone()));
                fetch_tasks.push((i, full_url));
            }
        }

        let http_client = self.http_client.clone();
        let page_callbacks = self.callbacks.clone();
        #[cfg(feature = "stealth")]
        let stealth_client = self.stealth_client.clone();
        let fetch_futures: Vec<_> = fetch_tasks.iter().map(|(idx, url)| {
            let url = url.clone();
            let idx = *idx;
            let http_client = http_client.clone();
            let cbs = page_callbacks.clone();
            #[cfg(feature = "stealth")]
            let stealth_client = stealth_client.clone();
            async move {
                let parsed = Url::parse(&url).unwrap_or_else(|_| Url::parse("about:blank").unwrap());
                if parsed.scheme() == "data" {
                    // data: URIs are inline; decode locally, no network fetch.
                    // Instagram and other Meta properties serve their bootstrap
                    // as <script src="data:application/x-javascript;base64,...">.
                    let body = decode_data_uri(&url).unwrap_or_default();
                    let content_type = url
                        .strip_prefix("data:")
                        .and_then(|s| s.split(',').next())
                        .unwrap_or("application/javascript")
                        .split(';')
                        .next()
                        .unwrap_or("application/javascript")
                        .to_string();
                    let mut headers = std::collections::HashMap::new();
                    headers.insert("content-type".to_string(), content_type);
                    let resp = obscura_net::Response {
                        url: parsed,
                        status: 200,
                        headers,
                        body,
                        redirected_from: Vec::new(),
                    };
                    return Some((idx, url, resp));
                }
                #[cfg(feature = "stealth")]
                if let Some(ref stealth) = stealth_client {
                    // Stealth path uses the wreq client (Chrome TLS fingerprint);
                    // passive callbacks stay on the plain-client path below.
                    match stealth.fetch(&parsed).await {
                        Ok(resp) => return Some((idx, url, resp)),
                        Err(e) => {
                            tracing::warn!("Failed to fetch script {}: {}", url, e);
                            return None;
                        }
                    }
                }
                match http_client.fetch_with_callbacks(&parsed, Some(&cbs)).await {
                    Ok(resp) => Some((idx, url, resp)),
                    Err(e) => {
                        tracing::warn!("Failed to fetch script {}: {}", url, e);
                        None
                    }
                }
            }
        }).collect();

        // Bound concurrency: a page with 100 external scripts would
        // otherwise open 100 sockets at once, exhausting the connection
        // pool / ephemeral ports and triggering OS-level backpressure.
        // 16 is well above the per-host pool ceiling most browsers use
        // and matches what real Chrome does for a given origin.
        use futures::StreamExt as _;
        let fetch_stream = futures::stream::iter(fetch_futures)
            .buffer_unordered(16);
        let fetch_results = match tokio::time::timeout_at(
            script_deadline,
            fetch_stream.collect::<Vec<_>>(),
        ).await {
            Ok(results) => results,
            Err(_) => {
                tracing::warn!(
                    "execute_scripts: fetch deadline reached, some scripts may not have loaded"
                );
                Vec::new()
            }
        };

        let mut fetched: std::collections::HashMap<usize, (String, String, obscura_net::Response)> = std::collections::HashMap::new();
        for result in fetch_results {
            if let Some((idx, url, resp)) = result {
                // Script bodies: only the HTTP Content-Type charset matters
                // (no in-band meta-charset for JS).
                let code = obscura_net::decode_non_html(&resp.body, resp.content_type());
                fetched.insert(idx, (url, code, resp));
            }
        }

        // Spec: readyState is "loading" while parser-discovered scripts execute.
        // Scripts that check readyState === 'loading' will register DOMContentLoaded
        // listeners instead of calling their callback immediately.
        if let Some(js) = &mut self.js {
            let _ = js.execute_script("<ready-state>", "globalThis.__documentReadyState__ = 'loading';");
        }

        // CDP `Page.addScriptToEvaluateOnNewDocument` contract: preload
        // sources must run BEFORE any of the page's own scripts. This is
        // also where puppeteer's `exposeFunction` wrapper installs itself —
        // if preload runs after page scripts, every early binding call
        // hits an undefined function and silently no-ops.
        let preload_sources = self.preload_scripts.clone();
        if let Some(js) = &mut self.js {
            for source in &preload_sources {
                if let Err(e) = js.execute_script_guarded("<preload>", source.as_str()) {
                    tracing::debug!("Preload script error: {}", e);
                }
            }
        }

        for (i, script) in all_to_execute.iter().enumerate() {
            if tokio::time::Instant::now() >= script_deadline {
                tracing::warn!(
                    "execute_scripts: deadline reached, skipping {} remaining scripts",
                    all_to_execute.len() - i,
                );
                break;
            }
            if script.src.is_some() {
                if let Some((url, code, resp)) = fetched.remove(&i) {
                    tracing::info!("Executing script ({} bytes): {}", code.len(), url);
                    self.record_network_event_with_body(&url, "GET", "Script", resp.status, &resp.headers, &resp.body, false);
                    if let Some(js) = &mut self.js {
                        let _ = js.execute_script("<current-script>", &format!("globalThis.__currentScriptNid={};", script.nid));
                        if let Err(e) = js.execute_script_guarded(&url, &code) {
                            tracing::warn!("Script error ({}): {}", url, e);
                        }
                        let _ = js.execute_script("<current-script>", "globalThis.__currentScriptNid=0;");
                    }
                }
            } else if !script.inline.is_empty() {
                if let Some(js) = &mut self.js {
                    let _ = js.execute_script("<current-script>", &format!("globalThis.__currentScriptNid={};", script.nid));
                    if let Err(e) = js.execute_script_guarded("<inline>", &script.inline) {
                        tracing::warn!("Inline script error: {}", e);
                    }
                    let _ = js.execute_script("<current-script>", "globalThis.__currentScriptNid=0;");
                }
            }
        }

        // Per-module budget. Modules on an already-rendered page are
        // enhancement, not the app: give them a short budget so one slow
        // non-essential module (e.g. YC's bookface, whose top-level eval
        // idle-waits ~10s) cannot block navigation completion. A page whose
        // body is still an empty shell IS the SPA (issue #205), so give it the
        // full script budget and the app module still mounts.
        let module_budget_ms: u64 = {
            let body_nodes = self
                .js
                .as_ref()
                .and_then(|js| {
                    js.with_dom(|dom| {
                        dom.query_selector("body")
                            .ok()
                            .flatten()
                            .map(|b| dom.descendants(b).len())
                            .unwrap_or(0)
                    })
                })
                .unwrap_or(0);
            let short_ms: u64 = std::env::var("OBSCURA_MODULE_BUDGET_MS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3_000);
            // A rendered body has hundreds of descendants; an unmounted Vite/Next
            // shell is <root> plus maybe a spinner.
            if body_nodes > 50 { short_ms } else { script_deadline_ms }
        };

        for module_script in &module_scripts {
            if tokio::time::Instant::now() >= script_deadline {
                tracing::warn!("execute_scripts: deadline reached, skipping remaining module scripts");
                break;
            }
            if let Some(ref src) = module_script.src {
                let full_url = if src.starts_with("http://") || src.starts_with("https://") {
                    src.clone()
                } else if let Some(base) = &document_base {
                    base.join(src).map(|u| u.to_string()).unwrap_or_else(|_| src.clone())
                } else {
                    src.clone()
                };

                tracing::info!("Loading ES module: {}", full_url);
                if let Some(js) = &mut self.js {
                    match js.load_module(&full_url, module_budget_ms).await {
                        Ok(()) => {
                            tracing::info!("ES module loaded: {}", full_url);
                            self.record_network_event(&full_url, "GET", "Script", 200, &std::collections::HashMap::new(), 0);
                        }
                        Err(e) => {
                            tracing::warn!("ES module error ({}): {}", full_url, e);
                        }
                    }
                }
            } else if !module_script.inline.is_empty() {
                let base = self.url_string();
                if let Some(js) = &mut self.js {
                    if let Err(e) = js.load_inline_module(&module_script.inline, &base, module_budget_ms).await {
                        tracing::warn!("Inline ES module error: {}", e);
                    }
                }
            }
        }

        if let Some(js) = &mut self.js {
            // Spec order: readyState -> interactive, fire DOMContentLoaded on both
            // document and window, then readyState -> complete, fire load.
            let _ = js.execute_script("<load-events>",
                "globalThis.__documentReadyState__ = 'interactive';\n\
                 try { document.dispatchEvent(new Event('DOMContentLoaded', {bubbles:false,cancelable:false})); } catch(e) {}\n\
                 try { window.dispatchEvent(new Event('DOMContentLoaded', {bubbles:false,cancelable:false})); } catch(e) {}\n\
                 if (typeof window.onload === 'function') { try { window.onload(); } catch(e) {} }\n\
                 globalThis.__documentReadyState__ = 'complete';\n\
                 try { window.dispatchEvent(new Event('load', {bubbles:false,cancelable:false})); } catch(e) {}");
        }

        if let Some(js) = &mut self.js {
            // Bound the post-script settle loop by wall clock, not just by the
            // 10ms-tick branch. The old code only consulted `deadline` inside
            // the `Err(_)` arm (when the inner tick timed out), so a steady
            // stream of inflight XHR/fetch (active_requests() > 0) kept the
            // loop running indefinitely because it took the `Ok(Ok(()))` arm
            // and slept 1ms each iteration without ever checking the clock.
            // On busy sites this could keep the V8 lock held for tens of
            // seconds, wedging the entire CDP dispatcher (see triage for
            // issue series around the 40-site compat sweep).
            // A single run_event_loop poll that pins the thread inside V8 makes
            // the per-poll tokio timeouts below useless, so guard the whole loop
            // with a watchdog that fires ~250ms past its 500ms deadline.
            let settle_wd = js.arm_watchdog(std::time::Duration::from_millis(750));
            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(500);
            let mut idle_count = 0u32;
            loop {
                if tokio::time::Instant::now() >= deadline {
                    break;
                }
                let result = tokio::time::timeout(
                    tokio::time::Duration::from_millis(10),
                    js.run_event_loop(),
                ).await;

                match result {
                    Ok(Ok(())) => {
                        if self.http_client.active_requests() == 0 {
                            idle_count += 1;
                            if idle_count >= 2 {
                                break;
                            }
                            tokio::task::yield_now().await;
                        } else {
                            idle_count = 0;
                            tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                        }
                    }
                    Ok(Err(_)) => break,
                    Err(_) => {
                        idle_count = 0;
                    }
                }
            }
            js.disarm_watchdog(settle_wd);
        }
        if let Some(token) = exec_wd {
            if let Some(js) = self.js.as_mut() {
                js.disarm_watchdog(token);
            }
        }
    }

    pub async fn navigate(&mut self, url_str: &str) -> Result<(), PageError> {
        // Internal/default entry: the caller already owns the V8 lock (or there
        // is no dispatcher), so this navigation does NOT self-manage it.
        self.navigate_with_wait(url_str, crate::lifecycle::WaitUntil::Load).await
    }

    pub async fn navigate_with_wait(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
    ) -> Result<(), PageError> {
        self.navigate_with_wait_post(url_str, wait_until, "GET", "").await
    }

    pub async fn navigate_with_wait_post(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
    ) -> Result<(), PageError> {
        // Hard ceiling on a single end-to-end navigation. Without this a slow
        // primary fetch or a runaway settle loop can hold the per-connection V8
        // lock for arbitrarily long (we've measured 60+ seconds on JS-heavy news
        // sites), wedging every other in-flight CDP request on this connection
        // because the dispatcher holds the lock across the entire handler. 30
        // seconds matches reqwest's default per-request timeout — the worst case
        // is one slow primary GET plus one slow JS-redirect chain step. Override
        // with `OBSCURA_NAV_TIMEOUT_MS=NN`.
        let nav_timeout_ms: u64 = std::env::var("OBSCURA_NAV_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30_000);
        let nav_timeout = tokio::time::Duration::from_millis(nav_timeout_ms);

        let result = match tokio::time::timeout(
            nav_timeout,
            self.navigate_with_wait_post_inner(url_str, wait_until, method, body),
        )
        .await
        {
            Ok(r) => r,
            Err(_) => {
                self.lifecycle = crate::lifecycle::LifecycleState::Failed;
                Err(PageError::NetworkError(format!(
                    "navigation exceeded {nav_timeout_ms}ms deadline"
                )))
            }
        };
        if result.is_ok() {
            self.push_history(self.url_string());
        }
        result
    }

    /// Drive the JS event loop after navigation so deferred work can run:
    /// pending timers (setTimeout / setInterval), queued microtasks, in-flight
    /// fetches, and completion callbacks such as testharness's
    /// `add_completion_callback`. Returns as soon as the loop goes idle, or
    /// after `max_ms`. Without this the page is observed exactly as it stood at
    /// the load event, before any async work settles, which silently strands
    /// timer-driven tests and dynamic pages.
    pub async fn settle(&mut self, max_ms: u64) {
        if max_ms == 0 {
            return;
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(max_ms);
        // Pump the event loop, then load any iframes the page inserted while it
        // ran (Turnstile's widget). A freshly-loaded widget runs its own
        // scripts and posts a token back, so re-pump to let the parent's
        // challenge script consume it. Loop until quiescent or out of budget.
        for _ in 0..8 {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            if let Some(js) = &mut self.js {
                // Bounded against both async idle and synchronous microtask
                // storms: a plain tokio timeout cannot preempt a page that pins
                // the thread inside V8 (the real-world SPA hang), so settle
                // drives the loop through the watchdog-guarded path.
                let _ = js.run_event_loop_bounded(remaining.as_millis() as u64).await;
            }
            if !self.process_pending_iframe_loads().await {
                break;
            }
        }
    }

    /// Append the current URL to the history stack, truncating any forward
    /// entries past the cursor (matches real Chrome: navigating after a
    /// goBack clobbers the forward history).
    pub fn push_history(&mut self, url: String) {
        if url.is_empty() { return; }
        // Don't dupe consecutive entries (Page.reload would otherwise pile up).
        if self.history.get(self.history_index) == Some(&url) {
            return;
        }
        if !self.history.is_empty() && self.history_index < self.history.len() - 1 {
            self.history.truncate(self.history_index + 1);
        }
        self.history.push(url);
        self.history_index = self.history.len() - 1;
    }

    /// Move the history cursor without re-navigating; used by
    /// Page.navigateToHistoryEntry which then drives the actual fetch.
    pub fn set_history_index(&mut self, idx: usize) {
        if idx < self.history.len() {
            self.history_index = idx;
        }
    }

    async fn navigate_with_wait_post_inner(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
    ) -> Result<(), PageError> {
        let mut current_url = url_str.to_string();
        let mut current_method = method.to_string();
        let mut current_body = body.to_string();
        const REDIRECT_LIMIT: usize = 10;
        for chain in 0..REDIRECT_LIMIT {
            self.navigate_single(&current_url, wait_until, &current_method, &current_body).await?;
            if let Some((next_url, next_method, next_body)) = self.take_pending_navigation() {
                if cross_scheme_to_file(&current_url, &next_url) {
                    // SOP gate. A web page must not be able to drive
                    // a navigation to file:// and then read the loaded
                    // document. Without this an http(s) page sets
                    // window.onload, calls location.href = "file:..."
                    // and harvests document.body from a local file
                    // once the new document loads.
                    tracing::warn!(
                        "blocking JS-initiated cross-scheme navigation to file: {} -> {}",
                        current_url,
                        next_url,
                    );
                    break;
                }
                tracing::info!("JS-triggered navigation chain: {} {} -> {}", current_method, current_url, next_url);
                current_url = next_url;
                current_method = next_method;
                current_body = next_body;
                if chain + 1 == REDIRECT_LIMIT {
                    // Hit the cap and the page still wants to keep
                    // chaining. Surface that as an error instead of
                    // returning Ok(()) so callers can distinguish a
                    // successful load from a redirect storm.
                    return Err(PageError::TooManyRedirects(REDIRECT_LIMIT));
                }
                continue;
            }
            break;
        }
        Ok(())
    }

    async fn navigate_single(
        &mut self,
        url_str: &str,
        wait_until: crate::lifecycle::WaitUntil,
        method: &str,
        body: &str,
    ) -> Result<(), PageError> {
        let url = Url::parse(url_str).map_err(|e| PageError::InvalidUrl(e.to_string()))?;

        self.suspend_all_runtimes();
        self.lifecycle = LifecycleState::Loading;
        self.url = Some(url.clone());
        self.network_events.clear();

        if self.context.obey_robots {
            if let Some(domain) = url.host_str() {
                if self.context.robots_cache.is_allowed(domain, "/robots.txt") {
                    let robots_url = format!("{}://{}/robots.txt", url.scheme(), domain);
                    if let Ok(robots_url) = Url::parse(&robots_url) {
                        if let Ok(resp) = self
                            .http_client
                            .fetch_with_callbacks(&robots_url, Some(&self.callbacks))
                            .await
                        {
                            if resp.status == 200 {
                                let body = String::from_utf8_lossy(&resp.body);
                                self.context.robots_cache.parse_and_store(
                                    domain,
                                    &body,
                                    &self.context.user_agent,
                                );
                            }
                        }
                    }
                }

                if !self.context.robots_cache.is_allowed(domain, url.path()) {
                    self.lifecycle = LifecycleState::Failed;
                    return Err(PageError::NetworkError(format!(
                        "Blocked by robots.txt: {}",
                        url
                    )));
                }
            }
        }

        if url.scheme() == "about" {
            self.navigate_blank();
            self.init_js();
            // Preloads (Page.addScriptToEvaluateOnNewDocument, the
            // Runtime.addBinding shim) must run on about:blank too —
            // puppeteer's `browser.newPage()` lands on about:blank and
            // a follow-up `exposeFunction` is unusable otherwise.
            let preload_sources = self.preload_scripts.clone();
            if let Some(js) = &mut self.js {
                for source in &preload_sources {
                    if let Err(e) = js.execute_script_guarded("<preload>", source.as_str()) {
                        tracing::debug!("Preload script error on about:blank: {}", e);
                    }
                }
            }
            return Ok(());
        }

        let response = if url.scheme() == "data" {
            let content_type = url_str.strip_prefix("data:")
                .and_then(|s| s.split(',').next())
                .unwrap_or("text/html")
                .split(';').next()
                .unwrap_or("text/html")
                .to_string();
            let body_bytes = decode_data_uri(url_str).unwrap_or_default();
            let mut headers = std::collections::HashMap::new();
            headers.insert("content-type".to_string(), content_type);
            Ok(obscura_net::Response { url: url.clone(), status: 200, headers, body: body_bytes, redirected_from: Vec::new() })
        } else if method == "POST" {
            self.http_client
                .post_form_with_callbacks(&url, body, Some(&self.callbacks))
                .await
        } else {
            self.do_fetch(&url).await
        }.map_err(|e| {
            self.lifecycle = LifecycleState::Failed;
            PageError::NetworkError(e.to_string())
        })?;

        // Store binary main resources (images, PDFs, octet-stream) base64 so
        // Network.getResponseBody returns intact bytes. A UTF-8-lossy text store
        // corrupts them (issue #340). Text-like types stay as text.
        let main_is_binary = !is_text_like_content_type(response.content_type());
        self.record_network_event_with_body(
            url.as_str(),
            "GET",
            "Document",
            response.status,
            &response.headers,
            &response.body,
            main_is_binary,
        );

        if !response.redirected_from.is_empty() {
            self.url = Some(response.url.clone());
        }

        // Honor the response charset: HTTP Content-Type → <meta charset> sniff
        // in the first 1KB → UTF-8 fallback. Without this, every non-UTF-8
        // page (GBK, Big5, Shift-JIS, Windows-125x, EUC-KR, ISO-8859-x)
        // came through as replacement characters.
        let (body_text, encoding_name) =
            obscura_net::decode_response_with_name(&response.body, response.content_type());
        self.encoding = encoding_name.to_string();
        let dom = parse_html(&body_text);

        self.title = dom
            .query_selector("title")
            .ok()
            .flatten()
            .map(|title_id| dom.text_content(title_id))
            .unwrap_or_default();

        let stylesheet_urls: Vec<String> = dom
            .query_selector_all("link")
            .unwrap_or_default()
            .iter()
            .filter_map(|&nid| {
                // Borrow the node instead of deep-cloning it; rel keywords are
                // ASCII so eq_ignore_ascii_case matches to_lowercase() exactly
                // without allocating a lowercased String.
                dom.with_node(nid, |node| {
                    let rel = node.get_attribute("rel")?;
                    if !rel.eq_ignore_ascii_case("stylesheet") {
                        return None;
                    }
                    node.get_attribute("href").map(|s| s.to_string())
                })
                .flatten()
            })
            .collect();

        let mut css_fetch_urls: Vec<String> = Vec::new();
        for href in &stylesheet_urls {
            let full_url = if href.starts_with("http://") || href.starts_with("https://") {
                href.clone()
            } else if let Some(base) = &self.url {
                base.join(href).map(|u| u.to_string()).unwrap_or_else(|_| href.clone())
            } else {
                href.clone()
            };
            if !subresource_allowed(self.url.as_ref(), &full_url) {
                tracing::warn!(
                    "blocking cross-scheme <link rel=stylesheet href>: page={} href={}",
                    self.url_string(),
                    full_url,
                );
                continue;
            }
            if self.should_block_url(&full_url) {
                tracing::info!("Blocked stylesheet by interception: {}", full_url);
                continue;
            }
            css_fetch_urls.push(full_url);
        }

        let client = self.http_client.clone();
        let page_callbacks = self.callbacks.clone();
        let css_futures: Vec<_> = css_fetch_urls.iter().map(|full_url| {
            let client = client.clone();
            let cbs = page_callbacks.clone();
            let url_str = full_url.clone();
            async move {
                let parsed = Url::parse(&url_str).unwrap_or_else(|_| Url::parse("about:blank").unwrap());
                match client.fetch_with_callbacks(&parsed, Some(&cbs)).await {
                    Ok(resp) => Some((url_str, resp)),
                    Err(e) => {
                        tracing::debug!("Failed to fetch stylesheet {}: {}", url_str, e);
                        None
                    }
                }
            }
        }).collect();

        // Same concurrency cap as script fetches.
        use futures::StreamExt as _;
        let css_results: Vec<_> = futures::stream::iter(css_futures)
            .buffer_unordered(16)
            .collect()
            .await;
        let mut css_sources = Vec::new();
        for result in css_results {
            if let Some((url_str, resp)) = result {
                // CSS bodies: honor the Content-Type charset; CSS @charset is
                // out of scope for the current scrape-focused pipeline.
                let css = obscura_net::decode_non_html(&resp.body, resp.content_type());
                self.record_network_event_with_body(&url_str, "GET", "Stylesheet", resp.status, &resp.headers, &resp.body, false);
                css_sources.push(css);
            }
        }

        self.dom = Some(dom);
        self.rebuild_root_child_frames();
        self.load_child_frames().await;
        self.init_js();

        // Inject CSS as a global so getComputedStyle and any CSS-aware shim
        // can read it. Has to happen before scripts run, regardless of
        // waitUntil, so handlers that read window.__obscura_css see it.
        if !css_sources.is_empty() {
            if let Some(js) = &mut self.js {
                let combined_css = css_sources.join("\n");
                // Use the thorough template-literal escape that
                // covers U+2028 / U+2029 and other control chars.
                // The previous escaper only handled `, \, and ${,
                // letting attacker-controlled CSS containing a raw
                // U+2028 break out of the template literal and run
                // arbitrary JS in the page's V8 realm.
                let escaped = escape_for_js_template_literal(&combined_css);
                let code = format!("globalThis.__obscura_css = `{}`;", escaped);
                let _ = js.execute_script("<css>", &code);
            }
        }
        if let Some(js) = &mut self.js {
            let _ = js.execute_script("<iframe-load>",
                "(function() { var iframes = document.querySelectorAll('iframe[src]'); for (var i = 0; i < iframes.length; i++) { var frameId = iframes[i].getAttribute('data-obscura-frame-id'); var src = iframes[i].getAttribute('src'); if (frameId) { iframes[i].__obscuraFrameId = frameId; } if (src && src !== 'about:blank') iframes[i]._loadIframeSrc(src); } })()");
        }

        // Spec: DOMContentLoaded fires AFTER parser-blocking scripts run,
        // not before. Skipping execute_scripts() on the DCL path meant
        // every inline <script> in the page was silently dropped: form
        // listeners never registered, frameworks never bootstrapped,
        // page.click() handlers were no-ops. Now scripts run regardless
        // of waitUntil and DCL means "DOM parsed AND scripts executed".
        self.execute_scripts().await;

        self.lifecycle = LifecycleState::DomContentLoaded;

        if wait_until == crate::lifecycle::WaitUntil::DomContentLoaded {
            return Ok(());
        }

        if let Some(js) = &mut self.js {
            if let Ok(new_title) = js.evaluate("document.title") {
                if let Some(t) = new_title.as_str() {
                    self.title = t.to_string();
                }
            }
        }

        self.lifecycle = LifecycleState::Loaded;

        if matches!(
            wait_until,
            crate::lifecycle::WaitUntil::NetworkIdle0 | crate::lifecycle::WaitUntil::NetworkIdle2
        ) {
            let threshold = match wait_until {
                crate::lifecycle::WaitUntil::NetworkIdle0 => 0,
                crate::lifecycle::WaitUntil::NetworkIdle2 => 2,
                _ => 0,
            };

            // Same hazard as the post-script settle: a synchronous poll can pin
            // the thread past the 5s network-idle deadline, so arm a watchdog
            // that terminates the isolate ~500ms past it.
            let netidle_wd = self
                .js
                .as_mut()
                .map(|js| js.arm_watchdog(std::time::Duration::from_millis(5500)));
            let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
            let mut idle_since: Option<tokio::time::Instant> = None;

            loop {
                let active = self.http_client.active_requests();
                let now = tokio::time::Instant::now();

                if active <= threshold {
                    if idle_since.is_none() {
                        idle_since = Some(now);
                    }
                    if now.duration_since(idle_since.unwrap()) >= tokio::time::Duration::from_millis(500) {
                        break;
                    }
                } else {
                    idle_since = None;
                }

                if now >= deadline {
                    tracing::debug!("Network idle timeout reached with {} active requests", active);
                    break;
                }

                if let Some(js) = &mut self.js {
                    let _ = tokio::time::timeout(
                        tokio::time::Duration::from_millis(50),
                        js.run_event_loop(),
                    ).await;
                } else {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }

            if let Some(token) = netidle_wd {
                if let Some(js) = self.js.as_mut() {
                    js.disarm_watchdog(token);
                }
            }
            self.lifecycle = LifecycleState::NetworkIdle;
        }

        Ok(())
    }

    pub fn navigate_blank(&mut self) {
        self.suspend_all_runtimes();
        self.url = Some(Url::parse("about:blank").unwrap());
        self.dom = Some(parse_html("<!DOCTYPE html><html><head></head><body></body></html>"));
        self.title = String::new();
        self.lifecycle = LifecycleState::Loaded;
    }

    pub fn execute_preload_script(&mut self, source: &str) -> Result<(), String> {
        if let Some(js) = &mut self.js {
            js.execute_script("<preload>", source)
        } else {
            Err("No JS runtime".to_string())
        }
    }

    pub fn suspend_js(&mut self) {
        self.suspend_all_runtimes();
    }

    pub fn resume_js(&mut self) {
        if self.js.is_some() {
            return;
        }
        self.init_js();
    }

    pub fn has_js(&self) -> bool {
        self.js.is_some()
    }

    pub fn take_pending_navigation(&self) -> Option<(String, String, String)> {
        if let Some(js) = &self.js {
            js.take_pending_navigation()
        } else {
            None
        }
    }

    fn take_pending_iframe_loads(&self) -> Vec<(u32, String)> {
        if let Some(js) = &self.js {
            js.take_pending_iframe_loads()
        } else {
            Vec::new()
        }
    }

    /// Load any iframes the page inserted at runtime (Turnstile's widget being
    /// the motivating case). Mirrors process_pending_navigation: drain the
    /// queue the JS side filled via op_register_dynamic_iframe, register each
    /// as a child frame, and run it through the same load path as static
    /// iframes so its scripts execute. Loops so a freshly-loaded frame that
    /// itself inserts iframes is picked up. Returns true if anything loaded.
    pub async fn process_pending_iframe_loads(&mut self) -> bool {
        let mut loaded_any = false;
        for _ in 0..8 {
            let pending = self.take_pending_iframe_loads();
            if pending.is_empty() {
                break;
            }
            let root_id = self.frame_id.clone();
            for (_node_id, src) in pending {
                let Some(base) = self.url.clone() else { continue };
                let Ok(abs) = base.join(&src) else { continue };
                // Skip empty / about:blank placeholders (Turnstile first appends
                // an about:blank iframe, then sets the real src — that later
                // .src= re-registers it, which is the one we want).
                if abs.scheme() == "about" {
                    continue;
                }
                let frame_id = self.next_child_frame_id();
                // Tag the live DOM node so its contentDocument/contentWindow
                // getters read this frame's Rust-executed snapshot (by src —
                // Turnstile widget srcs are unique per instance).
                if let Some(js) = &mut self.js {
                    let tag = format!(
                        "(function(){{var f=document.querySelector('iframe[src={:?}]');\
                          if(f){{f.setAttribute('data-obscura-frame-id',{:?});f.__obscuraFrameId={:?};}}}})()",
                        src, frame_id, frame_id
                    );
                    let _ = js.execute_script("<dyn-iframe-tag>", &tag);
                }
                let mut frame = PageFrame::new(frame_id.clone(), Some(root_id.clone()), None, None);
                frame.url = Some(abs);
                self.frames.push(frame);
                self.load_one_child_frame(&frame_id).await;
                loaded_any = true;
            }
        }
        if loaded_any {
            self.sync_frame_snapshots_to_root_runtime();
        }
        loaded_any
    }

    pub fn set_preload_scripts(&mut self, scripts: Vec<String>) {
        self.preload_scripts = scripts;
    }

    /// Append a script that runs in the page before any of the page's own
    /// `<script>` tags, matching CDP `Page.addScriptToEvaluateOnNewDocument`.
    /// Takes effect on the next navigation (`goto` / `navigate*`).
    pub fn add_preload_script(&mut self, script: &str) {
        self.preload_scripts.push(script.to_string());
    }

    pub async fn process_pending_navigation(&mut self) -> Result<bool, PageError> {
        if let Some((url, method, body)) = self.take_pending_navigation() {
            self.navigate_with_wait_post(&url, crate::lifecycle::WaitUntil::Load, &method, &body)
                .await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

}

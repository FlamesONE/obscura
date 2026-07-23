use super::*;

impl Page {
    pub fn root_frame(&self) -> Option<&PageFrame> {
        self.frames.iter().find(|f| f.frame_id == self.frame_id)
    }

    pub fn root_frame_mut(&mut self) -> Option<&mut PageFrame> {
        let frame_id = self.frame_id.clone();
        self.frames.iter_mut().find(|f| f.frame_id == frame_id)
    }

    pub fn frame(&self, frame_id: &str) -> Option<&PageFrame> {
        self.frames.iter().find(|f| f.frame_id == frame_id)
    }

    pub fn frame_mut(&mut self, frame_id: &str) -> Option<&mut PageFrame> {
        self.frames.iter_mut().find(|f| f.frame_id == frame_id)
    }

    pub fn child_frames(&self, parent_frame_id: &str) -> Vec<&PageFrame> {
        self.frames
            .iter()
            .filter(|f| f.parent_frame_id.as_deref() == Some(parent_frame_id))
            .collect()
    }

    pub(crate) fn next_child_frame_id(&mut self) -> String {
        self.frame_counter += 1;
        format!("{}:frame-{}", self.id, self.frame_counter)
    }

    pub fn rebuild_root_child_frames(&mut self) {
        let root_frame_id = self.frame_id.clone();
        self.frames.retain(|f| f.frame_id == root_frame_id || f.parent_frame_id.as_deref() != Some(root_frame_id.as_str()));
        let mut discovered = Vec::new();
        if let Some(dom) = self.dom.as_ref() {
            let iframe_ids = dom.query_selector_all("iframe[src]").unwrap_or_default();
            for nid in iframe_ids {
                let Some(node) = dom.get_node(nid) else { continue; };
                let src = node.get_attribute("src").map(|s| s.to_string()).unwrap_or_default();
                if src.is_empty() || src == "about:blank" {
                    continue;
                }
                let name = node.get_attribute("name").map(|s| s.to_string());
                let url = if src.starts_with("http://") || src.starts_with("https://") {
                    Url::parse(&src).ok()
                } else {
                    self.url.as_ref().and_then(|base| base.join(&src).ok())
                };
                discovered.push((nid.raw(), name, url));
            }
        }
        let mut new_frames = Vec::new();
        for (owner_node_id, name, url) in discovered {
            let frame_id = self.next_child_frame_id();
            if let Some(dom) = self.dom.as_ref() {
                let _ = dom.with_node_mut(obscura_dom::NodeId::new(owner_node_id), |owner| {
                    owner.set_attribute("data-obscura-frame-id", frame_id.clone());
                });
            }
            let mut frame = PageFrame::new(frame_id, Some(root_frame_id.clone()), Some(owner_node_id), name);
            frame.url = url;
            new_frames.push(frame);
        }
        self.frames.extend(new_frames);
    }

    pub async fn load_child_frames(&mut self) {
        let root_frame_id = self.frame_id.clone();
        let child_ids: Vec<String> = self
            .frames
            .iter()
            .filter(|f| f.parent_frame_id.as_deref() == Some(root_frame_id.as_str()))
            .map(|f| f.frame_id.clone())
            .collect();

        for child_id in child_ids {
            self.load_one_child_frame(&child_id).await;
        }
    }

    /// Fetch, parse and (for same-origin or when cross-origin frames are
    /// enabled) execute the scripts of a single already-registered child
    /// frame. Extracted from load_child_frames so the dynamic-iframe path
    /// (process_pending_iframe_loads) can drive the exact same load for a
    /// frame inserted at runtime, not just ones present in the initial HTML.
    pub(crate) async fn load_one_child_frame(&mut self, child_id: &str) {
        let parent_url = self.url.clone();
        {
            let child_url = self.frame(child_id).and_then(|f| f.url.clone());
            let Some(url) = child_url else { return; };

            let loaded = if url.scheme() == "data" {
                let body_bytes = decode_data_uri(url.as_str()).unwrap_or_default();
                let content_type = url.as_str()
                    .strip_prefix("data:")
                    .and_then(|s| s.split(',').next())
                    .unwrap_or("text/html")
                    .split(';')
                    .next()
                    .unwrap_or("text/html")
                    .to_string();
                let body_text = if content_type.contains("text/html") {
                    obscura_net::decode_response(&body_bytes, Some(&content_type))
                } else {
                    obscura_net::decode_non_html(&body_bytes, Some(&content_type))
                };
                Some((parse_html(&body_text), content_type))
            } else if url.scheme() == "about" {
                Some((parse_html("<!DOCTYPE html><html><head></head><body></body></html>"), "text/html".to_string()))
            } else {
                match self.do_fetch(&url).await {
                    Ok(resp) => {
                        let (body_text, encoding_name) = obscura_net::decode_response_with_name(&resp.body, resp.content_type());
                        Some((parse_html(&body_text), encoding_name.to_string()))
                    }
                    Err(e) => {
                        tracing::debug!("Failed to load child frame {}: {}", url, e);
                        None
                    }
                }
            };

            if let Some((dom, encoding)) = loaded {
                if let Some(frame) = self.frame_mut(child_id) {
                    frame.dom = Some(dom);
                    frame.encoding = encoding;
                    frame.lifecycle = LifecycleState::Loaded;
                    if let Some(dom) = frame.dom.as_ref() {
                        frame.title = dom
                            .query_selector("title")
                            .ok()
                            .flatten()
                            .map(|title_id| dom.text_content(title_id))
                            .unwrap_or_default();
                    }
                }
            }

            let can_init_runtime = self
                .frame(child_id)
                .map(|frame| {
                    frame.dom.is_some()
                        && (frame_is_same_origin(parent_url.as_ref(), frame.url.as_ref())
                            || cross_origin_frames_enabled())
                })
                .unwrap_or(false);
            if can_init_runtime {
                self.init_child_frame_runtime(child_id);
                self.execute_child_frame_scripts(child_id).await;
            }
        }
    }

    fn suspend_frame_runtime(frame: &mut PageFrame) {
        if let Some(js) = &frame.js {
            if let Some(dom) = js.take_dom() {
                frame.dom = Some(dom);
            }
        }
        frame.js = None;
    }

    pub(crate) fn suspend_child_frame_runtimes(&mut self) {
        for frame in self.frames.iter_mut().filter(|frame| frame.frame_id != self.frame_id) {
            Self::suspend_frame_runtime(frame);
        }
    }

    pub(crate) fn suspend_all_runtimes(&mut self) {
        self.suspend_child_frame_runtimes();
        if let Some(js) = &self.js {
            if let Some(dom) = js.take_dom() {
                self.dom = Some(dom);
            }
        }
        self.js = None;
    }

    fn init_child_frame_runtime(&mut self, frame_id: &str) {
        let proxy_url = self.context.proxy_url.clone();
        let cookie_jar = self.context.cookie_jar.clone();
        let blocked_url_patterns = self.blocked_url_patterns.clone();
        let intercept_tx = self.intercept_tx.clone();
        let intercept_enabled = self.intercept_enabled;
        let emulation_locale = self.emulation_locale.clone();
        let emulation_languages = self.emulation_languages.clone();
        let emulation_hardware_concurrency = self.emulation_hardware_concurrency;
        let context_platform = self.context.platform.clone();
        let context_ua_platform = self.context.ua_platform.clone();
        let context_ua_platform_version = self.context.ua_platform_version.clone();
        // Operator fingerprint overrides. Precomputed here (before frame_mut
        // borrows self) so the seed and config are available inside the frame
        // block without a borrow conflict.
        let fp = crate::fingerprint::FingerprintConfig::global();
        let fp_seed = fp.fp_seed.unwrap_or_else(|| fp_seed_for(&self.context.id));
        let fp_js_cfg = fp.js_cfg_json();
        let fp_geo = fp.geolocation;
        let fp_hw = fp.hardware_concurrency;
        let fp_langs = fp.languages.clone();
        let http_client = self.http_client.clone();
        #[cfg(feature = "stealth")]
        let stealth_enabled = self.stealth_client.is_some();
        #[cfg(feature = "stealth")]
        let stealth_client = self.stealth_client.clone();
        let user_agent = self.http_client.user_agent.try_read().ok().map(|ua| ua.clone());

        let Some(frame) = self.frame_mut(frame_id) else { return; };
        if frame.js.is_some() {
            return;
        }
        let Some(dom) = frame.dom.take() else { return; };
        let frame_url = frame.url_string();
        let frame_encoding = frame.encoding.clone();
        let frame_title = frame.title.clone();

        let mut rt = ObscuraJsRuntime::with_options(
            &frame_url,
            proxy_url,
            cookie_jar.clone(),
            #[cfg(feature = "stealth")]
            stealth_enabled,
            #[cfg(not(feature = "stealth"))]
            false,
        );
        rt.set_url(&frame_url);
        rt.set_encoding(&frame_encoding);
        rt.set_title(&frame_title);
        #[cfg(feature = "stealth")]
        if stealth_enabled {
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
            if let Some(ua) = user_agent.as_deref() {
                rt.set_user_agent(ua);
            }
            rt.set_platform(
                &context_platform,
                &context_ua_platform,
                &context_ua_platform_version,
            );
        }
        #[cfg(not(feature = "stealth"))]
        {
            if let Some(ua) = user_agent.as_deref() {
                rt.set_user_agent(ua);
            }
            rt.set_platform(
                &context_platform,
                &context_ua_platform,
                &context_ua_platform_version,
            );
        }
        if let Some((lat, lon)) = env_geolocation().or_else(|| fp_geo.map(|g| (g[0], g[1]))) {
            rt.set_geolocation(lat, lon);
        }
        rt.set_cookie_jar(cookie_jar);
        rt.set_http_client(http_client);
        rt.set_blocked_urls(blocked_url_patterns);
        #[cfg(feature = "stealth")]
        if let Some(ref stealth) = stealth_client {
            rt.set_stealth_client(stealth.clone());
        }
        if let Some(tx) = intercept_tx {
            rt.set_intercept_tx(tx);
        }
        rt.set_intercept_enabled(intercept_enabled);
        rt.set_dom(dom);
        if let Some(lang) = &emulation_locale {
            let langs = emulation_languages.clone().unwrap_or_else(|| vec![lang.clone()]);
            rt.set_locale(lang, &langs);
        } else if let Some(langs) = &fp_langs {
            if let Some(first) = langs.first() {
                rt.set_locale(first, langs);
            }
        }
        if let Some(hw) = emulation_hardware_concurrency.or(fp_hw) {
            rt.set_hardware_concurrency(hw);
        }
        if let Some(ref json) = fp_js_cfg {
            rt.set_fingerprint_cfg(json);
        }
        // Session-stable fingerprint seed (F1): same identity → same seed across
        // navigations and realms, so canvas/audio/WebGL/screen never drift.
        rt.set_fp_seed(fp_seed);
        rt.run_page_init();
        frame.js = Some(rt);
    }

    async fn execute_child_frame_scripts(&mut self, frame_id: &str) {
        let document_base = self.frame(frame_id).and_then(|frame| frame.url.clone());
        let all_scripts = match self.frame(frame_id).and_then(|frame| frame.js.as_ref()) {
            Some(js) => js.with_dom(|dom| {
                let script_ids = dom.query_selector_all("script").unwrap_or_default();
                let mut scripts = Vec::new();
                for sid in script_ids {
                    let Some(node) = dom.get_node(sid) else { continue; };
                    let src = node.get_attribute("src").map(|s| s.to_string());
                    let script_type = node.get_attribute("type").unwrap_or("").to_string();
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
                        scripts.push((src, inline_code));
                    }
                }
                scripts
            }).unwrap_or_default(),
            None => return,
        };

        for (src, inline_code) in all_scripts {
            if let Some(src_url) = src {
                let full_url = if src_url.starts_with("http://") || src_url.starts_with("https://") {
                    src_url
                } else if let Some(base) = &document_base {
                    base.join(&src_url).map(|u| u.to_string()).unwrap_or(src_url)
                } else {
                    src_url
                };
                if !subresource_allowed(self.url.as_ref(), &full_url) || self.should_block_url(&full_url) {
                    continue;
                }
                let Ok(parsed) = Url::parse(&full_url) else { continue; };
                let resp = match self.do_fetch(&parsed).await {
                    Ok(resp) => resp,
                    Err(_) => continue,
                };
                let code = obscura_net::decode_non_html(&resp.body, resp.content_type());
                if let Some(frame) = self.frame_mut(frame_id) {
                    if let Some(js) = frame.js.as_mut() {
                        let _ = js.execute_script_guarded(&full_url, &code);
                    }
                }
                continue;
            }
            if let Some(frame) = self.frame_mut(frame_id) {
                if let Some(js) = frame.js.as_mut() {
                    let _ = js.execute_script_guarded("<frame-inline>", &inline_code);
                }
            }
        }
    }

    pub(crate) fn sync_frame_snapshots_to_root_runtime(&mut self) {
        let snapshots: Vec<(String, String, String, bool)> = self
            .frames
            .iter()
            .filter(|frame| frame.frame_id != self.frame_id)
            .filter_map(|frame| {
                let html = if let Some(js) = frame.js.as_ref() {
                    js.with_dom(|dom| dom.outer_html(dom.document())).unwrap_or_default()
                } else {
                    frame.dom.as_ref().map(|dom| dom.outer_html(dom.document())).unwrap_or_default()
                };
                if html.is_empty() {
                    return None;
                }
                Some((
                    frame.frame_id.clone(),
                    html,
                    frame.url_string(),
                    frame_is_same_origin(self.url.as_ref(), frame.url.as_ref()),
                ))
            })
            .collect();
        if let Some(js) = self.js.as_ref() {
            js.clear_frame_snapshots();
            for (frame_id, html, url, same_origin) in snapshots {
                js.set_frame_snapshot(&frame_id, &html, &url, same_origin);
            }
        }
    }

}

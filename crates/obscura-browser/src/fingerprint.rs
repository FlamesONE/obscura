//! Runtime fingerprint configuration.
//!
//! Every spoofed surface (UA, platform, screen, WebGL, hardware, timezone,
//! geolocation, cookies) used to be either hardcoded in `bootstrap.js` or
//! picked from a seed-derived pool with no way to pin an exact identity. This
//! module lets the operator declare the whole fingerprint once, at init, from a
//! single JSON source — so the browser can present a chosen, coherent identity
//! (and preloaded cookies for a warmed session) instead of a fixed default.
//!
//! Source: the `OBSCURA_FP` env var, set directly or via the CLI
//! `--fingerprint` flag. The value is either inline JSON (`{...}`) or a path to
//! a JSON file (optionally `@`-prefixed). Parsed exactly once and shared by
//! every browser context in the process. Any field left unset falls back to the
//! existing per-seed default, so a partial config only overrides what it names.

use std::sync::OnceLock;

use obscura_net::CookieInfo;

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct FingerprintConfig {
    pub user_agent: Option<String>,
    /// `navigator.platform`, e.g. "Win32", "MacIntel", "Linux x86_64".
    pub platform: Option<String>,
    /// UA-CH platform, e.g. "Windows", "macOS", "Linux".
    pub ua_platform: Option<String>,
    pub ua_platform_version: Option<String>,
    /// `navigator.languages`; the first entry backs `navigator.language`.
    pub languages: Option<Vec<String>>,
    /// IANA zone id, e.g. "America/New_York". Also pins the process TZ so Date
    /// and Intl agree.
    pub timezone: Option<String>,
    pub hardware_concurrency: Option<u32>,
    pub device_memory: Option<f64>,
    /// [width, height] in CSS pixels.
    pub screen: Option<[u32; 2]>,
    pub color_depth: Option<u32>,
    /// WebGL `UNMASKED_VENDOR_WEBGL`, e.g. "Google Inc. (NVIDIA)".
    pub webgl_vendor: Option<String>,
    /// WebGL `UNMASKED_RENDERER_WEBGL`, the full "ANGLE (...)" string.
    pub webgl_renderer: Option<String>,
    /// [latitude, longitude].
    pub geolocation: Option<[f64; 2]>,
    /// Pin the fingerprint RNG seed (otherwise derived from the context id).
    pub fp_seed: Option<u32>,
    /// Cookies to preseed into the jar before the first navigation.
    pub cookies: Option<Vec<CookieSpec>>,
    /// TLS/HTTP2 impersonation profile (JA3/JA4). Consumed directly by the
    /// stealth HTTP client (obscura-net) from the same env; carried here so the
    /// full config validates as one schema.
    pub tls: Option<obscura_net::TlsConfig>,
}

/// A cookie to inject at startup. Only `name`/`value`/`domain` are required;
/// the rest default to a session cookie on `/`.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct CookieSpec {
    pub name: String,
    pub value: String,
    pub domain: String,
    #[serde(default = "default_path")]
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, alias = "httpOnly")]
    pub http_only: bool,
    #[serde(default = "default_same_site", alias = "sameSite")]
    pub same_site: String,
    #[serde(default)]
    pub expires: Option<i64>,
}

fn default_path() -> String {
    "/".to_string()
}
fn default_same_site() -> String {
    "Lax".to_string()
}

impl From<&CookieSpec> for CookieInfo {
    fn from(c: &CookieSpec) -> Self {
        CookieInfo {
            name: c.name.clone(),
            value: c.value.clone(),
            domain: c.domain.trim_start_matches('.').to_string(),
            path: c.path.clone(),
            secure: c.secure,
            http_only: c.http_only,
            same_site: c.same_site.clone(),
            expires: c.expires,
        }
    }
}

impl FingerprintConfig {
    /// The process-wide config, parsed once from `OBSCURA_FP`. Empty (all-None)
    /// when the var is unset or unparseable — callers then keep their defaults.
    pub fn global() -> &'static FingerprintConfig {
        static CFG: OnceLock<FingerprintConfig> = OnceLock::new();
        CFG.get_or_init(Self::from_env)
    }

    fn from_env() -> FingerprintConfig {
        let Some(raw) = std::env::var("OBSCURA_FP").ok().filter(|s| !s.trim().is_empty()) else {
            return FingerprintConfig::default();
        };
        let trimmed = raw.trim();
        // Inline JSON vs. a file path. A leading '{' is inline; anything else
        // (optionally '@'-prefixed) is a path to read.
        let json = if trimmed.starts_with('{') {
            trimmed.to_string()
        } else {
            let path = trimmed.strip_prefix('@').unwrap_or(trimmed);
            match std::fs::read_to_string(path) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("OBSCURA_FP: cannot read {}: {}", path, e);
                    return FingerprintConfig::default();
                }
            }
        };
        match serde_json::from_str::<FingerprintConfig>(&json) {
            Ok(cfg) => cfg,
            Err(e) => {
                tracing::warn!("OBSCURA_FP: invalid fingerprint JSON: {}", e);
                FingerprintConfig::default()
            }
        }
    }

    /// True when nothing was configured (fast path: skip all override work).
    pub fn is_empty(&self) -> bool {
        self.user_agent.is_none()
            && self.platform.is_none()
            && self.ua_platform.is_none()
            && self.ua_platform_version.is_none()
            && self.languages.is_none()
            && self.timezone.is_none()
            && self.hardware_concurrency.is_none()
            && self.device_memory.is_none()
            && self.screen.is_none()
            && self.color_depth.is_none()
            && self.webgl_vendor.is_none()
            && self.webgl_renderer.is_none()
            && self.geolocation.is_none()
            && self.fp_seed.is_none()
            && self.cookies.is_none()
            && self.tls.is_none()
    }

    /// JSON blob injected into JS as `globalThis.__obscura_fp_cfg`, carrying only
    /// the surfaces the bootstrap reads directly (the rest are applied Rust-side
    /// via `set_*`). Returns None when none of those fields are set.
    pub fn js_cfg_json(&self) -> Option<String> {
        #[derive(serde::Serialize)]
        struct JsCfg<'a> {
            #[serde(skip_serializing_if = "Option::is_none")]
            screen: &'a Option<[u32; 2]>,
            #[serde(skip_serializing_if = "Option::is_none")]
            color_depth: &'a Option<u32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            device_memory: &'a Option<f64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            hardware_concurrency: &'a Option<u32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            webgl_vendor: &'a Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            webgl_renderer: &'a Option<String>,
        }
        if self.screen.is_none()
            && self.color_depth.is_none()
            && self.device_memory.is_none()
            && self.hardware_concurrency.is_none()
            && self.webgl_vendor.is_none()
            && self.webgl_renderer.is_none()
        {
            return None;
        }
        serde_json::to_string(&JsCfg {
            screen: &self.screen,
            color_depth: &self.color_depth,
            device_memory: &self.device_memory,
            hardware_concurrency: &self.hardware_concurrency,
            webgl_vendor: &self.webgl_vendor,
            webgl_renderer: &self.webgl_renderer,
        })
        .ok()
    }

    /// Preseed configured cookies into `jar`. Called once at context creation so
    /// the very first navigation already carries a warmed session.
    pub fn preseed_cookies(&self, jar: &obscura_net::CookieJar) {
        let Some(cookies) = &self.cookies else { return };
        let infos: Vec<CookieInfo> = cookies.iter().map(CookieInfo::from).collect();
        if !infos.is_empty() {
            let n = infos.len();
            jar.set_cookies_from_cdp(infos);
            tracing::info!("Preseeded {} fingerprint cookie(s)", n);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_config_only_overrides_named_fields() {
        let cfg: FingerprintConfig =
            serde_json::from_str(r#"{"screen":[2560,1440],"webgl_renderer":"ANGLE (Test)"}"#)
                .unwrap();
        assert_eq!(cfg.screen, Some([2560, 1440]));
        assert!(cfg.user_agent.is_none());
        assert!(!cfg.is_empty());
        let js = cfg.js_cfg_json().unwrap();
        assert!(js.contains("2560"));
        assert!(js.contains("ANGLE (Test)"));
        // Rust-only field must not leak into the JS blob.
        assert!(!js.contains("user_agent"));
    }

    #[test]
    fn empty_config_yields_no_js_blob() {
        let cfg = FingerprintConfig::default();
        assert!(cfg.is_empty());
        assert!(cfg.js_cfg_json().is_none());
    }

    #[test]
    fn cookie_spec_defaults_fill_in() {
        let cfg: FingerprintConfig = serde_json::from_str(
            r#"{"cookies":[{"name":"sid","value":"abc","domain":".example.com"}]}"#,
        )
        .unwrap();
        let c = &cfg.cookies.unwrap()[0];
        assert_eq!(c.path, "/");
        assert_eq!(c.same_site, "Lax");
        let info: CookieInfo = c.into();
        assert_eq!(info.domain, "example.com");
    }
}

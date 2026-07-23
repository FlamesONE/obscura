//! Configurable TLS/HTTP2 impersonation profile (JA3/JA4).
//!
//! The stealth client's ClientHello — and therefore its JA3/JA4 hash — is
//! determined by the wreq emulation profile. It used to be hardcoded to
//! Chrome147/Windows; this module lets the operator pick any wreq profile from
//! the same `OBSCURA_FP` JSON that drives the JS-visible fingerprint, under a
//! `"tls"` key:
//!
//! ```json
//! { "tls": { "profile": "chrome_131", "platform": "windows" } }
//! ```
//!
//! Profile names are wreq's serde ids (`chrome_147`, `firefox_143`,
//! `safari_18`, `edge_147`, …); platforms are `windows`/`macos`/`linux`/
//! `android`/`ios`. Unset or unknown values fall back to the built-in default.
//!
//! NOTE: the wire TLS identity and the JS-visible identity must agree. When you
//! override `tls.profile` to a non-Chrome147 browser, also set `user_agent` /
//! `platform` / `ua_platform` in the same config so a detector comparing the
//! ClientHello against `navigator` sees one coherent browser.

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct TlsConfig {
    /// wreq profile serde id, e.g. "chrome_147", "firefox_143", "safari_18".
    pub profile: Option<String>,
    /// Target OS: "windows", "macos", "linux", "android", "ios".
    pub platform: Option<String>,
}

impl TlsConfig {
    /// Extract the `tls` object from the `OBSCURA_FP` env (inline JSON or a
    /// file path, optionally `@`-prefixed). Empty when unset/unparseable.
    pub fn from_env() -> TlsConfig {
        let Some(raw) = std::env::var("OBSCURA_FP").ok().filter(|s| !s.trim().is_empty()) else {
            return TlsConfig::default();
        };
        let trimmed = raw.trim();
        let json = if trimmed.starts_with('{') {
            trimmed.to_string()
        } else {
            let path = trimmed.strip_prefix('@').unwrap_or(trimmed);
            match std::fs::read_to_string(path) {
                Ok(s) => s,
                Err(_) => return TlsConfig::default(),
            }
        };
        let value: serde_json::Value = match serde_json::from_str(&json) {
            Ok(v) => v,
            Err(_) => return TlsConfig::default(),
        };
        match value.get("tls") {
            Some(tls) => serde_json::from_value(tls.clone()).unwrap_or_default(),
            None => TlsConfig::default(),
        }
    }

    /// Resolve the configured profile name to a wreq profile. None → caller
    /// keeps its default. Unknown names log a warning and fall back to default.
    #[cfg(feature = "stealth")]
    pub fn resolve_profile(&self) -> Option<wreq_util::Profile> {
        let name = self.profile.as_deref()?;
        match serde_json::from_value::<wreq_util::Profile>(serde_json::Value::String(name.to_string())) {
            Ok(p) => Some(p),
            Err(_) => {
                tracing::warn!("OBSCURA_FP tls.profile '{}' unknown; using default", name);
                None
            }
        }
    }

    /// Resolve the configured platform name to a wreq platform.
    #[cfg(feature = "stealth")]
    pub fn resolve_platform(&self) -> Option<wreq_util::Platform> {
        let name = self.platform.as_deref()?;
        match serde_json::from_value::<wreq_util::Platform>(serde_json::Value::String(name.to_string())) {
            Ok(p) => Some(p),
            Err(_) => {
                tracing::warn!("OBSCURA_FP tls.platform '{}' unknown; using default", name);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tls_from_full_fp_json() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"user_agent":"x","tls":{"profile":"chrome_131","platform":"macos"}}"#)
                .unwrap();
        let tls: TlsConfig = serde_json::from_value(v.get("tls").unwrap().clone()).unwrap();
        assert_eq!(tls.profile.as_deref(), Some("chrome_131"));
        assert_eq!(tls.platform.as_deref(), Some("macos"));
    }

    #[cfg(feature = "stealth")]
    #[test]
    fn resolves_known_profile_and_platform() {
        let tls = TlsConfig {
            profile: Some("chrome_131".to_string()),
            platform: Some("windows".to_string()),
        };
        assert!(tls.resolve_profile().is_some());
        assert!(tls.resolve_platform().is_some());
        let bad = TlsConfig { profile: Some("nope_9".to_string()), platform: None };
        assert!(bad.resolve_profile().is_none());
    }
}

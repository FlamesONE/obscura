use serde_json::{json, Value};

use crate::dispatch::CdpContext;

pub async fn handle(
    method: &str,
    params: &Value,
    ctx: &mut CdpContext,
    session_id: &Option<String>,
) -> Result<Value, String> {
    match method {
        "setTimezoneOverride" => {
            let tz = params
                .get("timezoneId")
                .and_then(|v| v.as_str())
                .ok_or("timezoneId required")?;
            ctx.emulation_timezone = Some(tz.to_string());
            // Apply to current page JS
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                if let Some(js) = &mut page.js {
                    js.set_timezone(tz);
                }
            }
            // Set process env TZ for native Intl/Date consistency
            std::env::set_var("TZ", tz);
            Ok(json!({}))
        }
        "setLocaleOverride" => {
            let locale = params
                .get("locale")
                .and_then(|v| v.as_str())
                .ok_or("locale required")?;
            let locale_str = locale.to_string();
            let languages = vec![
                locale_str.clone(),
                locale_str.split('-').next().unwrap_or("en").to_string(),
            ];
            ctx.emulation_locale = Some(locale_str.clone());
            ctx.emulation_languages = Some(languages.clone());
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                if let Some(js) = &mut page.js {
                    js.set_locale(&locale_str, &languages);
                }
                page.emulation_locale = Some(locale_str.clone());
                page.emulation_languages = Some(languages);
            }
            Ok(json!({}))
        }
        "setHardwareConcurrencyOverride" => {
            let hw = params
                .get("hardwareConcurrency")
                .and_then(|v| v.as_u64())
                .ok_or("hardwareConcurrency required")? as u32;
            ctx.emulation_hardware_concurrency = Some(hw);
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                if let Some(js) = &mut page.js {
                    js.set_hardware_concurrency(hw);
                }
                page.emulation_hardware_concurrency = Some(hw);
            }
            Ok(json!({}))
        }
        "setUserAgentOverride" => {
            // Delegate to Network.setUserAgentOverride
            let ua = params.get("userAgent").and_then(|v| v.as_str()).unwrap_or("");
            let accept_language = params.get("acceptLanguage").and_then(|v| v.as_str());
            let platform = params.get("platform").and_then(|v| v.as_str());
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                page.http_client.set_user_agent(ua).await;
            }
            // Re-inject into JS runtime if it exists
            if let Some(page) = ctx.get_session_page_mut(session_id) {
                if let Some(js) = &mut page.js {
                    js.set_user_agent(ua);
                    if let Some(lang) = accept_language {
                        let langs = vec![lang.to_string()];
                        js.set_locale(lang, &langs);
                    }
                    if let Some(plat) = platform {
                        let ua_plat = if plat.contains("Win") { "Windows" } else if plat.contains("Mac") { "macOS" } else { "Linux" };
                        js.set_platform(plat, ua_plat, "");
                    }
                }
            }
            Ok(json!({}))
        }
        "setDisabledImageTypes" => Ok(json!({})),
        "setVirtualTimePolicy" => Ok(json!({})),
        _ => Err(format!("Unknown Emulation method: {}", method)),
    }
}

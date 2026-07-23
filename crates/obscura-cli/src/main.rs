use clap::Parser;

use crate::cli::{Args, Command, DumpFormat};
use crate::commands::{
    read_urls_from_file, run_batch_fetch, run_fetch, run_multi_worker_serve, run_parallel_scrape,
};

mod cli;
mod commands;
mod dump;

fn print_banner(port: u16) {
    println!(r#"
   ____  _                              
  / __ \| |                             
 | |  | | |__  ___  ___ _   _ _ __ __ _ 
 | |  | | '_ \/ __|/ __| | | | '__/ _` |
 | |__| | |_) \__ \ (__| |_| | | | (_| |
  \____/|_.__/|___/\___|\__,_|_|  \__,_|
                   
  Headless Browser v{}
  CDP server: ws://127.0.0.1:{}/devtools/browser
"#, env!("OBSCURA_BUILD_VERSION"), port);
}

fn select_log_filter(verbose: bool, quiet: bool) -> &'static str {
    if verbose {
        "debug"
    } else if quiet {
        "off"
    } else {
        "warn"
    }
}

fn is_quiet_command(cmd: &Option<Command>) -> bool {
    matches!(
        cmd,
        Some(Command::Fetch { quiet: true, .. })
            | Some(Command::Scrape { quiet: true, .. })
            | Some(Command::Serve { quiet: true, .. })
    )
}

fn merge_proxy(global_proxy: Option<String>, command_proxy: Option<String>) -> Option<String> {
    command_proxy.or(global_proxy)
}

/// Normalize a raw `--v8-flags` value into the string we'll hand to V8.
/// Returns `None` when the user didn't pass the flag, passed an empty string,
/// or passed only whitespace; in those cases V8 is left untouched.
fn normalize_v8_flags(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Default V8 flags applied at startup unless the user disabled them via
/// `--v8-flags`. The default heap matches headless Chrome (~4 GB) so pages
/// that ship heavy fingerprinting or analytics bundles
/// (e.g. demo.fingerprint.com — issue #199) don't SIGTRAP out of the box.
/// V8 parses flags left-to-right and later wins, so anything the user
/// passes via `--v8-flags` overrides these.
///
/// `--max-semi-space-size=4` caps V8's young generation (default 16 MB per
/// semi-space) so a parse/JS allocation burst does not inflate RSS, and
/// `--optimize-for-size` trades memory-heavy codegen choices for a smaller
/// footprint. Together they cut RSS ~18% on heavy pages (ycombinator.com
/// 173 MB -> 140 MB) at no measurable speed cost (V8 still JITs hot paths).
#[cfg(target_pointer_width = "64")]
const DEFAULT_V8_FLAGS: &str = "--max-old-space-size=4096 --max-semi-space-size=4 --optimize-for-size";
#[cfg(not(target_pointer_width = "64"))]
const DEFAULT_V8_FLAGS: &str = "--max-old-space-size=1024 --max-semi-space-size=4 --optimize-for-size";

fn effective_v8_flags(user: Option<&str>) -> String {
    match normalize_v8_flags(user) {
        Some(u) => format!("{} {}", DEFAULT_V8_FLAGS, u),
        None => DEFAULT_V8_FLAGS.to_string(),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Mirror --fingerprint into OBSCURA_FP so every subcommand and spawned
    // worker (which inherit this process's env) read one config source. Must run
    // before the first FingerprintConfig::global() call below (it caches once).
    // An explicit OBSCURA_FP in the environment wins.
    // SAFETY: single-threaded here, before any isolate/worker starts.
    if let Some(ref fp) = args.fingerprint {
        if std::env::var_os("OBSCURA_FP").is_none() {
            unsafe { std::env::set_var("OBSCURA_FP", fp); }
        }
    }

    // Pin the process timezone before V8/ICU reads it. V8 sources the zone for
    // both Date (getTimezoneOffset, toString) and Intl.DateTimeFormat from TZ; left
    // unset it defaults to UTC for Date while the page layer advertised a different
    // zone, a cross-surface mismatch fingerprinting scripts flag. Default to
    // Europe/Berlin; set OBSCURA_TIMEZONE to match the exit IP's region. An existing
    // TZ from the host is respected.
    // SAFETY: runs before any V8 isolate or worker thread starts, so the env is
    // effectively single threaded here.
    if let Some(tz) = std::env::var("OBSCURA_TIMEZONE").ok().filter(|s| !s.trim().is_empty()) {
        unsafe { std::env::set_var("TZ", tz); }
    } else if let Some(tz) = obscura_browser::FingerprintConfig::global()
        .timezone
        .clone()
        .filter(|s| !s.trim().is_empty())
    {
        // An explicit fingerprint-config timezone is an operator choice, so it
        // wins over the host TZ (keeps Date and Intl agreeing with the identity).
        unsafe { std::env::set_var("TZ", tz); }
    } else if std::env::var_os("TZ").is_none() {
        unsafe { std::env::set_var("TZ", "Europe/Berlin"); }
    }

    let quiet = is_quiet_command(&args.command);
    let filter = select_log_filter(args.verbose, quiet);
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(filter)),
        )
        .with_writer(std::io::stderr)
        .init();

    let v8_flags = effective_v8_flags(args.v8_flags.as_deref());
    tracing::debug!("V8 flags: {}", v8_flags);
    obscura_js::set_v8_flags(&v8_flags);

    // The js-side fetch path (op_fetch_url) reads OBSCURA_ALLOW_PRIVATE_NETWORK
    // directly for its SSRF gate. Mirror the CLI flag into the env var so
    // iframe loads and JS fetch() see the same policy the http_client layer
    // already uses (issue #33).
    if args.allow_private_network {
        // SAFETY: set_var is unsafe in newer rustc; this runs before any
        // spawned thread inspects the env, so it's effectively single
        // threaded at this point.
        unsafe { std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1"); }
    }

    let global_proxy = args.proxy.clone();
    let stealth = args.stealth;

    match args.command {
        Some(Command::Serve { port, host, proxy, user_agent, workers, max_connections, allow_file_access, storage_dir, quiet: _ }) => {
            // Fall back to OBSCURA_PROXY so a proxy can be supplied without
            // putting credentials on the command line. The multi-worker load
            // balancer passes the proxy to each worker this way (issue #366).
            let proxy = merge_proxy(global_proxy.clone(), proxy)
                .or_else(|| std::env::var("OBSCURA_PROXY").ok().filter(|s| !s.is_empty()));
            print_banner(port);
            if let Some(ref dir) = storage_dir {
                tracing::info!("Storage dir: {}", dir.display());
            }
            if let Some(ref proxy) = proxy {
                tracing::info!("Using proxy: {}", proxy);
            }
            if let Some(ref ua) = user_agent {
                tracing::info!("User-Agent: {}", ua);
            }
            if stealth {
                #[cfg(feature = "stealth")]
                tracing::info!(
                    "Stealth mode enabled (TLS fingerprint impersonation + tracker blocking)"
                );
                #[cfg(not(feature = "stealth"))]
                tracing::info!("Stealth mode enabled (tracker blocking)");
            }

            if workers > 1 {
                tracing::info!("{} worker processes", workers);
                run_multi_worker_serve(port, host, workers, proxy, stealth, user_agent).await?;
            } else {
                obscura_cdp::start_with_serve_options_and_limit(
                    port, &host, proxy, stealth, user_agent, allow_file_access, storage_dir,
                    args.allow_private_network, max_connections,
                ).await?;
            }
        }
        Some(Command::Fetch { url, dump, selector, wait, timeout, wait_until, user_agent, eval, output, quiet, storage_dir, file, concurrency }) => {
            if let Some(file) = file {
                if url.is_some() {
                    anyhow::bail!("Pass URLs via a positional argument or --file, not both.");
                }
                // Batch mode is raw HTTP only. Rendering each URL through the
                // browser/JS stack is what `scrape` is for.
                match dump {
                    None | Some(DumpFormat::Original) => {}
                    Some(_) => anyhow::bail!(
                        "batch mode (--file) only supports --dump original. Use `scrape` for rendered/DOM output."
                    ),
                }
                let urls = read_urls_from_file(&file)?;
                run_batch_fetch(urls, concurrency.get(), timeout, user_agent, global_proxy, output, quiet).await?;
            } else {
                let url = url.ok_or_else(|| {
                    anyhow::anyhow!("No URL provided. Pass a URL, or a list of URLs with --file <path>.")
                })?;
                run_fetch(&url, dump, selector, wait, timeout, &wait_until, user_agent, stealth, eval, output, quiet, global_proxy, storage_dir, args.allow_private_network).await?;
            }
        }
        Some(Command::Scrape { urls, eval, concurrency, format, timeout, quiet }) => {
            run_parallel_scrape(urls, eval, concurrency.get(), &format, timeout, quiet, global_proxy, stealth).await?;
        }
        Some(Command::Mcp { http, host, port, proxy, user_agent }) => {
            let mcp_proxy = merge_proxy(global_proxy.clone(), proxy);
            if http {
                obscura_mcp::http::run(host, port, mcp_proxy, user_agent, stealth).await?;
            } else {
                obscura_mcp::run(mcp_proxy, user_agent, stealth).await?;
            }
        }
        None => {
            print_banner(args.port);
            if let Some(ref proxy) = args.proxy {
                tracing::info!("Using proxy: {}", proxy);
            }
            obscura_cdp::start_with_options(args.port, args.proxy, stealth).await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests;

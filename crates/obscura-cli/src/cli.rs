use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "obscura",
    version = env!("OBSCURA_BUILD_VERSION"),
    about = "Obscura - A lightweight headless browser for web scraping and automation",
)]
pub(crate) struct Args {
    #[arg(short, long, global = true)]
    pub(crate) verbose: bool,

    #[command(subcommand)]
    pub(crate) command: Option<Command>,

    #[arg(short, long, default_value_t = 9222)]
    pub(crate) port: u16,

    #[arg(long, global = true)]
    pub(crate) proxy: Option<String>,

    /// Enable stealth mode (consistent browser fingerprint, and with the
    /// `stealth` build feature, TLS impersonation plus tracker blocking).
    /// Global: applies to fetch, serve, scrape, and mcp.
    #[arg(long, global = true)]
    pub(crate) stealth: bool,

    #[arg(long)]
    pub(crate) obey_robots: bool,

    #[arg(long)]
    pub(crate) user_agent: Option<String>,

    #[arg(long)]
    pub(crate) storage_dir: Option<std::path::PathBuf>,

    /// Permit fetches to loopback, RFC1918, and link-local addresses.
    /// Default is to block them (SSRF fix from #4). Use this for local
    /// development against http://localhost:N or http://192.168.x.y.
    /// Equivalent to `OBSCURA_ALLOW_PRIVATE_NETWORK=1` but per-process
    /// and survives in command pipelines.
    #[arg(long, global = true)]
    pub(crate) allow_private_network: bool,

    /// Pass raw flags to V8, in the same form V8/Chromium/Node accept
    /// (e.g. `"--max-old-space-size=4096 --max-semi-space-size=64 --expose-gc"`).
    /// Applied once at startup before any isolate is created.
    #[arg(long, value_name = "FLAGS", allow_hyphen_values = true)]
    pub(crate) v8_flags: Option<String>,

    /// Fingerprint config: inline JSON or a path to a JSON file (optionally
    /// `@`-prefixed). Declares the browser identity to present — user_agent,
    /// platform, screen, color_depth, webgl_vendor/renderer, hardware_concurrency,
    /// device_memory, languages, timezone, geolocation, cookies, and the TLS
    /// JA3/JA4 profile (`tls`). Any field left unset keeps the per-seed default.
    /// Sets OBSCURA_FP for every subcommand and spawned worker. Global.
    #[arg(long, global = true, value_name = "JSON|PATH")]
    pub(crate) fingerprint: Option<String>,
}

#[derive(Subcommand)]
pub(crate) enum Command {
    Serve {
        #[arg(short, long, default_value_t = 9222)]
        port: u16,

        // Bind address. Defaults to 127.0.0.1 (loopback only) for safety.
        // Set to 0.0.0.0 to listen on all interfaces (e.g. inside a Docker
        // container where you want the port to be reachable from the host
        // via -p mapping).
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        #[arg(long)]
        proxy: Option<String>,

        #[arg(long)]
        user_agent: Option<String>,

        #[arg(long, default_value_t = 1)]
        workers: u16,

        /// Maximum live CDP connections. Each connection runs on its own OS
        /// thread with its own V8 isolates, so this bounds the server's thread
        /// and memory footprint. Connections beyond the limit are refused with
        /// a 503 rather than queued.
        #[arg(long, default_value_t = obscura_cdp::DEFAULT_MAX_CONNECTIONS)]
        max_connections: usize,

        /// Allow CDP clients to navigate to file:// URLs. Off by
        /// default so a CDP connection cannot read arbitrary local
        /// files. Enable only when serving local HTML for testing
        /// and the port is on a trusted network.
        #[arg(long)]
        allow_file_access: bool,

        #[arg(long)]
        storage_dir: Option<std::path::PathBuf>,

        /// Suppress all logs (same as on `fetch`). Useful when scraping pages
        /// that flood the console with per-page script warnings (issue #264).
        #[arg(long)]
        quiet: bool,
    },

    Fetch {
        // Optional so a batch run can pass URLs via --file instead. A single
        // positional URL keeps the original one-shot behaviour.
        url: Option<String>,

        // Default is html. Kept as Option so we can tell whether --dump was
        // explicitly passed: a bare --eval returns its own value, while --eval
        // combined with --dump (or --selector) runs the eval, lets its async
        // work settle, then reads the page (issue #248).
        #[arg(long)]
        dump: Option<DumpFormat>,

        /// Read newline-delimited URLs from a file (one per line; blank lines
        /// and lines starting with `#` are skipped). Use `-` for stdin. Enables
        /// batch mode: every URL is fetched raw (--dump original) and one JSON
        /// status line is printed per URL. For rendered/DOM batch output use
        /// `scrape` instead (issue #349).
        #[arg(long)]
        file: Option<std::path::PathBuf>,

        /// Number of URLs fetched concurrently in batch mode. Ignored without
        /// --file.
        #[arg(long, default_value_t = std::num::NonZeroUsize::new(1).unwrap())]
        concurrency: std::num::NonZeroUsize,

        #[arg(long)]
        selector: Option<String>,

        #[arg(long, default_value_t = 5)]
        wait: u64,

        #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..))]
        timeout: u64,

        #[arg(long, default_value = "load")]
        wait_until: String,

        #[arg(long)]
        user_agent: Option<String>,

        #[arg(long, short)]
        eval: Option<String>,

        #[arg(long, short = 'o')]
        output: Option<std::path::PathBuf>,

        #[arg(long, short)]
        quiet: bool,

        #[arg(long)]
        storage_dir: Option<std::path::PathBuf>,
    },

    Scrape {
        urls: Vec<String>,

        #[arg(long, short)]
        eval: Option<String>,

        #[arg(long, default_value_t = std::num::NonZeroUsize::new(10).unwrap())]
        concurrency: std::num::NonZeroUsize,

        #[arg(long, default_value = "json")]
        format: String,

        #[arg(long, default_value_t = 60, value_parser = clap::value_parser!(u64).range(1..))]
        timeout: u64,

        #[arg(long, short)]
        quiet: bool,
    },

    Mcp {
        #[arg(long)]
        http: bool,

        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        #[arg(long, default_value_t = 3000)]
        port: u16,

        #[arg(long)]
        proxy: Option<String>,

        #[arg(long)]
        user_agent: Option<String>,
    },

}


#[derive(Clone, Debug, clap::ValueEnum, PartialEq, Eq)]
pub(crate) enum DumpFormat {
    Html,
    Text,
    Links,
    Markdown,
    /// Stream the raw HTTP response body verbatim (binary-safe).
    /// Bypasses the browser/JS layer — useful for fetching images,
    /// JSON, JS, CSS, or any non-HTML resource (cf. issue #117).
    Original,
    /// One JSON object per line listing every sub-resource URL the
    /// rendered page references (script src, link href, img src,
    /// iframe src, media sources, embed/object data). Lets callers
    /// replay the asset graph with their own HTTP client when they
    /// need the originals alongside the page (cf. issue 124).
    Assets,
    /// Dump all cookies in the browser jar as a JSON array, including
    /// HttpOnly cookies that are inaccessible via document.cookie.
    /// Useful for extracting session tokens set by anti-bot challenges.
    Cookies,
}

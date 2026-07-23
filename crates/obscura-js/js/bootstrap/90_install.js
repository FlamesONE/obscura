function _installTurnstileHook() {
  if (globalThis.__obscura_turnstile_hook_installed) return;
  globalThis.__obscura_turnstile_hook_installed = true;
  let current;
  const wrap = (turnstile) => {
    if (!turnstile || typeof turnstile.render !== 'function' || turnstile.__obscuraHooked) {
      return turnstile;
    }
    const originalRender = turnstile.render;
    turnstile.render = function(container, params) {
      try {
        if (params) {
          if (params.sitekey) globalThis.__capturedSitekey = params.sitekey;
          if (params.action) globalThis.__capturedAction = params.action;
          if (params.cData) globalThis.__capturedCdata = params.cData;
          if (params.chlPageData) globalThis.__capturedChlPageData = params.chlPageData;
          if (typeof params.callback === 'function') {
            globalThis.__capturedTurnstileCallback = params.callback;
          }
        }
      } catch (e) {}
      return originalRender.apply(this, arguments);
    };
    try {
      if (typeof turnstile.getResponse === 'function' && !turnstile.__obscuraGetResponsePatched) {
        const originalGetResponse = turnstile.getResponse;
        turnstile.getResponse = function() {
          if (globalThis.__obscura_turnstile_token) return globalThis.__obscura_turnstile_token;
          return originalGetResponse.apply(this, arguments);
        };
        turnstile.__obscuraGetResponsePatched = true;
      }
    } catch (e) {}
    turnstile.__obscuraHooked = true;
    return turnstile;
  };
  try {
    Object.defineProperty(globalThis, 'turnstile', {
      configurable: true,
      get() { return current; },
      set(value) { current = wrap(value); },
    });
  } catch (e) {}
  try {
    if (globalThis.turnstile) wrap(globalThis.turnstile);
  } catch (e) {}
}

function _captureTurnstileSitekeyFromDom() {
  try {
    const el = document.querySelector('div.cf-turnstile, .cf-turnstile, [data-sitekey]');
    const key = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-sitekey') : null;
    if (key && !globalThis.__capturedSitekey) globalThis.__capturedSitekey = key;
  } catch (e) {}
  try {
    const frame = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
    const src = frame && typeof frame.getAttribute === 'function' ? (frame.getAttribute('src') || frame.src || '') : '';
    if (src && !globalThis.__capturedSitekey) {
      const m = src.match(/[?&](?:sitekey|k)=([^&#]+)/i);
      if (m && m[1]) globalThis.__capturedSitekey = decodeURIComponent(m[1]);
    }
  } catch (e) {}
}

function _setTurnstileToken(token) {
  globalThis.__obscura_turnstile_token = token || '';
  try {
    const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && typeof desc.set === 'function') desc.set.call(input, token || '');
        else input.value = token || '';
      } catch (e) {
        input.value = token || '';
      }
      try { input.setAttribute('value', token || ''); } catch (e) {}
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }
  } catch (e) {}
  try {
    if (typeof globalThis.__capturedTurnstileCallback === 'function') {
      globalThis.__capturedTurnstileCallback(token || '');
    }
  } catch (e) {}
  try {
    if (globalThis.turnstile && typeof globalThis.turnstile.getResponse === 'function') {
      globalThis.turnstile.getResponse = function() { return token || ''; };
    }
  } catch (e) {}
  try {
    if (globalThis.turnstile && typeof globalThis.turnstile.execute === 'function') {
      globalThis.turnstile.execute();
    }
  } catch (e) {}
}

globalThis.__obscura_init = function() {
  // Refresh the op-bridge capture from this navigation's fresh isolate, then
  // remove the global `Deno` so page/CF script sees `typeof Deno === "undefined"`
  // like a real browser. Must run before the first op call below (_dom).
  try { if (typeof Deno !== "undefined" && Deno.core) __obscura_core = Deno.core; } catch (e) {}
  try { delete globalThis.Deno; } catch (e) {}
  // Session-stable seed injected by Rust (set_fp_seed, derived from the browser
  // context identity) so canvas/audio/WebGL/screen are byte-identical across
  // navigations and realms — store-and-compare detectors flag drift. Clock
  // fallback only for bare-JS unit tests where Rust never injects a seed.
  _fpSeed = (globalThis.__obscura_fp_seed >>> 0) || (Date.now() ^ (Math.random() * 0xFFFFFFFF >>> 0));
  _fpCache = null;
  // A real navigation just completed (this runs after set_url), so drop any
  // URL a location setter previewed synchronously and let document_url drive
  // location.href again, including any redirect target.
  globalThis.__virtualUrl = null;
  _installWasmStreamingFallback();
  _installTurnstileHook();

  globalThis.document = new Document(+_dom("document_node_id"));
  _captureTurnstileSitekeyFromDom();

  const scr = _fp('screen');
  const sw = scr[0], sh = scr[1];
  globalThis.screen = new Screen(sw, sh);
  globalThis.visualViewport = { width:sw, height:sh-80, offsetLeft:0, offsetTop:0, scale:1, addEventListener(){}, removeEventListener(){} };
  globalThis.devicePixelRatio = sw >= 2560 ? 2 : 1;
  globalThis.innerWidth = sw; globalThis.innerHeight = sh - 80;
  globalThis.outerWidth = sw; globalThis.outerHeight = sh - 40;

  var _fpc = globalThis.__obscura_fp_cfg || {};
  var hwValues = globalThis.__obscura_stealth ? [4, 6, 8, 12, 16] : [2, 4, 6, 8, 12, 16];
  globalThis.__obscura_hw = _fpc.hardware_concurrency || hwValues[Math.floor(_fpRand(400) * hwValues.length)];
  var memValues = globalThis.__obscura_stealth ? [4, 8] : [0.25, 0.5, 1, 2, 4, 8];
  globalThis.__obscura_mem = _fpc.device_memory || memValues[Math.floor(_fpRand(401) * memValues.length)];

  const t0 = Date.now() + Math.floor(_fpRand(641) * 100) - 50;
  globalThis.performance.timeOrigin = t0;
  globalThis.performance.timing = { navigationStart: t0, domContentLoadedEventEnd: t0, loadEventEnd: t0 };
  var _totalHeap = 15000000 + Math.floor(_fpRand(620) * 85000000);
  globalThis.performance.memory = {
    jsHeapSizeLimit: 4294705152,
    totalJSHeapSize: _totalHeap,
    usedJSHeapSize: Math.floor(_totalHeap * (0.3 + _fpRand(621) * 0.5)),
  };
  globalThis.Notification.permission = "default";

  // userAgentData brands and getHighEntropyValues now derive the Chrome
  // version from navigator.userAgent and read the platform from the page
  // globals, so every stealth surface agrees without a per-mode override.

  // Hide internals (_*, obscura, Obscura). The set of keys is static at
  // snapshot-build time, so we precompute it ONCE below (after this
  // function definition) and reuse it on every page init. Was an
  // Object.keys + filter on every navigation, ~5-40ms per page on
  // SPAs that load 1000+ globals.
  const toHide = globalThis.__obscura_hide_list || [];
  for (let i = 0; i < toHide.length; i++) {
    try { Object.defineProperty(globalThis, toHide[i], { enumerable: false }); } catch(e) {}
  }
  delete globalThis.__obscura_init;
};

// Snapshot-time pre-computation of the hide list. Bootstrap.js runs once
// during the V8 snapshot build (build.rs); this line captures the set of
// globals defined by bootstrap that we want to hide and stashes them
// for __obscura_init to consume on every subsequent page. The snapshot
// preserves the array as a regular global.
// Use getOwnPropertyNames, not Object.keys: the internal globals declared by
// _preHideInternals are already non-enumerable, so Object.keys would omit them
// and leave them out of the hide list (and thus visible to the reflection-API
// filter and to fingerprinting scripts). getOwnPropertyNames captures them.
globalThis.__obscura_hide_list = Object.getOwnPropertyNames(globalThis).filter(k =>
  k.startsWith('_') || k.includes('obscura') || k.includes('Obscura')
);


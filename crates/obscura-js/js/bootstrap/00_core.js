"use strict";

// Captured reference to the deno_core op bridge. Every internal op call goes
// through this lexical binding (`__obscura_core.ops.*`) instead of the global
// `Deno` object, so we can delete `globalThis.Deno` at page-init time without
// breaking ops. `typeof Deno` then reads `undefined` to page/CF script — the
// deno bridge was an instant, trivially-scriptable bot tell (probe confirmed
// `typeof Deno === "object"`). Refreshed at runtime in __obscura_init before
// the first op call, so the snapshot-time value here is only a fallback.
let __obscura_core = (typeof Deno !== "undefined" && Deno.core) ? Deno.core : null;

// Pre-declare all internal globals as non-enumerable so they are invisible
// to Object.keys(window) / for-in enumeration. Must run before any var
// declarations or property assignments below: once a property is defined
// with enumerable:false here, subsequent `var x = value` assignments will
// find the property already exists and only update the value, leaving the
// descriptor intact. Direct globalThis.x = value assignments also only
// update the value without touching enumerable when the property is
// writable:true and configurable:true.
(function _preHideInternals() {
  var _names = [
    // runtime-set by Rust (runtime.rs / page.rs)
    '__obscura_errors', '__obscura_init', '__obscura_hide_list',
    '__obscura_objects', '__obscura_oid', '__obscura_ua',
    '__obscura_await_meta', '__obscura_await_rejected', '__obscura_fp_seed',
    '__obscura_geo_lat', '__obscura_geo_lon', '__obscura_set',
    '__obscura_platform', '__obscura_ua_platform', '__obscura_ua_platform_version',
    '__obscura_stealth', '__obscura_markTrusted',
    '__obscura_language', '__obscura_languages',
    '__obscura_timezone', '__obscura_hardware_concurrency',
    '__obscura_turnstile_hook_installed', '__obscura_turnstile_token',
    '__capturedSitekey', '__capturedAction', '__capturedCdata',
    '__capturedChlPageData', '__capturedTurnstileCallback',
    '__obscura_hw', '__obscura_mem', '__obscura_fp_cfg',
    '__documentReadyState__', '__currentUrl',
    // internal helpers (var-declared throughout the file)
    '__processDynScriptQueue', '_markNative', '_fpRand', '_fpNoise',
    '_fpCache', '_getFp', '_fp', '_splitAsciiWhitespace',
    '_getElementsByClassName', '_docEncoding', '_docIsUtf8',
    '_isSpecialScheme', '_applyDocQueryEncoding', '_anchorBase',
    '_elemHrefURL', '_setElemHrefPart', '_pad', '_daysInMonth',
    '_isoWeek1Monday', '_inputParseNumber', '_inputFormatNumber',
    '_htmlAttrName', '_convertNodes', '_elementClassFor', '_wrap', '_wrapEl',
    '_resolveUrl', '_registerIframe', '_base64ToUint8Array',
    '_bodyToUint8Array', '_arrayBufferFromBytes',
    '_installWasmStreamingFallback', '_urlParseOp', '_urlSetOp',
    '_urlResolveOp', '_decodeBodyWithCharset', '_utf8DecodeBytes',
    '_selectionFor', '_isConstructorCE', '_isValidCustomElementName',
    '_blobPartToBytes', '_bytesToBinaryString', '_formEncode', '_hexv',
    '_commonFonts', '_isXMLDocument', '_isValidPITarget', '_isHTMLEl',
    '_nodeList', '_rngNodeLength', '_rngNodeIndex', '_rngSame', '_rngRoot',
    '_rngAncestors', '_rngOrder', '_rngCmp', '_rngCheckOffset',
    '_idbRequest', '_idbObjectStore', '_idbTransaction', '_idbDatabase',
    '_makeListenerBox',
  ];
  var _desc = { value: undefined, writable: true, enumerable: false, configurable: true };
  for (var _i = 0; _i < _names.length; _i++) {
    try { Object.defineProperty(globalThis, _names[_i], _desc); } catch (_e) {}
  }
})();

globalThis.__obscura_errors = [];

globalThis.addEventListener = globalThis.addEventListener || function(){};
globalThis.onunhandledrejection = function(e) { if (e?.preventDefault) e.preventDefault(); };

globalThis.onerror = function(msg, src, line, col, error) {
  globalThis.__obscura_errors.push({msg: String(msg), src: String(src||""), line, error: String(error||"")});
};
globalThis.__windowListeners = {};
globalThis.addEventListener = function(type, fn) {
  if (!globalThis.__windowListeners[type]) globalThis.__windowListeners[type] = [];
  globalThis.__windowListeners[type].push(fn);
};
globalThis.removeEventListener = function(type, fn) {
  if (globalThis.__windowListeners[type]) {
    globalThis.__windowListeners[type] = globalThis.__windowListeners[type].filter(h => h !== fn);
  }
};
globalThis.dispatchEvent = function(event) {
  if (!event) return true;
  const handlers = globalThis.__windowListeners[event.type] || [];
  for (const h of handlers) { try { h.call(globalThis, event); } catch(e) { console.error(e); } }
  return !event.defaultPrevented;
};

globalThis.__obscura_diagFallback = function(name, vmThis) {
  try {
    const keys = Object.keys(vmThis || {});
    const g = vmThis && vmThis.g;
    const describe = v => v === undefined ? 'UNDEF' : v === globalThis ? 'GLOBALTHIS' : typeof v === 'function' ? 'fn:' + (v.name || '?') : typeof v === 'object' && v !== null ? 'obj:' + (v.constructor && v.constructor.name || '?') : typeof v;
    const gAll = Array.isArray(g) ? g.map(describe) : typeof g;
    const undefIdx = Array.isArray(g) ? g.reduce((acc, v, i) => { if (v === undefined) acc.push(i); return acc; }, []) : [];
    console.error('DIAG receiver-fallback name=', JSON.stringify(name), 'vm-keys=', JSON.stringify(keys),
      'g-len=', Array.isArray(g) ? g.length : 'n/a', 'undef-indices=', JSON.stringify(undefIdx),
      'g-full=', JSON.stringify(gAll),
      'other-vm-fields=', JSON.stringify({h: describe(vmThis.h), j: vmThis.j, i: vmThis.i, l: vmThis.l, m: describe(vmThis.m)}));
  } catch (e) { try { console.error('DIAG receiver-fallback dump failed:', e.message, e.stack); } catch(e2) {} }
};
const _dom = (cmd, a1, a2) => __obscura_core.ops.op_dom(cmd, String(a1 ?? ""), String(a2 ?? ""));
const _frameHtml = (fid) => __obscura_core.ops.op_frame_html(String(fid ?? ""));
const _frameMeta = (fid) => __obscura_core.ops.op_frame_meta(String(fid ?? ""));

// Tell the Rust page loop about an <iframe> inserted at runtime so it loads
// and executes it with a live child runtime (not the inert _loadIframeSrc
// shim). Passes the literal src attribute — Rust resolves it and matches the
// node by `iframe[src=...]`. This is what makes a dynamically-created
// Cloudflare Turnstile widget iframe actually run its scripts.
const __registerDynamicIframe = (el) => {
  try {
    if (!el || el.tagName !== 'IFRAME') return;
    const src = el.getAttribute && el.getAttribute('src');
    if (!src || src === 'about:blank') return;
    __obscura_core.ops.op_register_dynamic_iframe(el._nid | 0, String(src));
  } catch (e) {}
};

const _nativeFns = new Set();
// Exact toString override for members whose native form is not just
// `function <name>()`, e.g. accessors (`function get x() { [native code] }`)
// or functions whose `.name` does not match the real builtin.
const _nativeStr = new Map();
const _origToString = Function.prototype.toString;
Function.prototype.toString = function toString() {
  if (_nativeStr.has(this)) { return _nativeStr.get(this); }
  if (_nativeFns.has(this)) {
    return `function ${this.name || ''}() { [native code] }`;
  }
  return _origToString.call(this);
};
function _markNative(fn) { if (typeof fn === 'function') _nativeFns.add(fn); return fn; }
// Mark a function with an exact native-code toString (used for accessors).
function _markNativeAs(fn, str) { if (typeof fn === 'function') _nativeStr.set(fn, str); return fn; }
_nativeFns.add(Function.prototype.toString);

// unusualWindowProperties: obscura's internal globals are made non-enumerable
// (see _preHideInternals and __obscura_init), which hides them from
// Object.keys / for-in. But fingerprinting scripts enumerate the global object
// with Object.getOwnPropertyNames and Reflect.ownKeys, which return
// non-enumerable properties too, so the internals still leak (pixelscan's
// unusualWindowProperties check). Filter the engine's own globals out of the
// reflection APIs when they target the global object. The canonical name set is
// __obscura_hide_list, precomputed at snapshot-build time; referencing it lazily
// means the list is already populated by the time any page calls these.
(function _hideInternalsFromReflection() {
  var _cache = null, _cacheLen = -1;
  function _set() {
    var list = globalThis.__obscura_hide_list;
    if (!list) { return null; }
    if (_cache && _cacheLen === list.length) { return _cache; }
    _cache = new Set(list);
    _cache.add('__obscura_hide_list');
    _cacheLen = list.length;
    return _cache;
  }
  function _isGlobal(t) { return t === globalThis; }
  function _filter(t, names) {
    if (!_isGlobal(t)) { return names; }
    var set = _set();
    if (!set) { return names; }
    var out = [];
    for (var i = 0; i < names.length; i++) { if (!set.has(names[i])) { out.push(names[i]); } }
    return out;
  }
  var _oGOPN = Object.getOwnPropertyNames;
  var _oOwnKeys = Reflect.ownKeys;
  var _oKeys = Object.keys;
  var _oGOPDs = Object.getOwnPropertyDescriptors;
  function define(obj, prop, impl) {
    try { Object.defineProperty(obj, prop, { value: _markNative(impl), writable: true, enumerable: false, configurable: true }); } catch (e) {}
  }
  define(Object, 'getOwnPropertyNames', function getOwnPropertyNames(t) { return _filter(t, _oGOPN(t)); });
  define(Reflect, 'ownKeys', function ownKeys(t) { return _filter(t, _oOwnKeys(t)); });
  define(Object, 'keys', function keys(t) { return _filter(t, _oKeys(t)); });
  define(Object, 'getOwnPropertyDescriptors', function getOwnPropertyDescriptors(t) {
    var all = _oGOPDs(t);
    if (_isGlobal(t)) {
      var set = _set();
      if (set) { var ks = _oGOPN(all); for (var i = 0; i < ks.length; i++) { if (set.has(ks[i])) { delete all[ks[i]]; } } }
    }
    return all;
  });
})();

[Error, TypeError, ReferenceError, SyntaxError, RangeError, URIError, EvalError].forEach(E => {
  try {
    Object.defineProperty(E.prototype, 'name', {
      value: E.name, writable: true, enumerable: false, configurable: false,
    });
  } catch(e) {}
});

const _stackCache = new WeakMap();
const _origStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
if (_origStackDesc && _origStackDesc.get) {
  Object.defineProperty(Error.prototype, 'stack', {
    configurable: false, enumerable: false,
    get: function() {
      if (!_stackCache.has(this)) _stackCache.set(this, _origStackDesc.get.call(this));
      return _stackCache.get(this);
    }
  });
}

let _fpSeed = 0;
// Dynamic script import queue — serializes concurrent import() calls
// to prevent re-entrant RefCell panic in deno_core's futures_unordered_driver
// when SPAs dynamically insert multiple <script module> tags at once.
let __dynScriptQueue = [];
let __dynScriptBusy = false;
async function __processDynScriptQueue() {
  if (__dynScriptBusy) return;
  __dynScriptBusy = true;
  // try/finally so the busy flag is always cleared even if a task throws
  // outside its own guard; otherwise the queue would wedge and silently
  // block every later dynamic script on the page.
  try {
    while (__dynScriptQueue.length > 0) {
      const task = __dynScriptQueue.shift();
      try {
        if (task.isModule) {
          await import(task.url);
        } else {
          const raw = await __obscura_core.ops.op_fetch_url(task.url, "GET", "{}", "", task.pageOrigin, "no-cors");
          const parsed = JSON.parse(raw);
          if (parsed.body) {
            globalThis.__currentScriptNid = task.nid;
            try {
              // __obscura_core.evalContext compiles+runs as a real top-level V8
              // Script (v8::Script::compile+run), not the JS `eval` builtin.
              // That distinction matters: per spec, indirect eval gets its
              // own throwaway lexical environment for top-level let/const/
              // class on every call, so a helper `let`-bound in one
              // dynamically-injected <script> was invisible to a later one
              // even though real browsers share one global lexical
              // environment across all classic scripts on a page. Vendor
              // bundles that split into multiple sequentially-injected
              // <script> chunks assuming that sharing (observed: Cloudflare's
              // challenge/Turnstile runtime) threw "X is not a function" deep
              // in minified code under the old (0, eval)() path.
              (globalThis.__obscura_dynScriptBodies ||= {})[task.url] = parsed.body;
              // Diagnostic-only (both patches below): substituting
              // globalThis[name] for the raw string here was tried and
              // reverted — it stopped the visible "X is not a function"
              // crash, but the VM then span into a synchronous busy loop
              // that our own watchdog had to kill (`V8 watchdog fired:
              // terminated a synchronous overrun`), which is a strictly
              // worse outcome (silent hang vs. a caught, logged exception)
              // and made zero progress past "Just a moment" either way.
              // The receiver register genuinely needs to hold whatever
              // real Chrome holds there; substituting a plausible-looking
              // stand-in doesn't get the VM's actual computation right.
              let patchedBody = parsed.body.replace(
                /:function\((\w+)\)\{return \1\(\)\}/g,
                ':function($1){if(typeof $1!=="function"){try{console.error("DIAG generic-invoker got non-function:",typeof $1,String($1));}catch(e3){}}return $1()}'
              );
              patchedBody = patchedBody.replace(
                /(\w+)=(\w+)===void 0\?(\w+):\2\[\3\]/g,
                '$1=$2===void 0?(globalThis.__obscura_diagFallback($3,this),$3):$2[$3]'
              );
              const [, evalError] = __obscura_core.evalContext(patchedBody, task.url);
              if (evalError) {
                const thrown = evalError.thrown;
                const msg = thrown && thrown.message ? thrown.message : String(thrown);
                console.error('Dynamic script error (' + task.url + '):', msg);
              }
            }
            finally { globalThis.__currentScriptNid = task.prevNid || 0; }
          }
        }
        // Fire load via dispatchEvent only: it invokes the element's onload
        // property handler and any addEventListener('load') listeners, read
        // live off the element. Calling onload separately would double-fire it.
        try { task.dispatchEvent(new Event('load')); } catch(e) {}
      } catch(e) {
        console.error('Dynamic script fetch error:', e.message);
        try { task.dispatchEvent(new Event('error')); } catch(ex) {}
      }
    }
  } finally {
    __dynScriptBusy = false;
  }
}
// Resolve a resource URL (script src / link href) against <base href> or the
// document URL, the way the inline dynamic-script path does. Guarded so a bad
// base or href never throws into appendChild.
function _resolveResourceUrl(src) {
  let baseHref = null;
  try {
    const baseEl = globalThis.document?.querySelector('base[href]');
    baseHref = baseEl ? baseEl.getAttribute('href') : null;
  } catch(e) { baseHref = null; }
  const docUrl = globalThis.location?.href || 'http://localhost/';
  let baseUrl;
  try { baseUrl = baseHref ? new URL(baseHref, docUrl).href : docUrl; }
  catch(e) { baseUrl = docUrl; }
  try {
    return src.startsWith('http') || src.startsWith('data:')
      ? src
      : new URL(src, baseUrl).href;
  } catch(e) { return src; }
}

// A dynamically-inserted <link rel="stylesheet" href> must fetch and fire
// load/error so frameworks awaiting the link's onload (Promise.all of lazy
// CSS + JS, antd/bootstrap loaders, etc.) resolve instead of hanging forever.
// There is no layout engine to apply the CSS, but the load-event contract
// matches Chrome. Issue #409.
async function _loadLinkedStylesheet(c) {
  // obscura does not yet reflect the `rel` IDL attribute back to the content
  // attribute, so `link.rel = "stylesheet"` leaves getAttribute('rel') null.
  // Read both so the property-assignment form (the common framework pattern)
  // and the parsed-from-HTML form are both recognized.
  const rel = (c.getAttribute('rel') || c.rel || '').toString().toLowerCase();
  if (!rel.split(/\s+/).includes('stylesheet')) return;
  const href = c.getAttribute('href');
  if (!href) return;
  const fullUrl = _resolveResourceUrl(href);
  let pageOrigin = "";
  try { pageOrigin = new URL(fullUrl).origin; } catch(e) {}
  try {
    // Use the captured op-bridge, not global `Deno` — __obscura_init deletes
    // globalThis.Deno for stealth, so a direct Deno.core ref throws here.
    await __obscura_core.ops.op_fetch_url(fullUrl, "GET", "{}", "", pageOrigin, "no-cors");
    try { c.dispatchEvent(new Event('load', { bubbles: true })); } catch(e) {}
  } catch(e) {
    try { c.dispatchEvent(new Event('error', { bubbles: true })); } catch(e) {}
  }
}

function _fpRand(salt) {
  let h = (_fpSeed ^ (salt || 0)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF;
}
function _fpNoise(x, y, channel) {
  return (_fpRand(x * 7919 + y * 6271 + channel * 8923) - 0.5) * 4;
}

var _fpCache = null;
function _getFp() {
  if (_fpCache) return _fpCache;
  const _uaPlat = globalThis.__obscura_ua_platform || 'Windows';
  const isMac = _uaPlat === 'macOS';
  const isLinux = _uaPlat === 'Linux';
  const gpuPool = isMac ? [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)',
    'ANGLE (Intel Inc., ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics, Unspecified Version)',
  ] : isLinux ? [
    'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
    'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)',
    'ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (RPL-S), OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580 (polaris10, LLVM 15.0.7, DRM 3.54, LLVM 15.0.7), OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT (navi22, LLVM 16.0.6, DRM 3.54, LLVM 16.0.6), OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 OpenGL 4.6)',
  ] : [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ];
  const gpuVendorPool = isMac ? [
    'Google Inc. (Apple)','Google Inc. (Apple)','Google Inc. (Apple)',
    'Google Inc. (Apple)','Google Inc. (Apple)',
    'Google Inc. (Intel Inc.)',
  ] : isLinux ? [
    'Google Inc. (Intel)','Google Inc. (Intel)','Google Inc. (Intel)',
    'Google Inc. (AMD)','Google Inc. (AMD)',
    'Google Inc. (NVIDIA)','Google Inc. (NVIDIA)',
  ] : [
    'Google Inc. (NVIDIA)','Google Inc. (NVIDIA)','Google Inc. (NVIDIA)',
    'Google Inc. (Intel)','Google Inc. (Intel)',
    'Google Inc. (AMD)','Google Inc. (AMD)',
    'Google Inc. (NVIDIA)','Google Inc. (NVIDIA)',
    'Google Inc. (Intel)','Google Inc. (AMD)','Google Inc. (NVIDIA)',
  ];
  const idx = Math.floor(_fpRand(42) * gpuPool.length);
  const screenPool = [[1920,1080],[2560,1440],[1366,768],[1536,864],[1440,900],[1680,1050],[1280,720],[3840,2160]];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let cfp = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
  for (let i = 0; i < 40; i++) cfp += chars[Math.floor(_fpRand(500 + i) * 64)];
  cfp += '==';
  // Operator-supplied overrides (set at init via __obscura_fp_cfg) win over the
  // seed-derived pool pick, so a chosen identity can be pinned exactly. Any
  // field left unset keeps the deterministic pool value.
  const _cfg = globalThis.__obscura_fp_cfg || {};
  _fpCache = {
    gpu: _cfg.webgl_renderer || gpuPool[idx],
    gpuVendor: _cfg.webgl_vendor || gpuVendorPool[idx],
    audioBaseLatency: 0.002 + _fpRand(100) * 0.008,
    audioSampleRate: [44100, 48000][Math.floor(_fpRand(101) * 2)],
    compThreshold: -24 + (_fpRand(102) - 0.5) * 4,
    compKnee: 30 + (_fpRand(103) - 0.5) * 4,
    compRatio: 12 + (_fpRand(104) - 0.5) * 4,
    batteryLevel: 0.5 + _fpRand(200) * 0.5,
    batteryCharging: _fpRand(201) > 0.3,
    screen: (Array.isArray(_cfg.screen) && _cfg.screen.length === 2)
      ? [_cfg.screen[0], _cfg.screen[1]]
      : screenPool[Math.floor(_fpRand(300) * screenPool.length)],
    canvasFingerprint: cfp,
  };
  return _fpCache;
}
function _fp(key) { return _getFp()[key]; }
globalThis._eventRegistry = globalThis._eventRegistry || {};
globalThis._formValues = globalThis._formValues || {};
globalThis._formChecked = globalThis._formChecked || {};
const _eventRegistry = globalThis._eventRegistry;
const _formValues = globalThis._formValues;
const _formChecked = globalThis._formChecked;
const _domParse = (cmd, a1, a2) => { try { return JSON.parse(_dom(cmd, a1, a2)); } catch { return null; } };

// HTML "ASCII whitespace": U+0009 TAB, U+000A LF, U+000C FF, U+000D CR, U+0020 SPACE.
// Class token splitting (classList, getElementsByClassName) uses exactly this set.
// JS \s is wider (U+000B, U+00A0, U+2028, etc.), so it must not be used here.
const _ASCII_WS = /[ \t\n\f\r]+/;
function _splitAsciiWhitespace(s) {
  // WebIDL DOMString coercion: null -> "null", undefined -> "undefined".
  return String(s).split(_ASCII_WS).filter(Boolean);
}
// Shared getElementsByClassName: split the argument into an ordered set of
// tokens on ASCII whitespace, then return descendants (in tree order) whose
// class attribute contains every token, as an HTMLCollection (so namedItem and
// named access work on the result). `root` must expose querySelectorAll.
function _getElementsByClassName(root, classNames) {
  const tokens = _splitAsciiWhitespace(classNames);
  if (tokens.length === 0) return HTMLCollection._from([]);
  // Fast path: a single CSS-identifier token goes straight to the native
  // selector engine (the common case). Only multi-token sets or exotic class
  // names (NBSP, leading digits, etc.) fall back to the O(n) JS scan below.
  if (tokens.length === 1 && /^[A-Za-z_-][\w-]*$/.test(tokens[0])) {
    return HTMLCollection._from(root.querySelectorAll("." + tokens[0]));
  }
  const all = root.querySelectorAll("*");
  const matched = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const elTokens = _splitAsciiWhitespace(el.getAttribute ? (el.getAttribute("class") || "") : "");
    let ok = true;
    for (let t = 0; t < tokens.length; t++) {
      if (elTokens.indexOf(tokens[t]) < 0) { ok = false; break; }
    }
    if (ok) matched.push(el);
  }
  return HTMLCollection._from(matched);
}
const _consoleFn = (level, args) => {
  try { __obscura_core.ops.op_console_msg(level, args.map(a => {
    if (a === null) return "null";
    if (a === undefined) return "undefined";
    if (a instanceof Error) {
      const _pst = Error.prepareStackTrace;
      if (_pst !== undefined) Error.prepareStackTrace = undefined;
      const _s = a.stack || a.message || String(a);
      if (_pst !== undefined) Error.prepareStackTrace = _pst;
      return _s;
    }
    if (typeof a === "object") {
      try {
        const s = JSON.stringify(a);
        return s === "{}" && a.message ? a.message : s;
      } catch { return String(a); }
    }
    return String(a);
  }).join(" ")); } catch {}
};

globalThis.console = {
  log: (...a) => _consoleFn("log", a), warn: (...a) => _consoleFn("warn", a),
  error: (...a) => _consoleFn("error", a), info: (...a) => _consoleFn("log", a),
  debug: () => {}, dir: () => {}, trace: () => {}, table: () => {}, group: () => {},
  groupEnd: () => {}, groupCollapsed: () => {}, time: () => {}, timeEnd: () => {},
  timeLog: () => {}, count: () => {}, countReset: () => {}, clear: () => {},
  assert: (c, ...a) => { if (!c) _consoleFn("error", ["Assertion failed:", ...a]); },
};

let _tid = 0;
const _clearedTimers = new Set();
const _intervals = new Set();

const _scheduleAfter = (delay, fn) => {
  const d = Math.max(0, Number(delay) || 0);
  // setTimeout(fn, 0) is a MACROTASK in every real engine: it only runs once
  // the microtask queue is fully drained, even when scheduled for 0ms. A
  // Promise.resolve().then(fn) shortcut here runs fn as a microtask instead,
  // so code that relies on setTimeout(fn, 0) running strictly after
  // already-queued Promise callbacks (a common scheduler/interpreter
  // pattern — observed: Cloudflare's challenge VM) sees fn fire too early,
  // before state a microtask was about to populate exists yet. Routing
  // through op_sleep even for d===0 forces a real event-loop tick.
  __obscura_core.ops.op_sleep(d).then(fn);
};

globalThis.setTimeout = (fn, delay = 0, ...args) => {
  if (typeof fn !== "function") return ++_tid;
  const id = ++_tid;
  _scheduleAfter(delay, () => {
    if (_clearedTimers.has(id)) return;
    try { fn(...args); } catch(e) { console.error("Timer error:", e); }
  });
  return id;
};

globalThis.clearTimeout = (id) => { _clearedTimers.add(id); };

globalThis.setInterval = (fn, delay = 0, ...args) => {
  if (typeof fn !== "function") return ++_tid;
  const id = ++_tid;
  _intervals.add(id);
  const tick = () => {
    if (!_intervals.has(id)) return;
    try { fn(...args); } catch(e) { console.error("Interval error:", e); }
    if (!_intervals.has(id)) return;
    _scheduleAfter(delay, tick);
  };
  _scheduleAfter(delay, tick);
  return id;
};

globalThis.clearInterval = (id) => { _intervals.delete(id); _clearedTimers.add(id); };
// Real rAF invokes the callback with a DOMHighResTimeStamp; setTimeout(fn, 0)
// alone calls fn() with no args, so callbacks expecting a numeric timestamp
// (e.g. `t.toFixed(2)`, frame-time-delta math) got `undefined` and threw.
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(globalThis.performance.now()), 0);
globalThis.cancelAnimationFrame = globalThis.clearTimeout;
globalThis.queueMicrotask = globalThis.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// A functional MessagePort pair. The earlier stub only delivered to `.onmessage`
// and had a no-op `addEventListener`, so any code that awaits a port message via
// `port.addEventListener('message', h, {once:true})` (the standard idiom, used
// by e.g. iphey/MixVisit's worker-client handshake and comlink-style RPC) never
// received it and hung forever. Messages now dispatch to BOTH `onmessage` and
// every `addEventListener('message')` listener, with `once`/`start`/`close`
// honored, matching the real MessagePort contract closely enough for RPC.
function _makeMessagePort() {
  const listeners = [];
  let onmessage = null;
  let peer = null;
  let started = false;
  const queue = [];
  const deliver = (evt) => {
    if (typeof onmessage === 'function') { try { onmessage(evt); } catch (e) {} }
    for (const l of listeners.slice()) {
      try { l.fn.call(port, evt); } catch (e) {}
      if (l.once) { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }
    }
  };
  const flush = () => { while (started && queue.length) deliver(queue.shift()); };
  const port = {
    get onmessage() { return onmessage; },
    // Assigning onmessage implicitly starts the port (per spec), draining any
    // messages that arrived before a handler was attached.
    set onmessage(fn) { onmessage = fn; started = true; Promise.resolve().then(flush); },
    postMessage(data) {
      const target = peer;
      if (!target) return;
      Promise.resolve().then(() => target._enqueue({ data }));
    },
    addEventListener(type, fn, opts) {
      if (type !== 'message' || typeof fn !== 'function') return;
      listeners.push({ fn, once: !!(opts && (opts === true ? false : opts.once)) });
      // A 'message' listener also implicitly starts the port in practice.
      started = true; Promise.resolve().then(flush);
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(evt) { deliver(evt); return true; },
    start() { started = true; flush(); },
    close() { started = false; peer = null; },
    _enqueue(evt) { queue.push(evt); if (started) Promise.resolve().then(flush); },
    _setPeer(p) { peer = p; },
  };
  return port;
}
class MessageChannel {
  constructor() {
    this.port1 = _makeMessagePort();
    this.port2 = _makeMessagePort();
    this.port1._setPeer(this.port2);
    this.port2._setPeer(this.port1);
  }
}
globalThis.MessageChannel = MessageChannel;
globalThis.MessagePort = class MessagePort { constructor(){ return _makeMessagePort(); } };

const _cssCamelToKebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const _cssKebabToCamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// Standard CSS property names (camelCase). Real CSSStyleDeclaration exposes every
// property as an enumerable accessor, so feature-detection code (`'gap' in
// el.style`) and enumeration (`Object.keys(el.style)`) see the whole set, not
// just the ones that happen to be assigned (issue #356).
const _CSS_PROPERTY_NAMES = [
  "accentColor","alignContent","alignItems","alignSelf","all","animation","animationDelay",
  "animationDirection","animationDuration","animationFillMode","animationIterationCount",
  "animationName","animationPlayState","animationTimingFunction","appearance","aspectRatio",
  "backdropFilter","backfaceVisibility","background","backgroundAttachment","backgroundBlendMode",
  "backgroundClip","backgroundColor","backgroundImage","backgroundOrigin","backgroundPosition",
  "backgroundPositionX","backgroundPositionY","backgroundRepeat","backgroundSize","blockSize",
  "border","borderBlock","borderBlockColor","borderBlockEnd","borderBlockEndColor","borderBlockEndStyle",
  "borderBlockEndWidth","borderBlockStart","borderBlockStartColor","borderBlockStartStyle",
  "borderBlockStartWidth","borderBlockStyle","borderBlockWidth","borderBottom","borderBottomColor",
  "borderBottomLeftRadius","borderBottomRightRadius","borderBottomStyle","borderBottomWidth",
  "borderCollapse","borderColor","borderImage","borderImageOutset","borderImageRepeat",
  "borderImageSlice","borderImageSource","borderImageWidth","borderInline","borderInlineColor",
  "borderInlineEnd","borderInlineEndColor","borderInlineEndStyle","borderInlineEndWidth",
  "borderInlineStart","borderInlineStartColor","borderInlineStartStyle","borderInlineStartWidth",
  "borderInlineStyle","borderInlineWidth","borderLeft","borderLeftColor","borderLeftStyle",
  "borderLeftWidth","borderRadius","borderRight","borderRightColor","borderRightStyle",
  "borderRightWidth","borderSpacing","borderStyle","borderTop","borderTopColor","borderTopLeftRadius",
  "borderTopRightRadius","borderTopStyle","borderTopWidth","borderWidth","bottom","boxShadow",
  "boxSizing","breakAfter","breakBefore","breakInside","captionSide","caretColor","clear","clip",
  "clipPath","color","colorScheme","columnCount","columnFill","columnGap","columnRule","columnRuleColor",
  "columnRuleStyle","columnRuleWidth","columnSpan","columnWidth","columns","contain","container",
  "containerName","containerType","content","counterIncrement","counterReset","counterSet","cssFloat",
  "cursor","direction","display","emptyCells","filter","flex","flexBasis","flexDirection","flexFlow",
  "flexGrow","flexShrink","flexWrap","float","font","fontFamily","fontFeatureSettings","fontKerning",
  "fontOpticalSizing","fontSize","fontSizeAdjust","fontStretch","fontStyle","fontVariant",
  "fontVariantCaps","fontVariantLigatures","fontVariantNumeric","fontWeight","gap","grid","gridArea",
  "gridAutoColumns","gridAutoFlow","gridAutoRows","gridColumn","gridColumnEnd","gridColumnGap",
  "gridColumnStart","gridGap","gridRow","gridRowEnd","gridRowGap","gridRowStart","gridTemplate",
  "gridTemplateAreas","gridTemplateColumns","gridTemplateRows","height","hyphens","imageRendering",
  "inlineSize","inset","insetBlock","insetBlockEnd","insetBlockStart","insetInline","insetInlineEnd",
  "insetInlineStart","isolation","justifyContent","justifyItems","justifySelf","left","letterSpacing",
  "lineBreak","lineHeight","listStyle","listStyleImage","listStylePosition","listStyleType","margin",
  "marginBlock","marginBlockEnd","marginBlockStart","marginBottom","marginInline","marginInlineEnd",
  "marginInlineStart","marginLeft","marginRight","marginTop","mask","maxBlockSize","maxHeight",
  "maxInlineSize","maxWidth","minBlockSize","minHeight","minInlineSize","minWidth","mixBlendMode",
  "objectFit","objectPosition","offset","opacity","order","outline","outlineColor","outlineOffset",
  "outlineStyle","outlineWidth","overflow","overflowAnchor","overflowWrap","overflowX","overflowY",
  "overscrollBehavior","overscrollBehaviorBlock","overscrollBehaviorInline","overscrollBehaviorX",
  "overscrollBehaviorY","padding","paddingBlock","paddingBlockEnd","paddingBlockStart","paddingBottom",
  "paddingInline","paddingInlineEnd","paddingInlineStart","paddingLeft","paddingRight","paddingTop",
  "pageBreakAfter","pageBreakBefore","pageBreakInside","perspective","perspectiveOrigin","placeContent",
  "placeItems","placeSelf","pointerEvents","position","quotes","resize","right","rotate","rowGap",
  "scale","scrollBehavior","scrollMargin","scrollPadding","scrollSnapAlign","scrollSnapStop",
  "scrollSnapType","tabSize","tableLayout","textAlign","textAlignLast","textCombineUpright",
  "textDecoration","textDecorationColor","textDecorationLine","textDecorationSkipInk",
  "textDecorationStyle","textDecorationThickness","textEmphasis","textIndent","textJustify",
  "textOrientation","textOverflow","textRendering","textShadow","textTransform","textUnderlineOffset",
  "textUnderlinePosition","top","touchAction","transform","transformBox","transformOrigin",
  "transformStyle","transition","transitionDelay","transitionDuration","transitionProperty",
  "transitionTimingFunction","translate","unicodeBidi","userSelect","verticalAlign","visibility",
  "whiteSpace","width","willChange","wordBreak","wordSpacing","wordWrap","writingMode","zIndex","zoom",
];
const _CSS_PROP_SET = new Set(_CSS_PROPERTY_NAMES);

class CSSStyleDeclaration {
  constructor() {
    // Non-enumerable so it never leaks through the proxy's own-key traps.
    Object.defineProperty(this, "_props", { value: {}, writable: true, enumerable: false, configurable: true });
  }
  // Storage is keyed by the dashed CSS name, matching CSSOM. The proxy maps the
  // camelCase IDL access (el.style.fontSize) onto the dashed key (font-size), so
  // getPropertyValue('font-size') and el.style.fontSize stay in sync.
  setProperty(name, value) {
    const k = _cssCamelToKebab(String(name));
    if (value === "" || value == null) { delete this._props[k]; return; }
    this._props[k] = String(value);
  }
  removeProperty(name) { const k = _cssCamelToKebab(String(name)); const old = this._props[k]; delete this._props[k]; return old || ""; }
  getPropertyValue(name) { return this._props[_cssCamelToKebab(String(name))] || ""; }
  getPropertyPriority() { return ""; }
  get cssText() {
    const e = Object.entries(this._props);
    return e.length ? e.map(([k, v]) => `${k}: ${v}`).join("; ") + ";" : "";
  }
  set cssText(v) {
    for (const k in this._props) delete this._props[k];
    if (v) String(v).split(";").forEach((p) => {
      const i = p.indexOf(":");
      if (i > 0) { const k = p.slice(0, i).trim(); const val = p.slice(i + 1).trim(); if (k && val) this._props[_cssCamelToKebab(k)] = val; }
    });
  }
  get length() { return Object.keys(this._props).length; }
  item(i) { return Object.keys(this._props)[i] || ""; }
}

const _styleProxy = (decl) => new Proxy(decl, {
  get(t, p) {
    if (typeof p === "symbol" || p in t) return t[p];
    if (/^\d+$/.test(p)) return t.item(+p);
    return t.getPropertyValue(p);
  },
  set(t, p, v) {
    if (typeof p === "symbol") { t[p] = v; return true; }
    if (p === "cssText") { t.cssText = v; return true; }
    if (/^\d+$/.test(p) || p in Object.getPrototypeOf(t)) return true;
    t.setProperty(p, v);
    return true;
  },
  has(t, p) {
    if (typeof p !== "string") return Reflect.has(t, p);
    if (p in Object.getPrototypeOf(t)) return true;
    if (_cssCamelToKebab(p) in t._props) return true;
    if (_CSS_PROP_SET.has(p) || _CSS_PROP_SET.has(_cssKebabToCamel(p))) return true;
    return /^\d+$/.test(p) && +p < t.length;
  },
  ownKeys(t) {
    const keys = [];
    const n = t.length;
    for (let i = 0; i < n; i++) keys.push(String(i));
    const names = new Set(_CSS_PROPERTY_NAMES);
    for (const k of Object.keys(t._props)) names.add(_cssKebabToCamel(k));
    for (const name of names) keys.push(name);
    return keys;
  },
  getOwnPropertyDescriptor(t, p) {
    if (typeof p !== "string") return Reflect.getOwnPropertyDescriptor(t, p);
    if (/^\d+$/.test(p) && +p < t.length) return { value: t.item(+p), writable: false, enumerable: true, configurable: true };
    if (_cssCamelToKebab(p) in t._props || _CSS_PROP_SET.has(p) || _CSS_PROP_SET.has(_cssKebabToCamel(p))) {
      return { value: t.getPropertyValue(p), writable: true, enumerable: true, configurable: true };
    }
    return undefined;
  },
});


function Navigator() {}
_markNative(Navigator);

// PluginArray must exist before navigator is built so the plugins getter can use it.
function PluginArray(items) {
  for (var _pi = 0; _pi < items.length; _pi++) this[_pi] = items[_pi];
  this.length = items.length;
}
PluginArray.prototype = Object.create(Array.prototype);
PluginArray.prototype.constructor = PluginArray;
PluginArray.prototype.item = function(i) { return this[i] || null; };
PluginArray.prototype.namedItem = function(name) {
  for (var _pi = 0; _pi < this.length; _pi++) {
    if (this[_pi].name === name) return this[_pi];
  }
  return null;
};
PluginArray.prototype.refresh = function() {};
PluginArray.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(PluginArray.prototype, Symbol.toStringTag, {value: 'PluginArray', configurable: true});
_markNative(PluginArray);
_markNative(PluginArray.prototype.item);
_markNative(PluginArray.prototype.namedItem);
_markNative(PluginArray.prototype.refresh);

// Plugin / MimeType / MimeTypeArray global interfaces. Chrome exposes these as
// global constructors; their absence threw "ReferenceError: Plugin is not
// defined" in site bundles that reference them (issue #305). Plain function
// declarations (no globalThis assignment) so they survive the V8 snapshot, the
// same pattern PluginArray uses.
function Plugin(name, filename, description, mimeTypes) {
  this.name = name;
  this.filename = filename;
  this.description = description;
  var mt = mimeTypes || [];
  for (var _i = 0; _i < mt.length; _i++) this[_i] = mt[_i];
  this.length = mt.length;
}
Plugin.prototype.item = function(i) { return this[i] || null; };
Plugin.prototype.namedItem = function(name) {
  for (var _i = 0; _i < this.length; _i++) if (this[_i] && this[_i].type === name) return this[_i];
  return null;
};
Plugin.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(Plugin.prototype, Symbol.toStringTag, {value: 'Plugin', configurable: true});
_markNative(Plugin);
_markNative(Plugin.prototype.item);
_markNative(Plugin.prototype.namedItem);

function MimeType(type, description, suffixes, plugin) {
  this.type = type;
  this.description = description;
  this.suffixes = suffixes;
  this.enabledPlugin = plugin || null;
}
Object.defineProperty(MimeType.prototype, Symbol.toStringTag, {value: 'MimeType', configurable: true});
_markNative(MimeType);

function MimeTypeArray(items) {
  for (var _i = 0; _i < items.length; _i++) this[_i] = items[_i];
  this.length = items.length;
}
MimeTypeArray.prototype.item = function(i) { return this[i] || null; };
MimeTypeArray.prototype.namedItem = function(name) {
  for (var _i = 0; _i < this.length; _i++) if (this[_i] && this[_i].type === name) return this[_i];
  return null;
};
MimeTypeArray.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
Object.defineProperty(MimeTypeArray.prototype, Symbol.toStringTag, {value: 'MimeTypeArray', configurable: true});
_markNative(MimeTypeArray);
_markNative(MimeTypeArray.prototype.item);
_markNative(MimeTypeArray.prototype.namedItem);

// Built once and memoized (not per-getter-call) so navigator.plugins ===
// navigator.plugins holds, like real Chrome's cached PluginArray. Each
// plugin gets a real, self-referencing MimeType (length 1, not the empty
// array a naive stub leaves it with) — fingerprint scripts routinely check
// `plugins[0][0].enabledPlugin === plugins[0]` and `plugins[0].length > 0`.
var _pdfPluginArray = null;
var _pdfMimeTypeArray = null;
function _buildPdfPluginsAndMimeTypes() {
  if (_pdfPluginArray) return;
  var names = [
    "PDF Viewer", "Chrome PDF Viewer", "Chromium PDF Viewer",
    "Microsoft Edge PDF Viewer", "WebKit built-in PDF",
  ];
  var plugins = names.map(function(name) {
    var p = new Plugin(name, "internal-pdf-viewer", "Portable Document Format", []);
    var mt = new MimeType("application/pdf", "Portable Document Format", "pdf", p);
    p[0] = mt;
    p.length = 1;
    return p;
  });
  _pdfPluginArray = new PluginArray(plugins);
  // navigator.mimeTypes has 2 entries (application/pdf, text/pdf) shared
  // across the plugin list, cross-referenced to "Chrome PDF Viewer" —
  // matching real Chrome's PluginList mimetype dedup/resolution.
  var primary = plugins[1];
  var mtPdf = new MimeType("application/pdf", "Portable Document Format", "pdf", primary);
  var mtTextPdf = new MimeType("text/pdf", "Portable Document Format", "pdf", primary);
  primary[0] = mtPdf;
  _pdfMimeTypeArray = new MimeTypeArray([mtPdf, mtTextPdf]);
}

class NetworkInformation {
  constructor() { _makeListenerBox(this); }
  get downlink() { return 10; }
  get downlinkMax() { return Infinity; }
  get effectiveType() { return '4g'; }
  get rtt() { return 50; }
  get saveData() { return false; }
  get type() { return 'wifi'; }
  get onchange() { return null; }
  set onchange(v) {}
  get ontypechange() { return null; }
  set ontypechange(v) {}
}
_markNative(NetworkInformation);
globalThis.NetworkInformation = NetworkInformation;

globalThis.ContentIndex = class ContentIndex {};

function _chromeMajor() {
  var m = (globalThis.__obscura_ua || '').match(/Chrome\/(\d+)/);
  return m ? (m[1] | 0) : 147;
}
// Chromium derives the sec-ch-ua GREASE brand, version, and brand order
// deterministically from the Chrome major version
// (components/embedder_support/user_agent_utils.cc). Replicating it keeps
// sec-ch-ua and userAgentData exact for every profile version rather than
// hardcoding one static token.
var _GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
var _GREASE_VER = ['8', '99', '24'];
var _BRAND_PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function _uaBrands() {
  var seed = _chromeMajor();
  var grease = {
    brand: 'Not' + _GREASE_CHARS[seed % 11] + 'A' + _GREASE_CHARS[(seed + 1) % 11] + 'Brand',
    version: _GREASE_VER[seed % 3],
  };
  var ordered = [
    grease,
    {brand: 'Chromium', version: String(seed)},
    {brand: 'Google Chrome', version: String(seed)},
  ];
  var p = _BRAND_PERMS[seed % 6];
  return [ordered[p[0]], ordered[p[1]], ordered[p[2]]];
}

// Fingerprint surfaces (UA, plugins, webdriver, etc.) live on the prototype
// hop below, not as own props here: own accessors are a bot tell.
// Real Chrome's navigator instance carries ZERO own properties — every
// fingerprint surface lives as an accessor on Navigator.prototype. rebrowser and
// CreepJS both check Object.getOwnPropertyNames(navigator).length===0 AND
// Object.getPrototypeOf(navigator)===Navigator.prototype. The earlier design used
// an intermediate _navProto hop (own-prop-free, but getPrototypeOf then pointed at
// _navProto, not Navigator.prototype — a splice tell). Define everything directly
// on Navigator.prototype instead; sub-objects are memoized so navigator.x===x.
(function() {
  var P = Navigator.prototype;
  var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
  function defGetter(key, fn) {
    _markNative(fn);
    Object.defineProperty(P, key, { get: fn, set: undefined, enumerable: true, configurable: true });
  }
  // Memoized sub-object getter: builds once, then returns the SAME instance so
  // navigator.mediaDevices === navigator.mediaDevices (a per-call rebuild is a tell).
  function defMemo(key, build) {
    var cache, built = false;
    defGetter(key, function() { if (!built) { cache = build(); built = true; } return cache; });
  }
  function defMethod(key, fn) {
    _markNative(fn);
    Object.defineProperty(P, key, { value: fn, writable: true, enumerable: true, configurable: true });
  }

  // --- primitive accessors ---
  defGetter('webdriver', function() { return false; });
  defGetter('userAgent', function() { return globalThis.__obscura_ua || DEFAULT_UA; });
  defGetter('appVersion', function() { return (globalThis.__obscura_ua || DEFAULT_UA).replace('Mozilla/', ''); });
  defGetter('appCodeName', function() { return "Mozilla"; });
  defGetter('appName', function() { return "Netscape"; });
  defGetter('platform', function() { return globalThis.__obscura_platform || "Win32"; });
  defGetter('vendor', function() { return "Google Inc."; });
  defGetter('vendorSub', function() { return ""; });
  defGetter('product', function() { return "Gecko"; });
  defGetter('productSub', function() { return "20030107"; });
  defGetter('doNotTrack', function() { return null; });
  defGetter('onLine', function() { return true; });
  defGetter('cookieEnabled', function() { return true; });
  defGetter('maxTouchPoints', function() { return 0; });
  defGetter('pdfViewerEnabled', function() { return true; });
  // CDP Emulation.setLocaleOverride wins over the built-in default.
  defGetter('language', function() { return globalThis.__obscura_language || "en-US"; });
  defGetter('languages', function() { return globalThis.__obscura_languages || ["en-US", "en"]; });
  // CDP setHardwareConcurrencyOverride wins over the randomized fingerprint value.
  defGetter('hardwareConcurrency', function() {
    var cdp = globalThis.__obscura_hardware_concurrency;
    return cdp != null ? cdp : (globalThis.__obscura_hw || 8);
  });
  defGetter('deviceMemory', function() { return globalThis.__obscura_mem || 8; });
  // PDF plugins/mimeTypes with Chrome's full cross-referenced shape (plugins[0][0]
  // .enabledPlugin === plugins[0], plugins[0].length > 0). Lazy + cached.
  defGetter('plugins', function() { _buildPdfPluginsAndMimeTypes(); return _pdfPluginArray; });
  defGetter('mimeTypes', function() { _buildPdfPluginsAndMimeTypes(); return _pdfMimeTypeArray; });

  // --- memoized sub-objects (identity-stable) ---
  defMemo('connection', function() { return new NetworkInformation(); });
  defMemo('userAgentData', function() {
    return {
      mobile: false,
      get brands() { return _uaBrands(); },
      get platform() { return globalThis.__obscura_ua_platform || "Windows"; },
      getHighEntropyValues: function(hints) {
        var brands = _uaBrands();
        return Promise.resolve({
          architecture: "x86", bitness: "64", brands: brands,
          fullVersionList: brands.map(function(b) { return { brand: b.brand, version: b.version + ".0.0.0" }; }),
          mobile: false, model: "",
          platform: globalThis.__obscura_ua_platform || "Windows",
          platformVersion: globalThis.__obscura_ua_platform_version || "15.0.0",
          uaFullVersion: _chromeMajor() + ".0.0.0", wow64: false,
        });
      },
      toJSON: function() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },
    };
  });
  defMemo('serviceWorker', function() {
    return { ready: Promise.resolve(), register: function() { return Promise.resolve(); }, getRegistrations: function() { return Promise.resolve([]); }, controller: null, oncontrollerchange: null, onmessage: null, addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; } };
  });
  defMemo('mediaDevices', function() {
    return {
      enumerateDevices: function() {
        // Before any getUserMedia permission grant, a real browser masks every
        // device: deviceId, label and groupId are all "". Exposing real-looking
        // ids ("default"/"comms") without permission is a classic anti-detect
        // tell (fake device enumeration). Match Chrome's no-permission shape:
        // one entry per kind, all fields empty but `kind`, in input→output order.
        return Promise.resolve([
          { deviceId: "", kind: "audioinput", label: "", groupId: "" },
          { deviceId: "", kind: "videoinput", label: "", groupId: "" },
          { deviceId: "", kind: "audiooutput", label: "", groupId: "" },
        ]);
      },
      getUserMedia: function() { return Promise.reject(new DOMException("NotAllowedError")); },
      getDisplayMedia: function() { return Promise.reject(new DOMException("NotAllowedError")); },
      getSupportedConstraints: function() { return { aspectRatio: true, autoGainControl: true, deviceId: true, echoCancellation: true, facingMode: true, frameRate: true, groupId: true, height: true, noiseSuppression: true, sampleRate: true, sampleSize: true, width: true }; },
      addEventListener: function() {}, removeEventListener: function() {}, ondevicechange: null,
    };
  });
  defMemo('clipboard', function() { return { writeText: function() { return Promise.resolve(); }, readText: function() { return Promise.resolve(""); } }; });
  defMemo('permissions', function() {
    return { query: function(params) {
      var n = params && params.name;
      // Chrome defaults privacy-sensitive permissions to "prompt", not "granted".
      if (n === 'notifications') return Promise.resolve({ state: (globalThis.Notification && Notification.permission === 'granted') ? 'granted' : 'prompt', onchange: null });
      if (n === 'geolocation' || n === 'camera' || n === 'microphone' || n === 'midi') return Promise.resolve({ state: 'prompt', onchange: null });
      return Promise.resolve({ state: 'granted', onchange: null });
    } };
  });
  defMemo('geolocation', function() {
    return {
      getCurrentPosition: function(success) {
        var coords = { latitude: (globalThis.__obscura_geo_lat ?? 50.1109) + (_fpRand(500) - 0.5) * 0.1, longitude: (globalThis.__obscura_geo_lon ?? 8.6821) + (_fpRand(501) - 0.5) * 0.1, accuracy: 10 + _fpRand(502) * 40, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
        if (typeof success === 'function') success({ coords: coords, timestamp: Date.now() });
      },
      watchPosition: function(success) {
        if (typeof success === 'function') {
          var coords = { latitude: (globalThis.__obscura_geo_lat ?? 50.1109) + (_fpRand(503) - 0.5) * 0.1, longitude: (globalThis.__obscura_geo_lon ?? 8.6821) + (_fpRand(504) - 0.5) * 0.1, accuracy: 10 + _fpRand(505) * 40, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
          success({ coords: coords, timestamp: Date.now() });
        }
        return 0;
      },
      clearWatch: function() {},
    };
  });
  defMemo('storage', function() { return { estimate: function() {
    // A round 5e9 decimal quota + non-zero usage on a fresh page was a tell:
    // Chrome reports a binary-GiB quota (~fraction of disk) and usage 0 on a
    // site that has stored nothing. Seed a realistic ~40-96 GiB quota and
    // report usage 0.
    var gib = 1073741824;
    var quota = Math.round((40 + _fpRand(640) * 56) * gib);
    return Promise.resolve({ quota: quota, usage: 0, usageDetails: {} });
  }, persist: function() { return Promise.resolve(false); }, persisted: function() { return Promise.resolve(false); } }; });

  // --- methods ---
  defMethod('getBattery', function getBattery() { return Promise.resolve({ charging: _fp('batteryCharging'), chargingTime: _fp('batteryCharging') ? 0 : Infinity, dischargingTime: _fp('batteryCharging') ? Infinity : Math.floor(3600 + _fpRand(250) * 7200), level: _fp('batteryLevel'), addEventListener: function() {} }); });
  defMethod('getGamepads', function getGamepads() { return []; });
  defMethod('sendBeacon', function sendBeacon() { return true; });
  defMethod('javaEnabled', function javaEnabled() { return false; });
  defMethod('share', function share() { return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); });
  defMethod('canShare', function canShare() { return false; });

  Object.defineProperty(P, Symbol.toStringTag, { value: 'Navigator', configurable: true });

  // Zero-own-prop instance whose [[Prototype]] IS Navigator.prototype.
  globalThis.navigator = Object.create(P);
})();

globalThis.chrome = {
  app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
  runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect() { throw new Error("Could not establish connection. Receiving end does not exist."); }, sendMessage() { throw new Error("Could not establish connection. Receiving end does not exist."); } },
  csi() {
    const t = Date.now();
    return { onloadT: t, startE: t - Math.floor(100 + _fpRand(610) * 200), pageT: 0, tran: 5, flashVersion: "" };
  },
  loadTimes() {
    const t = Date.now() / 1000;
    const request = t - 0.5 - _fpRand(611) * 0.5;
    const startLoad = request + 0.05 + _fpRand(612) * 0.02;
    const commit = request + 0.3 + _fpRand(613) * 0.4;
    const finishDoc = commit + 0.1 + _fpRand(614) * 0.2;
    const finish = finishDoc + 0.05 + _fpRand(615) * 0.1;
    const firstPaint = commit + 0.03 + _fpRand(616) * 0.1;
    const navTypes = ["BackForward","Reload","Link","Other"];
    return {
      requestTime: request, startLoadTime: startLoad * 1000, commitLoadTime: commit * 1000,
      finishDocumentLoadTime: finishDoc * 1000, finishLoadTime: finish * 1000,
      firstPaintTime: firstPaint * 1000, firstPaintAfterLoadTime: 0,
      navigationType: navTypes[Math.floor(_fpRand(617) * 4)],
      wasFetchedViaSpdy: false, wasNpnNegotiated: false,
      npnNegotiatedProtocol: "http/1.1",
      wasAlternateProtocolAvailable: false, connectionInfo: "http/1.1",
    };
  },
};
_markNative(globalThis.chrome.runtime.connect);
_markNative(globalThis.chrome.runtime.sendMessage);
_markNative(globalThis.chrome.csi);
_markNative(globalThis.chrome.loadTimes);

globalThis.Notification = class Notification {
  static permission = "default";
  static requestPermission() { return Promise.resolve(Notification.permission); }
  constructor() {}
};

globalThis.WebGLRenderingContext = class WebGLRenderingContext {};
globalThis.WebGL2RenderingContext = class WebGL2RenderingContext {};

class Screen {
  constructor(w, h) {
    this._w = w; this._h = h;
    var _cd = (globalThis.__obscura_fp_cfg && globalThis.__obscura_fp_cfg.color_depth) || 24;
    this.colorDepth = _cd; this.pixelDepth = _cd; this.availTop = 0; this.availLeft = 0;
    this.orientation = {type:'landscape-primary',angle:0,addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}};
  }
  get width() { return this._w; }
  get height() { return this._h; }
  get availWidth() { return this._w; }
  get availHeight() { return this._h - 40; }
}
['width','height','availWidth','availHeight'].forEach(function(k) {
  var d = Object.getOwnPropertyDescriptor(Screen.prototype, k);
  if (d && d.get) _markNative(d.get);
});
globalThis.Screen = Screen;
globalThis.screen = new Screen(1920, 1080);
globalThis.visualViewport = { width:1920, height:1000, offsetLeft:0, offsetTop:0, scale:1, addEventListener(){}, removeEventListener(){} };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920; globalThis.innerHeight = 1000;
globalThis.outerWidth = 1920; globalThis.outerHeight = 1080;
globalThis.scrollX = 0; globalThis.scrollY = 0;
globalThis.pageXOffset = 0; globalThis.pageYOffset = 0;

globalThis.__fetchInterceptEnabled = false;
globalThis.__fetchInterceptCallback = null; // Set by CDP to handle paused requests

// charCode -> 6-bit value reverse table for base64 decode. -1 for any byte not
// in the standard alphabet, which mirrors String.indexOf's miss exactly, so the
// bitmath below stays byte-identical to the old indexOf path including on
// malformed input. Built once at module load.
const _B64_DECODE_TABLE = (function () {
  const t = new Int16Array(128).fill(-1);
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i;
  return t;
})();


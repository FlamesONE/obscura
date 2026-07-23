globalThis.RTCPeerConnection = class RTCPeerConnection {
  constructor(){
    this.localDescription=null;this.remoteDescription=null;
    this.iceConnectionState='new';this.iceGatheringState='new';
    this.signalingState='stable';this.connectionState='new';
    this.onicecandidate=null;this.onicegatheringstatechange=null;
    this.oniceconnectionstatechange=null;this.onconnectionstatechange=null;this.onsignalingstatechange=null;
    this._listeners={};
  }
  addEventListener(t,fn){ if(typeof fn==='function'){(this._listeners[t]=this._listeners[t]||[]).push(fn);} }
  removeEventListener(t,fn){ var l=this._listeners[t]; if(l){var i=l.indexOf(fn); if(i>=0)l.splice(i,1);} }
  dispatchEvent(){ return true; }
  _emit(t,ev){ ev=ev||{}; if(ev.type===undefined)ev.type=t; var h=this['on'+t]; if(typeof h==='function'){try{h.call(this,ev);}catch(e){}} (this._listeners[t]||[]).forEach(function(fn){try{fn.call(this,ev);}catch(e){}}, this); }
  createOffer(){return Promise.resolve({type:'offer',sdp:''});}
  createAnswer(){return Promise.resolve({type:'answer',sdp:''});}
  setLocalDescription(d){ this.localDescription=d||{type:'offer',sdp:''}; this._gather(); return Promise.resolve(); }
  setRemoteDescription(){return Promise.resolve();}
  addIceCandidate(){return Promise.resolve();}
  close(){}
  createDataChannel(){return {close(){},send(){},addEventListener(){},removeEventListener(){}};}
  getStats(){return Promise.resolve(new Map());}
  // ICE gathering must terminate or WebRTC fingerprinters (CreepJS) that await a
  // final onicecandidate(null) hang forever. Emit NO host candidates (no real-IP
  // leak — privacy-safe, like a browser with WebRTC IP handling policy) and then
  // the null candidate that signals gathering-complete.
  _gather(){
    var self=this;
    if(self.iceGatheringState!=='new')return;
    setTimeout(function(){
      self.iceGatheringState='gathering'; self._emit('icegatheringstatechange',{});
      setTimeout(function(){
        self.iceGatheringState='complete';
        self._emit('icecandidate',{candidate:null});
        self._emit('icegatheringstatechange',{});
      },0);
    },0);
  }
};
globalThis.RTCSessionDescription = class RTCSessionDescription { constructor(d){this.type=d?.type;this.sdp=d?.sdp;} };
globalThis.RTCIceCandidate = class RTCIceCandidate { constructor(d){this.candidate=d?.candidate||'';} };

// Minimal but spec-shape-correct IndexedDB shim. We don't persist anything,
// but authentication libraries (Firebase, Supabase, dexie) hang forever on
// the first `get` because their request's `onsuccess` is never called. Fire
// `onsuccess` asynchronously with `null` so reads complete-but-empty, which
// most libraries treat as a cache miss and fall back to the network.
function _idbRequest(produceResult) {
  const req = {
    result: undefined,
    error: null,
    source: null,
    transaction: null,
    readyState: 'pending',
    onsuccess: null,
    onerror: null,
    addEventListener(type, fn) { req['on' + type] = fn; },
    removeEventListener(type, fn) { if (req['on' + type] === fn) req['on' + type] = null; },
  };
  Promise.resolve().then(() => {
    try {
      req.result = produceResult();
      req.readyState = 'done';
      if (typeof req.onsuccess === 'function') {
        try { req.onsuccess({ target: req, type: 'success' }); } catch (e) {}
      }
    } catch (e) {
      req.error = e; req.readyState = 'done';
      if (typeof req.onerror === 'function') {
        try { req.onerror({ target: req, type: 'error' }); } catch (e2) {}
      }
    }
  });
  return req;
}

function _idbObjectStore(name) {
  const data = new Map();
  return {
    name,
    keyPath: null,
    autoIncrement: false,
    indexNames: { contains() { return false; }, length: 0, item() { return null; } },
    transaction: null,
    add(value, key) { const k = key ?? Date.now(); data.set(k, value); return _idbRequest(() => k); },
    put(value, key) { const k = key ?? Date.now(); data.set(k, value); return _idbRequest(() => k); },
    get(key) { return _idbRequest(() => data.get(key) ?? undefined); },
    getAll() { return _idbRequest(() => Array.from(data.values())); },
    getAllKeys() { return _idbRequest(() => Array.from(data.keys())); },
    getKey(key) { return _idbRequest(() => (data.has(key) ? key : undefined)); },
    delete(key) { return _idbRequest(() => { data.delete(key); return undefined; }); },
    clear() { return _idbRequest(() => { data.clear(); return undefined; }); },
    count() { return _idbRequest(() => data.size); },
    openCursor() { return _idbRequest(() => null); },
    openKeyCursor() { return _idbRequest(() => null); },
    createIndex() { return { name: '', keyPath: '', unique: false, multiEntry: false, get() { return _idbRequest(() => undefined); } }; },
    index() { return { get() { return _idbRequest(() => undefined); }, getAll() { return _idbRequest(() => []); }, count() { return _idbRequest(() => 0); }, openCursor() { return _idbRequest(() => null); } }; },
    deleteIndex() {},
  };
}

function _idbTransaction(storeNames) {
  const stores = new Map();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  for (const n of names) stores.set(String(n), _idbObjectStore(String(n)));
  const tx = {
    db: null,
    mode: 'readonly',
    objectStoreNames: { contains: (n) => stores.has(String(n)), length: stores.size },
    onabort: null, oncomplete: null, onerror: null,
    error: null,
    objectStore(name) {
      let s = stores.get(name);
      if (!s) { s = _idbObjectStore(name); stores.set(name, s); }
      s.transaction = tx;
      return s;
    },
    abort() {},
    commit() {},
    addEventListener(type, fn) { tx['on' + type] = fn; },
    removeEventListener(type, fn) { if (tx['on' + type] === fn) tx['on' + type] = null; },
  };
  Promise.resolve().then(() => {
    if (typeof tx.oncomplete === 'function') {
      try { tx.oncomplete({ target: tx, type: 'complete' }); } catch (e) {}
    }
  });
  return tx;
}

function _idbDatabase(name, version) {
  return {
    name,
    version,
    objectStoreNames: { contains() { return false; }, length: 0, item() { return null; } },
    createObjectStore(n) { return _idbObjectStore(n); },
    deleteObjectStore() {},
    transaction(storeNames, mode) {
      const tx = _idbTransaction(storeNames);
      tx.mode = mode || 'readonly';
      return tx;
    },
    close() {},
    onversionchange: null, onabort: null, onerror: null, onclose: null,
    addEventListener() {}, removeEventListener() {},
  };
}

globalThis.indexedDB = {
  open(name, version) {
    return _idbRequest(() => _idbDatabase(name, version || 1));
  },
  deleteDatabase(_name) { return _idbRequest(() => undefined); },
  databases() { return Promise.resolve([]); },
  cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
};
globalThis.IDBKeyRange = {
  only(v) { return { lower: v, upper: v, lowerOpen: false, upperOpen: false, includes(x) { return x === v; } }; },
  lowerBound(v, open) { return { lower: v, upper: null, lowerOpen: !!open, upperOpen: false, includes(x) { return open ? x > v : x >= v; } }; },
  upperBound(v, open) { return { lower: null, upper: v, lowerOpen: false, upperOpen: !!open, includes(x) { return open ? x < v : x <= v; } }; },
  bound(l, u, lo, uo) { return { lower: l, upper: u, lowerOpen: !!lo, upperOpen: !!uo, includes(x) { return (lo ? x > l : x >= l) && (uo ? x < u : x <= u); } }; },
};

globalThis.caches = {
  open() { return Promise.resolve({ match(){return Promise.resolve(undefined);}, put(){return Promise.resolve();}, delete(){return Promise.resolve(false);}, keys(){return Promise.resolve([]);} }); },
  match() { return Promise.resolve(undefined); },
  has() { return Promise.resolve(false); },
  delete() { return Promise.resolve(false); },
  keys() { return Promise.resolve([]); },
};

_markNative(AudioContext); _markNative(OfflineAudioContext);
_markNative(SpeechSynthesisUtterance);
_markNative(MediaStream); _markNative(MediaStreamTrack);
_markNative(RTCPeerConnection); _markNative(RTCSessionDescription); _markNative(RTCIceCandidate);

// Timezone is driven by the process TZ (set by the CLI, default Europe/Berlin),
// so native Intl.DateTimeFormat and Date report the same zone. No JS override:
// forcing a fixed zone here only on Intl left Date on UTC, which is the exact
// cross-surface mismatch a fingerprinting script looks for.

if (typeof PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, opts={}) { super(type, opts); this.pointerId = opts.pointerId || 0; this.width = opts.width || 1; this.height = opts.height || 1; this.pressure = opts.pressure || 0; this.pointerType = opts.pointerType || 'mouse'; }
  };
}

// These navigator surfaces must also live on Navigator.prototype (memoized), not
// as own props on the instance, or they reintroduce the own-props tell fixed above.
(function() {
  var P = Navigator.prototype;
  function memo(key, build) {
    var c, b = false;
    var g = function() { if (!b) { c = build(); b = true; } return c; };
    _markNative(g);
    Object.defineProperty(P, key, { get: g, set: undefined, enumerable: true, configurable: true });
  }
  memo('credentials', function() { return { get: function() { return Promise.resolve(null); }, create: function() { return Promise.resolve(null); }, store: function() { return Promise.resolve(); }, preventSilentAccess: function() { return Promise.resolve(); } }; });
  memo('mediaCapabilities', function() { return { decodingInfo: function(cfg) { return Promise.resolve({ supported: true, smooth: true, powerEfficient: true, keySystemAccess: null, configuration: cfg }); }, encodingInfo: function(cfg) { return Promise.resolve({ supported: true, smooth: true, powerEfficient: true, configuration: cfg }); } }; });
  memo('locks', function() { return { request: function(name, opts, cb) { if (typeof opts === 'function') { cb = opts; opts = {}; } if (typeof cb === 'function') return Promise.resolve(cb({ name: name, mode: (opts && opts.mode) || 'exclusive' })); return Promise.resolve(null); }, query: function() { return Promise.resolve({ held: [], pending: [] }); } }; });
  memo('keyboard', function() { return { getLayoutMap: function() { return Promise.resolve(new Map()); }, lock: function() { return Promise.resolve(); }, unlock: function() {} }; });
  memo('gpu', function() { return { requestAdapter: function() { return Promise.resolve(null); } }; });
  memo('wakeLock', function() { return { request: function() { return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); } }; });
})();

globalThis.opener = null;

globalThis.Worker = class Worker {
  constructor(url) {
    this.onmessage = null;
    this.onerror = null;
    this._terminated = false;
    this._listeners = {};
    const worker = this;

    let resolvedUrl = url;
    if (typeof url === 'string') {
      const blob = globalThis.__blobStore?.[url];
      if (blob) {
        worker._code = blob;
        // Auto-start on next tick so caller can set onmessage first.
        setTimeout(() => worker._autoRun(), 0);
        return;
      }
      // Resolve relative URLs against the current page.
      if (!url.startsWith('http') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        try { resolvedUrl = new URL(url, globalThis.location?.href || '').href; } catch(e) {}
      }
      (async () => {
        try {
          const resp = await fetch(resolvedUrl);
          worker._code = await resp.text();
          if (!worker._terminated) worker._autoRun();
        } catch(e) { if (worker.onerror) worker.onerror(e); }
      })();
    }
  }
  _makeScope() {
    const worker = this;
    // WorkerGlobalScope defined + no document property → IS_WORKER_SCOPE = true in creepjs
    const scope = {
      WorkerGlobalScope: function WorkerGlobalScope() {},
      DedicatedWorkerGlobalScope: function DedicatedWorkerGlobalScope() {},
      postMessage: (msg) => {
        if (worker._terminated) return;
        const evt = { data: msg };
        if (worker.onmessage) worker.onmessage(evt);
        const ls = worker._listeners['message'] || [];
        for (const h of ls) h(evt);
      },
      addEventListener: (type, fn) => {
        if (!scope._ev) scope._ev = {};
        if (!scope._ev[type]) scope._ev[type] = [];
        scope._ev[type].push(fn);
      },
      close: () => { worker._terminated = true; },
      crypto: globalThis.crypto,
      Crypto: globalThis.Crypto,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval,
      fetch: globalThis.fetch,
      console: globalThis.console,
      performance: globalThis.performance,
      location: globalThis.location,
    };
    scope.self = scope;
    return scope;
  }
  // Runs the worker's top-level source exactly once and keeps the resulting
  // scope around, matching how a real worker script actually behaves (its
  // body runs a single time and only the persistent self.onmessage /
  // addEventListener('message') handler runs per message afterward).
  // Previously this same compile-and-run step happened again on every
  // postMessage(), which threw away any state the script built at top level
  // (tables, counters, closures) between messages — breaking code, such as a
  // proof-of-work worker used by Cloudflare's challenge runtime, that sets
  // something up once and references it from the message handler later.
  _ensureRun() {
    if (this._scope || this._terminated || !this._code) return;
    const worker = this;
    const scope = worker._makeScope();
    worker._scope = scope;
    try {
      // Worker scripts very commonly assign a bare `onmessage = fn` (no
      // `self.`), which in a real worker sets the global-scope handler. Run via
      // a plain `new Function`, that write would instead leak to the page global
      // and `scope.onmessage` would stay unset, so the handler never fires and
      // the worker silently never replies (observed: iphey's console-timing
      // worker `onmessage = function(e){...postMessage(...)}` — its reply is
      // awaited by the fingerprint, so the whole verdict hung). Declare the
      // event-handler names as function-local bindings, then copy any the script
      // assigned onto the scope after it runs. Works in both sloppy and strict
      // worker code (unlike `with(self)`, which is a SyntaxError under strict).
      const HN = ['onmessage', 'onerror', 'onmessageerror'];
      const prologue = 'var ' + HN.join(',') + ';\n';
      const epilogue = '\n;' + HN.map(h => 'if(typeof ' + h + '!=="undefined"&&' + h + ')self.' + h + '=' + h + ';').join('');
      const runWorkerSource = new Function('self', 'postMessage', 'addEventListener', 'close', prologue + worker._code + epilogue);
      runWorkerSource(scope, scope.postMessage, scope.addEventListener, scope.close);
    } catch(e) {
      console.error('Worker error:', e.message);
      if (worker.onerror) worker.onerror(e);
    }
  }
  _autoRun() { this._ensureRun(); }
  postMessage(data) {
    if (this._terminated) return;
    const worker = this;
    setTimeout(() => {
      if (worker._terminated || !worker._code) return;
      worker._ensureRun();
      const scope = worker._scope;
      if (!scope) return;
      try {
        const evs = (scope._ev && scope._ev['message']) || [];
        if (evs.length) { for (const h of evs) h({ data }); }
        else if (scope.onmessage) scope.onmessage({ data });
      } catch(e) {
        console.error('Worker error:', e.message);
        if (worker.onerror) worker.onerror(e);
      }
    }, 0);
  }
  terminate() { this._terminated = true; }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(h => h !== fn);
  }
};

globalThis.__blobStore = globalThis.__blobStore || {};
URL.createObjectURL = function(blob) {
  if (blob) {
    const id = 'blob:obscura/' + Math.random().toString(36).substring(2);
    // Store synchronously so a Worker built from the blob URL in the same
    // tick sees its source. Blob-URL Worker construction is synchronous in
    // real browsers; the previous async blob.text().then() store raced the
    // Worker constructor, so new Worker(blobURL) fell through to fetch() and
    // failed (net::ERR_FAILED), which broke AWS WAF's proof-of-work worker.
    // The obscura Blob materializes _bytes in its constructor; fall back to
    // the async text() store only for foreign Blob shims without _bytes.
    if (blob._bytes) {
      let text = '';
      try { text = new TextDecoder().decode(blob._bytes); } catch (e) {}
      globalThis.__blobStore[id] = text;
    } else if (typeof blob.text === 'function') {
      blob.text().then(text => { globalThis.__blobStore[id] = text; });
    } else {
      globalThis.__blobStore[id] = '';
    }
    return id;
  }
  return 'blob:obscura/fallback';
};
URL.revokeObjectURL = function(url) {
  delete globalThis.__blobStore[url];
};

globalThis.scrollTo = function(x, y) {};
globalThis.scrollBy = function(x, y) {};
globalThis.scroll = function(x, y) {};
globalThis.focus = function() {}; _markNative(globalThis.focus);
globalThis.blur = function() {}; _markNative(globalThis.blur);
globalThis.print = function() {}; _markNative(globalThis.print);
globalThis.alert = function() {}; _markNative(globalThis.alert);
globalThis.confirm = function() { return true; }; _markNative(globalThis.confirm);
globalThis.prompt = function() { return null; }; _markNative(globalThis.prompt);
globalThis.open = function() { return null; }; _markNative(globalThis.open);
globalThis.close = function() {}; _markNative(globalThis.close);
globalThis.stop = function() {}; _markNative(globalThis.stop);
globalThis.postMessage = function() {}; _markNative(globalThis.postMessage);
globalThis.requestIdleCallback = globalThis.requestIdleCallback || function(cb) { return setTimeout(cb, 0); };
globalThis.cancelIdleCallback = globalThis.cancelIdleCallback || function(id) { clearTimeout(id); };
if (typeof ReadableStream === 'undefined') {
  globalThis.ReadableStream = class ReadableStream {
    constructor(source = {}, strategy = {}) {
      this._source = source; this._queue = []; this._closed = false;
      this.locked = false;
      if (source.start) source.start({ enqueue: (chunk) => this._queue.push(chunk), close: () => { this._closed = true; }, error: () => {} });
    }
    getReader() {
      this.locked = true;
      const stream = this;
      return {
        read() {
          if (stream._queue.length > 0) return Promise.resolve({ value: stream._queue.shift(), done: false });
          if (stream._closed) return Promise.resolve({ value: undefined, done: true });
          return Promise.resolve({ value: undefined, done: true });
        },
        releaseLock() { stream.locked = false; },
        cancel() { stream._closed = true; return Promise.resolve(); },
        get closed() { return stream._closed ? Promise.resolve() : new Promise(() => {}); },
      };
    }
    cancel() { this._closed = true; return Promise.resolve(); }
    pipeTo(dest) { return Promise.resolve(); }
    pipeThrough(transform) { return transform.readable || new ReadableStream(); }
    tee() { return [new ReadableStream(), new ReadableStream()]; }
    [Symbol.asyncIterator]() {
      const reader = this.getReader();
      return { next: () => reader.read(), return: () => { reader.releaseLock(); return Promise.resolve({done:true}); } };
    }
  };
}
if (typeof WritableStream === 'undefined') {
  globalThis.WritableStream = class WritableStream {
    constructor(sink = {}) { this._sink = sink; this.locked = false; }
    getWriter() {
      this.locked = true;
      const stream = this;
      return {
        write(chunk) { if (stream._sink.write) stream._sink.write(chunk); return Promise.resolve(); },
        close() { if (stream._sink.close) stream._sink.close(); return Promise.resolve(); },
        abort() { return Promise.resolve(); },
        releaseLock() { stream.locked = false; },
        get ready() { return Promise.resolve(); },
        get closed() { return Promise.resolve(); },
        get desiredSize() { return 1; },
      };
    }
    close() { return Promise.resolve(); }
    abort() { return Promise.resolve(); }
  };
}
if (typeof TransformStream === 'undefined') {
  globalThis.TransformStream = class TransformStream {
    constructor(transformer = {}) {
      this.readable = new ReadableStream();
      this.writable = new WritableStream();
    }
  };
}

if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.subtle) {
  // Real WebCrypto for the secret-key algorithms sites actually use: HMAC,
  // AES-GCM/CBC/CTR, PBKDF2 and HKDF, plus raw/JWK-oct key handling. The crypto
  // itself runs in Rust ops (RustCrypto); this shim only marshals bytes and
  // normalizes algorithm parameters. Public-key algorithms (RSA*, ECDSA, ECDH)
  // and non-symmetric key formats (pkcs8/spki) are not implemented and throw
  // NotSupportedError rather than returning fake data.
  const keyMaterial = new WeakMap();

  class CryptoKey {
    constructor() { throw new TypeError("Illegal constructor"); }
    get [Symbol.toStringTag]() { return "CryptoKey"; }
  }
  function makeKey(type, extractable, algorithm, usages, bytes) {
    const k = Object.create(CryptoKey.prototype);
    Object.defineProperty(k, "type", { value: type, enumerable: true });
    Object.defineProperty(k, "extractable", { value: !!extractable, enumerable: true });
    Object.defineProperty(k, "algorithm", { value: algorithm, enumerable: true });
    Object.defineProperty(k, "usages", { value: Object.freeze((usages || []).slice()), enumerable: true });
    keyMaterial.set(k, bytes);
    return k;
  }
  function keyBytes(key) {
    if (!(key instanceof CryptoKey) || !keyMaterial.has(key)) {
      throw new DOMException("Argument is not a valid CryptoKey", "InvalidAccessError");
    }
    return keyMaterial.get(key);
  }
  // A CryptoKey cloned via structuredClone or postMessage is a different
  // object, so the WeakMap lookup above misses and crypto.subtle throws
  // "Argument is not a valid CryptoKey". Re-register the (cloned) key's
  // material so the clone stays usable. The clone hook is dispatched by
  // _structuredClone via Symbol.toStringTag ("CryptoKey"); registered lazily
  // because structuredClone is defined before this block (issue #389).
  globalThis.__obscura_clone_hooks = globalThis.__obscura_clone_hooks || {};
  // `seen` is the clone memo _structuredClone hands every hook. Populate it so
  // one key reached twice in a graph clones to one shared object (and its key
  // material is registered once), matching structuredClone's identity rules.
  globalThis.__obscura_clone_hooks["CryptoKey"] = function (src, seen) {
    if (seen && seen.has(src)) return seen.get(src);
    const copy = makeKey(src.type, src.extractable, src.algorithm, src.usages, keyBytes(src));
    if (seen) seen.set(src, copy);
    return copy;
  };

  const toBytes = (data) => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data || []);
  };
  const bufferOf = (u8) => new Uint8Array(u8).buffer;

  const ALGO_CANON = {
    "AES-CTR": "AES-CTR", "AES-CBC": "AES-CBC", "AES-GCM": "AES-GCM", "AES-KW": "AES-KW",
    "HMAC": "HMAC", "PBKDF2": "PBKDF2", "HKDF": "HKDF",
    "RSASSA-PKCS1-V1_5": "RSASSA-PKCS1-v1_5", "RSA-PSS": "RSA-PSS", "RSA-OAEP": "RSA-OAEP",
    "ECDSA": "ECDSA", "ECDH": "ECDH",
  };
  function normalizeAlgo(algorithm) {
    const a = typeof algorithm === "string" ? { name: algorithm } : (algorithm || {});
    const upper = String(a.name || "").toUpperCase();
    const name = ALGO_CANON[upper] || upper;
    return Object.assign({}, a, { name });
  }
  // SubtleCrypto hashes for HMAC/PBKDF2/HKDF and digest (SHA-1/256/384/512).
  function normalizeHash(h) {
    const n = (typeof h === "string" ? h : (h && h.name) || "").toUpperCase().replace("_", "-");
    if (n === "SHA-1" || n === "SHA-256" || n === "SHA-384" || n === "SHA-512") return n;
    throw new DOMException("Unsupported hash algorithm: " + (h && (h.name || h)), "NotSupportedError");
  }
  const hashBlockSize = (hash) => (hash === "SHA-384" || hash === "SHA-512" ? 128 : 64);

  function b64urlToBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Run an op, converting a Rust-side failure (bad GCM tag, bad CBC padding)
  // into the OperationError the WebCrypto spec requires. DOMExceptions we raise
  // ourselves pass through unchanged.
  function runOp(fn) {
    try { return fn(); }
    catch (e) {
      if (e instanceof DOMException) throw e;
      throw new DOMException(String((e && e.message) || e), "OperationError");
    }
  }

  function keyAlgorithmFor(alg, bytes) {
    switch (alg.name) {
      case "HMAC":
        return { name: "HMAC", hash: { name: normalizeHash(alg.hash) }, length: bytes.length * 8 };
      case "AES-CTR": case "AES-CBC": case "AES-GCM": case "AES-KW":
        if (bytes.length !== 16 && bytes.length !== 24 && bytes.length !== 32) {
          throw new DOMException("AES key data must be 128, 192, or 256 bits", "DataError");
        }
        return { name: alg.name, length: bytes.length * 8 };
      case "PBKDF2": return { name: "PBKDF2" };
      case "HKDF": return { name: "HKDF" };
      default:
        throw new DOMException("Unsupported key algorithm: " + alg.name, "NotSupportedError");
    }
  }

  const subtle = {
    async digest(algorithm, data) {
      const name = (typeof algorithm === "string" ? algorithm : algorithm && algorithm.name || "").toUpperCase().replace("_", "-");
      if (name !== "SHA-1" && name !== "SHA-256" && name !== "SHA-384" && name !== "SHA-512" &&
          name !== "SHA-512/224" && name !== "SHA-512/256") {
        throw new DOMException("Unrecognized algorithm name", "NotSupportedError");
      }
      return bufferOf(__obscura_core.ops.op_subtle_digest(name, toBytes(data)));
    },

    async importKey(format, keyData, algorithm, extractable, keyUsages) {
      const alg = normalizeAlgo(algorithm);
      let bytes;
      if (format === "raw") {
        bytes = toBytes(keyData);
      } else if (format === "jwk") {
        if (!keyData || keyData.kty !== "oct" || typeof keyData.k !== "string") {
          throw new DOMException("Only symmetric 'oct' JWK keys are supported", "NotSupportedError");
        }
        bytes = b64urlToBytes(keyData.k);
      } else {
        throw new DOMException("Only 'raw' and symmetric 'jwk' key formats are supported", "NotSupportedError");
      }
      return makeKey("secret", extractable, keyAlgorithmFor(alg, bytes), keyUsages, bytes);
    },

    async exportKey(format, key) {
      const bytes = keyBytes(key);
      if (!key.extractable) throw new DOMException("Key is not extractable", "InvalidAccessError");
      if (format === "raw") return bufferOf(bytes);
      if (format === "jwk") {
        const jwk = { kty: "oct", k: bytesToB64url(bytes), ext: key.extractable, key_ops: key.usages.slice() };
        if (key.algorithm.name && key.algorithm.name.indexOf("AES-") === 0) {
          jwk.alg = "A" + (bytes.length * 8) + key.algorithm.name.slice(4);
        } else if (key.algorithm.name === "HMAC") {
          jwk.alg = "HS" + key.algorithm.hash.name.slice(4);
        }
        return jwk;
      }
      throw new DOMException("Only 'raw' and 'jwk' export is supported", "NotSupportedError");
    },

    async generateKey(algorithm, extractable, keyUsages) {
      const alg = normalizeAlgo(algorithm);
      if (alg.name === "HMAC") {
        const hash = normalizeHash(alg.hash);
        const len = alg.length ? Math.ceil(alg.length / 8) : hashBlockSize(hash);
        const bytes = __obscura_core.ops.op_random_bytes(len);
        return makeKey("secret", extractable, { name: "HMAC", hash: { name: hash }, length: len * 8 }, keyUsages, bytes);
      }
      if (alg.name === "AES-CTR" || alg.name === "AES-CBC" || alg.name === "AES-GCM" || alg.name === "AES-KW") {
        if (alg.length !== 128 && alg.length !== 192 && alg.length !== 256) {
          throw new DOMException("AES key length must be 128, 192, or 256 bits", "OperationError");
        }
        const bytes = __obscura_core.ops.op_random_bytes(alg.length / 8);
        return makeKey("secret", extractable, { name: alg.name, length: alg.length }, keyUsages, bytes);
      }
      throw new DOMException("generateKey does not support " + alg.name, "NotSupportedError");
    },

    async sign(algorithm, key, data) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(key);
      if (alg.name === "HMAC") {
        const hash = key.algorithm && key.algorithm.hash ? key.algorithm.hash.name : normalizeHash(alg.hash);
        return bufferOf(runOp(() => __obscura_core.ops.op_subtle_hmac(hash, bytes, toBytes(data))));
      }
      throw new DOMException("sign does not support " + alg.name, "NotSupportedError");
    },

    async verify(algorithm, key, signature, data) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(key);
      if (alg.name === "HMAC") {
        const hash = key.algorithm && key.algorithm.hash ? key.algorithm.hash.name : normalizeHash(alg.hash);
        const mac = runOp(() => __obscura_core.ops.op_subtle_hmac(hash, bytes, toBytes(data)));
        const sig = toBytes(signature);
        if (sig.length !== mac.length) return false;
        let diff = 0;
        for (let i = 0; i < mac.length; i++) diff |= mac[i] ^ sig[i];
        return diff === 0;
      }
      throw new DOMException("verify does not support " + alg.name, "NotSupportedError");
    },

    async encrypt(algorithm, key, data) { return aesCipher(true, algorithm, key, data); },
    async decrypt(algorithm, key, data) { return aesCipher(false, algorithm, key, data); },

    async deriveBits(algorithm, baseKey, length) {
      const alg = normalizeAlgo(algorithm);
      const bytes = keyBytes(baseKey);
      const lenBytes = Math.ceil((length || 0) / 8);
      if (alg.name === "PBKDF2") {
        const hash = normalizeHash(alg.hash);
        const salt = toBytes(alg.salt);
        const iterations = alg.iterations >>> 0;
        return bufferOf(runOp(() => __obscura_core.ops.op_subtle_pbkdf2(hash, bytes, salt, iterations, lenBytes)));
      }
      if (alg.name === "HKDF") {
        const hash = normalizeHash(alg.hash);
        const salt = alg.salt != null ? toBytes(alg.salt) : new Uint8Array(0);
        const info = alg.info != null ? toBytes(alg.info) : new Uint8Array(0);
        return bufferOf(runOp(() => __obscura_core.ops.op_subtle_hkdf(hash, bytes, salt, info, lenBytes)));
      }
      throw new DOMException("deriveBits does not support " + alg.name, "NotSupportedError");
    },

    async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages) {
      const dAlg = normalizeAlgo(derivedKeyAlgorithm);
      let bits;
      if (dAlg.name === "HMAC") {
        bits = dAlg.length || hashBlockSize(normalizeHash(dAlg.hash)) * 8;
      } else if (dAlg.name === "AES-CTR" || dAlg.name === "AES-CBC" || dAlg.name === "AES-GCM" || dAlg.name === "AES-KW") {
        bits = dAlg.length;
        if (bits !== 128 && bits !== 192 && bits !== 256) {
          throw new DOMException("AES key length must be 128, 192, or 256 bits", "OperationError");
        }
      } else {
        throw new DOMException("deriveKey does not support deriving " + dAlg.name, "NotSupportedError");
      }
      const derivedBits = await this.deriveBits(algorithm, baseKey, bits);
      return this.importKey("raw", derivedBits, derivedKeyAlgorithm, extractable, keyUsages);
    },

    async wrapKey(format, key, wrappingKey, wrapAlgorithm) {
      const exported = await this.exportKey(format, key);
      const bytes = format === "jwk"
        ? new TextEncoder().encode(JSON.stringify(exported))
        : new Uint8Array(exported);
      return this.encrypt(wrapAlgorithm, wrappingKey, bytes);
    },

    async unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) {
      const decrypted = await this.decrypt(unwrapAlgorithm, unwrappingKey, wrappedKey);
      const keyData = format === "jwk"
        ? JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)))
        : decrypted;
      return this.importKey(format, keyData, unwrappedKeyAlgorithm, extractable, keyUsages);
    },
  };

  function aesCipher(encrypt, algorithm, key, data) {
    const alg = normalizeAlgo(algorithm);
    const bytes = keyBytes(key);
    const input = toBytes(data);
    if (alg.name === "AES-GCM") {
      const iv = toBytes(alg.iv);
      const aad = alg.additionalData != null ? toBytes(alg.additionalData) : new Uint8Array(0);
      const tagLength = alg.tagLength == null ? 128 : alg.tagLength;
      if (tagLength !== 128) {
        throw new DOMException("Only a 128-bit AES-GCM tag length is supported", "NotSupportedError");
      }
      return bufferOf(runOp(() => __obscura_core.ops.op_subtle_aes_gcm(encrypt, bytes, iv, aad, input)));
    }
    if (alg.name === "AES-CBC") {
      const iv = toBytes(alg.iv);
      return bufferOf(runOp(() => __obscura_core.ops.op_subtle_aes_cbc(encrypt, bytes, iv, input)));
    }
    if (alg.name === "AES-CTR") {
      const counter = toBytes(alg.counter);
      const length = alg.length >>> 0;
      return bufferOf(runOp(() => __obscura_core.ops.op_subtle_aes_ctr(bytes, counter, length, input)));
    }
    throw new DOMException((encrypt ? "encrypt" : "decrypt") + " does not support " + alg.name, "NotSupportedError");
  }

  globalThis.CryptoKey = CryptoKey;
  globalThis.SubtleCrypto = function SubtleCrypto() { throw new TypeError("Illegal constructor"); };
  Object.setPrototypeOf(subtle, globalThis.SubtleCrypto.prototype);
  globalThis.crypto.subtle = subtle;
}

if (typeof DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect {
    constructor(x=0,y=0,w=0,h=0) { this.x=x;this.y=y;this.width=w;this.height=h;this.top=y;this.right=x+w;this.bottom=y+h;this.left=x; }
    toJSON() { return {x:this.x,y:this.y,width:this.width,height:this.height,top:this.top,right:this.right,bottom:this.bottom,left:this.left}; }
    static fromRect(r={}) { return new DOMRect(r.x,r.y,r.width,r.height); }
  };
}

if (typeof DOMRectList === 'undefined') {
  globalThis.DOMRectList = class DOMRectList {
    constructor(arr=[]) {
      this.length = arr.length;
      for (let i = 0; i < arr.length; i++) this[i] = arr[i];
    }
    item(i) { return this[i] || null; }
    [Symbol.iterator]() {
      let i = 0, self = this;
      return { next() { const done = i >= self.length; return { value: done ? undefined : self[i++], done }; } };
    }
  };
}
if (typeof DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {
    constructor(x=0,y=0,z=0,w=1) { this.x=x;this.y=y;this.z=z;this.w=w; }
    static fromPoint(p={}) { return new DOMPoint(p.x,p.y,p.z,p.w); }
  };
}
if (typeof DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;this.is2D=true;this.isIdentity=true; }
    static fromMatrix() { return new DOMMatrix(); }
    static fromFloat32Array() { return new DOMMatrix(); }
    static fromFloat64Array() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint(p) { return new DOMPoint(p?.x||0,p?.y||0); }
  };
}

if (typeof Image === 'undefined') {
  // In a real browser `new Image()` is `document.createElement('img')`, i.e. a
  // full HTMLImageElement. The old plain-class shim had no `.style`, so
  // `new Image().style` was `undefined` and libraries that touch it on a
  // detached image threw (issue #350). Build a real element so `.style`,
  // attribute reflection, and event dispatch all come for free.
  const _imgSrcDesc = Object.getOwnPropertyDescriptor(globalThis.HTMLImageElement.prototype, 'src');
  globalThis.Image = function Image(width, height) {
    const img = document.createElement('img');
    img.onload = null; img.onerror = null;
    img.complete = false; img.naturalWidth = 0; img.naturalHeight = 0;
    img.width = width !== undefined ? (width >>> 0) : 0;
    img.height = height !== undefined ? (height >>> 0) : 0;
    // There is no real image decoder, so emulate a successful decode: assigning
    // `.src` flips `complete` and fires `load` on a microtask-later tick. Lazy
    // loaders and preloaders that create `new Image()`, set `.src`, and wait for
    // `onload` (or addEventListener('load')) would hang forever otherwise.
    // Anti-bot scripts (Booking.com, issue #394) pre-define a non-configurable
    // own `src` on <img> elements; redefining it throws "Cannot redefine
    // property: src" and kills the constructor. Skip the load emulation then:
    // a page that owns `src` is instrumenting loads itself.
    const ownSrc = Object.getOwnPropertyDescriptor(img, 'src');
    if (!ownSrc || ownSrc.configurable) {
      Object.defineProperty(img, 'src', {
        configurable: true, enumerable: true,
        get() { return _imgSrcDesc.get.call(img); },
        set(v) {
          _imgSrcDesc.set.call(img, v);
          if (!img.getAttribute('src')) return;
          img.complete = false;
          setTimeout(function () {
            img.complete = true;
            img.naturalWidth = img.naturalWidth || img.width || 0;
            img.naturalHeight = img.naturalHeight || img.height || 0;
            try { img.dispatchEvent(new Event('load')); } catch (e) {}
          }, 0);
        },
      });
    }
    return img;
  };
  globalThis.Image.prototype = globalThis.HTMLImageElement.prototype;
}

if (typeof MediaRecorder === 'undefined') {
  // Real Chrome exposes MediaRecorder; its absence ('MediaRecorder' in window ===
  // false) is a fingerprint tell (CreepJS media surface). isTypeSupported must
  // report Chrome's codec matrix.
  globalThis.MediaRecorder = class MediaRecorder {
    constructor(stream, opts) { this.stream = stream; this.state = 'inactive'; this.mimeType = (opts && opts.mimeType) || ''; this.videoBitsPerSecond = 0; this.audioBitsPerSecond = 0; this.ondataavailable = null; this.onstop = null; this.onstart = null; this.onerror = null; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    requestData() {}
    addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
    static isTypeSupported(t) {
      t = String(t || '');
      return /^(audio\/webm|video\/webm|audio\/mp4|video\/mp4|video\/x-matroska)(;|$)/.test(t) ||
        /codecs[:=]?.*(vp8|vp9|opus|avc1|h264|pcm)/i.test(t);
    }
  };
  _markNative(globalThis.MediaRecorder);
  _markNative(globalThis.MediaRecorder.isTypeSupported);
}
if (typeof Audio === 'undefined') {
  globalThis.Audio = class Audio {
    constructor(src) { this.src = src || ''; this.paused = true; this.volume = 1; this.currentTime = 0; this.duration = 0; }
    play() { return Promise.resolve(); } pause() { this.paused = true; } load() {}
    addEventListener() {} removeEventListener() {}
  };
}

if (typeof FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null; this.error = null; this.readyState = 0; // EMPTY
      this.onloadstart = null; this.onprogress = null; this.onload = null;
      this.onabort = null; this.onerror = null; this.onloadend = null;
      this._listeners = {};
    }
    get [Symbol.toStringTag]() { return "FileReader"; }
    _read(blob, kind, encoding) {
      // Spec: reading while LOADING throws InvalidStateError.
      if (this.readyState === 1) throw new DOMException("The object is already busy reading Blobs.", "InvalidStateError");
      this.readyState = 1; // LOADING
      this.result = null; this.error = null;
      this._fire("loadstart");
      const self = this;
      Promise.resolve().then(function () {
        if (self.readyState !== 1) return; // aborted before completion
        const bytes = (blob && blob._bytes) ? blob._bytes : new Uint8Array(0);
        try {
          if (kind === "text") self.result = new TextDecoder(encoding || "utf-8").decode(bytes);
          else if (kind === "binary") self.result = _bytesToBinaryString(bytes);
          else if (kind === "dataurl") self.result = "data:" + ((blob && blob.type) || "application/octet-stream") + ";base64," + btoa(_bytesToBinaryString(bytes));
          else self.result = _arrayBufferFromBytes(bytes);
        } catch (e) { self.error = e; }
        self.readyState = 2; // DONE
        self._fire("progress"); self._fire("load"); self._fire("loadend");
      });
    }
    readAsText(blob, encoding) { this._read(blob, "text", encoding); }
    readAsDataURL(blob) { this._read(blob, "dataurl"); }
    readAsArrayBuffer(blob) { this._read(blob, "arraybuffer"); }
    readAsBinaryString(blob) { this._read(blob, "binary"); }
    abort() {
      const wasReading = this.readyState === 1;
      this.readyState = 0; this.result = null;
      if (wasReading) { this._fire("abort"); this._fire("loadend"); }
    }
    _fire(type) {
      const ev = { type: type, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 };
      const h = this["on" + type]; if (typeof h === "function") { try { h.call(this, ev); } catch (e) {} }
      const ls = this._listeners[type]; if (ls) for (const fn of ls.slice()) { try { fn.call(this, ev); } catch (e) {} }
    }
    addEventListener(t, fn) { if (typeof fn === "function") (this._listeners[t] = this._listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const ls = this._listeners[t]; if (ls) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1); } }
    dispatchEvent() { return true; }
  };
  globalThis.FileReader.EMPTY = 0; globalThis.FileReader.LOADING = 1; globalThis.FileReader.DONE = 2;
  Object.assign(globalThis.FileReader.prototype, { EMPTY: 0, LOADING: 1, DONE: 2 });
}

// Real network sockets aren't implemented; we don't have a runtime WS / SSE
// client in V8. But pages that wait for an `open` event (Vite HMR clients
// embedded on docs sites, live-dashboards, anything calling
// `await new Promise(r => ws.addEventListener('open', r))`) silently hang
// forever otherwise. Fire `open` after a microtask so the consumer at least
// proceeds; subsequent messages never arrive, which is no worse than the
// current "no signal whatsoever" behaviour.
// Minimal EventTarget shared by socket-like classes. Real `EventTarget` is
// currently aliased to `Node`, which would drag DOM-tree assumptions into a
// `WebSocket`. Defining a private shim avoids that.
function _makeListenerBox(self) {
  const map = new Map();
  self.addEventListener = function (type, fn) {
    if (typeof fn !== 'function') return;
    let bucket = map.get(type);
    if (!bucket) { bucket = []; map.set(type, bucket); }
    bucket.push(fn);
  };
  self.removeEventListener = function (type, fn) {
    const bucket = map.get(type);
    if (!bucket) return;
    const i = bucket.indexOf(fn);
    if (i >= 0) bucket.splice(i, 1);
  };
  self.dispatchEvent = function (event) {
    const bucket = map.get(event.type);
    if (!bucket) return true;
    for (const fn of bucket.slice()) {
      try { fn.call(self, event); } catch (e) { /* swallow */ }
    }
    return true;
  };
}

if (typeof EventSource === 'undefined') {
  globalThis.EventSource = class EventSource {
    constructor(url, init) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.withCredentials = !!(init && init.withCredentials);
      this.onopen = null; this.onmessage = null; this.onerror = null;
      _makeListenerBox(this);
      Promise.resolve().then(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1; // OPEN
        const ev = new Event('open');
        if (typeof this.onopen === 'function') { try { this.onopen(ev); } catch (e) {} }
        try { this.dispatchEvent(ev); } catch (e) {}
      });
    }
    close() { this.readyState = 2; }
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  };
}

if (typeof WebSocket === 'undefined') {
  // A real wss:// socket when the stealth transport ops are compiled in
  // (op_ws_connect etc., see ops.rs). A page that only fakes `open` and never
  // delivers server frames hangs any protocol awaiting a server-pushed message
  // — e.g. iphey/MixVisit's WASM opens wss://api.iphey.com/ws/<token>, sends
  // nothing, and blocks its whole verdict on the server's reply. Falls back to
  // the legacy fake-open stub in non-stealth builds where the ops are absent.
  //
  // Resolved lazily per-construction, NOT cached at class-definition time:
  // bootstrap.js runs during V8 snapshot creation (build.rs) before the ops
  // extension is attached, so a value captured here would be baked in as
  // absent forever. The live `__obscura_core.ops` gains the ops at runtime.
  const _wsOpsNow = () =>
    (__obscura_core && __obscura_core.ops && typeof __obscura_core.ops.op_ws_connect === 'function')
      ? __obscura_core.ops : null;
  globalThis.WebSocket = class WebSocket {
    constructor(url, protocols) {
      // Validate URL scheme per spec — Chrome throws SyntaxError for non-ws/wss URLs
      if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) {
        throw new DOMException(
          "Failed to construct 'WebSocket': The URL '" + url + "' is invalid.",
          'SyntaxError'
        );
      }
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.extensions = '';
      this.protocol = Array.isArray(protocols) ? (protocols[0] || '') : (protocols || '');
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      _makeListenerBox(this);
      this._rid = -1;
      this._closed = false;
      this._ops = _wsOpsNow();
      try { this._origin = new URL(url).origin; } catch (e) { this._origin = ''; }
      const self = this;
      if (!this._ops) {
        Promise.resolve().then(() => {
          if (self.readyState !== 0) return;
          self.readyState = 1;
          self._fire(new Event('open'));
        });
        return;
      }
      const protoArr = Array.isArray(protocols) ? protocols : (protocols ? [protocols] : []);
      this._ops.op_ws_connect(url, JSON.stringify(protoArr)).then((res) => {
        if (self._closed) return;
        let r; try { r = JSON.parse(res); } catch (e) { r = { error: 'bad response' }; }
        if (r.error || r.rid === undefined) { self._fail(r.error || 'connect failed'); return; }
        self._rid = r.rid;
        if (r.protocol) self.protocol = r.protocol;
        self.readyState = 1;
        self._fire(new Event('open'));
        self._pump();
      }, (e) => { if (!self._closed) self._fail(String(e)); });
    }
    _fire(ev) {
      const h = this['on' + ev.type];
      if (typeof h === 'function') { try { h.call(this, ev); } catch (e) {} }
      try { this.dispatchEvent(ev); } catch (e) {}
    }
    _fail(msg) {
      if (this._closed) return;
      this._closed = true; this.readyState = 3;
      this._fire(new Event('error'));
      const ev = new Event('close'); ev.code = 1006; ev.reason = ''; ev.wasClean = false;
      this._fire(ev);
    }
    _pump() {
      const self = this;
      if (self._rid < 0 || self._closed || !self._ops) return;
      self._ops.op_ws_recv(self._rid).then((res) => {
        if (self._closed) return;
        let r; try { r = JSON.parse(res); } catch (e) { self._fail('bad frame'); return; }
        if (r.type === 'message') {
          let data;
          if (r.binary) {
            const u8 = _base64ToUint8Array(r.bytesBase64 || '');
            data = (self.binaryType === 'arraybuffer') ? u8.buffer : new Blob([u8]);
          } else {
            data = r.text || '';
          }
          self._fire(new MessageEvent('message', { data: data, origin: self._origin }));
          self._pump();
        } else if (r.type === 'close') {
          self._doClose(r.code, r.reason, true);
        } else {
          self._fail(r.error || 'ws error');
        }
      }, (e) => { if (!self._closed) self._fail(String(e)); });
    }
    _doClose(code, reason, wasClean) {
      if (this._closed) return;
      this._closed = true; this.readyState = 3;
      const ev = new Event('close');
      ev.code = code || 1000; ev.reason = reason || ''; ev.wasClean = !!wasClean;
      this._fire(ev);
    }
    send(data) {
      if (this.readyState === 0) {
        throw new DOMException(
          "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
          'InvalidStateError'
        );
      }
      if (this._closed || this._rid < 0 || !this._ops) return;
      if (typeof data === 'string') { this._ops.op_ws_send_text(this._rid, data); return; }
      let u8;
      if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
      else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      else u8 = new Uint8Array(0);
      this._ops.op_ws_send_binary(this._rid, u8);
    }
    close(code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 2; // CLOSING
      if (this._ops && this._rid >= 0) this._ops.op_ws_close(this._rid, code || 1000, reason || '');
      this._doClose(code || 1000, reason || '', true);
    }
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  };
}

if (typeof BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class BroadcastChannel {
    constructor(name) {
      this.name = name; this.onmessage = null; this.onmessageerror = null;
      _makeListenerBox(this);
    }
    postMessage(msg) {}
    close() {}
  };
}

if (typeof MediaQueryList === 'undefined') {
  globalThis.MediaQueryList = class MediaQueryList {
    constructor(q) { this.media = q || ''; this.matches = false; }
    addListener() {} removeListener() {} addEventListener() {} removeEventListener() {}
  };
}

if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w, h) {
      if (w instanceof Uint8ClampedArray) { this.data = w; this.width = h; this.height = w.length / (4 * h); }
      else { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
    }
  };
}

if (typeof CanvasRenderingContext2D === 'undefined') {
  globalThis.CanvasRenderingContext2D = class CanvasRenderingContext2D {};
}

if (typeof OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext(type) { return globalThis.document?.createElement('canvas')?.getContext(type) || null; }
    convertToBlob() { return Promise.resolve(new Blob([''])); }
    transferToImageBitmap() { return {}; }
  };
}

if (typeof Path2D === 'undefined') {
  globalThis.Path2D = class Path2D { constructor(){} moveTo(){} lineTo(){} arc(){} rect(){} closePath(){} addPath(){} };
}

if (typeof ImageBitmap === 'undefined') {
  globalThis.ImageBitmap = class ImageBitmap { constructor(){this.width=0;this.height=0;} close(){} };
  globalThis.createImageBitmap = function() { return Promise.resolve(new ImageBitmap()); };
}

if (typeof Selection === 'undefined') {
  globalThis.Selection = class Selection {
    constructor(){this.anchorNode=null;this.focusNode=null;this.rangeCount=0;this.isCollapsed=true;this.type='None';}
    getRangeAt(){return null;} collapse(){} extend(){} selectAllChildren(){} deleteFromDocument(){}
    addRange(){} removeRange(){} removeAllRanges(){} toString(){return '';}
  };
}

if (typeof TreeWalker === 'undefined') {
  globalThis.TreeWalker = class TreeWalker {
    constructor(root){this.root=root;this.currentNode=root;this.whatToShow=0xFFFFFFFF;this.filter=null;}
    parentNode(){return this.currentNode?.parentNode||null;}
    firstChild(){return this.currentNode?.firstChild||null;}
    lastChild(){return this.currentNode?.lastChild||null;}
    previousSibling(){return this.currentNode?.previousSibling||null;}
    nextSibling(){return this.currentNode?.nextSibling||null;}
    nextNode(){return null;} previousNode(){return null;}
  };
}

if (typeof Range === 'undefined') {
  globalThis.Range = class Range {
    constructor(){this.startContainer=null;this.startOffset=0;this.endContainer=null;this.endOffset=0;this.collapsed=true;this.commonAncestorContainer=null;}
    setStart(n,o){this.startContainer=n;this.startOffset=o;} setEnd(n,o){this.endContainer=n;this.endOffset=o;}
    collapse(){} selectNode(){} selectNodeContents(){} cloneContents(){return document?.createDocumentFragment();}
    deleteContents(){} insertNode(){} getBoundingClientRect(){return new DOMRect();}
    getClientRects(){return new DOMRectList([]);} cloneRange(){return new Range();} toString(){return '';}
  };
}

if (typeof FontFace === 'undefined') {
  globalThis.FontFace = class FontFace {
    constructor(family, source, descriptors={}) {
      this.family = family;
      this.style = descriptors.style || 'normal';
      this.weight = descriptors.weight || 'normal';
      this.stretch = descriptors.stretch || 'normal';
      this.unicodeRange = descriptors.unicodeRange || 'U+0-10FFFF';
      this.variant = descriptors.variant || 'normal';
      this.featureSettings = descriptors.featureSettings || 'normal';
      this.status = 'unloaded';
    }
    load() { this.status = 'loaded'; return Promise.resolve(this); }
  };
  globalThis.FontFaceSet = class FontFaceSet extends EventTarget {
    constructor() { super(); this.status = 'loaded'; this.ready = Promise.resolve(this); }
    add() { return this; }
    check() { return true; }
    clear() {}
    delete() { return false; }
    load() { return Promise.resolve([]); }
    forEach() {}
    has() { return false; }
    [Symbol.iterator]() { return [][Symbol.iterator](); }
  };
  Object.defineProperty(Document.prototype, 'fonts', {
    get() {
      if (!this._fonts) this._fonts = new FontFaceSet();
      return this._fonts;
    },
    configurable: true
  });
}

if (typeof SharedWorker === 'undefined') {
  // A SharedWorker that actually runs its script and drives the connect/port
  // protocol. Fingerprinters (CreepJS getSharedWorker) post the same fingerprint
  // script and await the worker's port message; a dead stub left that Promise
  // pending forever (the whole FP hash stayed "Computing"). Back it with a real
  // dedicated Worker execution, then fire the script's `onconnect` with a
  // MessagePort that routes the worker's postMessage back to the page-side port.
  globalThis.SharedWorker = class SharedWorker {
    constructor(url) {
      var shared = this; this.onerror = null;
      var pageListeners = []; var workerPortOnMsg = null;
      this.port = {
        onmessage: null, start: function(){}, close: function(){ shared._closed = true; },
        postMessage: function(m){ if (typeof workerPortOnMsg === 'function') setTimeout(function(){ try{ workerPortOnMsg({ data: m }); }catch(e){} }, 0); },
        addEventListener: function(t, fn){ if (t === 'message' && typeof fn === 'function') pageListeners.push(fn); },
        removeEventListener: function(){},
      };
      function deliverToPage(data){ var e = { data: data }; if (typeof shared.port.onmessage === 'function'){ try{ shared.port.onmessage(e); }catch(x){} } pageListeners.forEach(function(fn){ try{ fn(e); }catch(x){} }); }
      var w = new Worker(url);
      var tries = 0;
      function fireConnect(){
        if (shared._closed) return;
        var scope = w._scope;
        if (!scope) { if (tries++ < 100) setTimeout(fireConnect, 10); return; }
        if (shared._connected) return; shared._connected = true;
        var workerPort = {
          start: function(){}, close: function(){},
          postMessage: function(m){ deliverToPage(m); },
          addEventListener: function(t, fn){ if (t === 'message') workerPortOnMsg = fn; },
          removeEventListener: function(){},
        };
        Object.defineProperty(workerPort, 'onmessage', { get: function(){ return workerPortOnMsg; }, set: function(fn){ workerPortOnMsg = fn; }, configurable: true, enumerable: true });
        var ev = { ports: [workerPort], source: workerPort, data: '' };
        try {
          if (typeof scope.onconnect === 'function') scope.onconnect(ev);
          var cl = (scope._ev && scope._ev['connect']) || [];
          cl.forEach(function(fn){ try{ fn(ev); }catch(x){} });
        } catch(e){}
      }
      // Ensure the worker's top-level code has run (blob auto-runs on a tick),
      // then drive the connect handshake.
      setTimeout(function(){ if (w._ensureRun) w._ensureRun(); fireConnect(); }, 0);
    }
  };
}
if (typeof ServiceWorkerContainer === 'undefined') {
  globalThis.ServiceWorkerContainer = class { register(){return Promise.resolve();} getRegistrations(){return Promise.resolve([]);} };
}

if (typeof URLPattern === 'undefined') {
  globalThis.URLPattern = class URLPattern {
    constructor(pattern){this._pattern=pattern||{};} test(){return false;} exec(){return null;}
  };
}

if (typeof Document !== 'undefined' && !Document.prototype.importNode) {
  Document.prototype.importNode = function(node, deep) { return node?.cloneNode(!!deep) || null; };
}

// Document.adoptNode: standard DOM (HTML living spec). Frameworks that move
// nodes between documents (portals, iframe hand-off) call it; the missing
// method throws "adoptNode is not a function". With no second document to
// transfer ownership from, the node is already ours, so return it as-is,
// matching the observable effect of adoption into this document.
if (typeof Document !== 'undefined' && !Document.prototype.adoptNode) {
  Document.prototype.adoptNode = function(node) { return node || null; };
}

// Element.toggleAttribute: standard DOM. Lit/Stencil and several ad SDKs call
// it; the missing method throws. Spec semantics: no force arg toggles, force
// true adds, force false removes; returns the new presence.
if (typeof Element !== 'undefined' && !Element.prototype.toggleAttribute) {
  Element.prototype.toggleAttribute = function(name, force) {
    const n = String(name);
    const present = this.hasAttribute(n);
    const want = arguments.length < 2 ? !present : !!force;
    if (want && !present) { this.setAttribute(n, ''); return true; }
    if (!want && present) { this.removeAttribute(n); return false; }
    return want;
  };
}

// Document.elementFromPoint / elementsFromPoint — no layout engine, so this is a stub:
// in-viewport coords return <body> (or <html> as fallback), out-of-viewport returns null.
// Wrong-but-non-throwing beats "undefined", which traps ad/analytics bootstraps in retry loops
// (see issue #63).
if (typeof Document !== 'undefined' && !Document.prototype.elementFromPoint) {
  // Real hit testing against the synthetic bboxes from getBoundingClientRect.
  // Flat iteration over every element, NOT a tree walk: our synthetic rects
  // don't form a proper containment hierarchy (a child's rect can lie far
  // outside its parent's), so a tree walk that only descends into ancestors
  // containing (x,y) would never reach a deep <input> inside <label><p>.
  // Returns the deepest matching element (highest nid wins as a proxy for
  // tree depth) so descendants beat ancestors.
  Document.prototype.elementFromPoint = function(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) {
      return null;
    }
    var w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    var h = (typeof window !== 'undefined' && window.innerHeight) || 720;
    if (x < 0 || y < 0 || x > w || y > h) return null;
    var all = this.querySelectorAll('*');
    var best = null;
    var bestNid = -1;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || !el.getBoundingClientRect) continue;
      // documentElement / body span the viewport; skip them so we pick a
      // real descendant instead of falling back to <html>/<body>.
      if (el === this.documentElement || el === this.body) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        var nid = el._nid | 0;
        if (nid > bestNid) { best = el; bestNid = nid; }
      }
    }
    return best || this.body || this.documentElement || null;
  };
  Document.prototype.elementsFromPoint = function(x, y) {
    var el = this.elementFromPoint(x, y);
    return el ? [el] : [];
  };
}
if (typeof ShadowRoot !== 'undefined' && !ShadowRoot.prototype.elementFromPoint) {
  ShadowRoot.prototype.elementFromPoint = function(x, y) {
    return Document.prototype.elementFromPoint.call(globalThis.document || this, x, y);
  };
  ShadowRoot.prototype.elementsFromPoint = function(x, y) {
    return Document.prototype.elementsFromPoint.call(globalThis.document || this, x, y);
  };
}


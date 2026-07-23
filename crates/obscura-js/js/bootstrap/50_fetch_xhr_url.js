function _base64ToUint8Array(b64) {
  const clean = String(b64 || '').replace(/[\r\n\s]/g, '');
  if (!clean) return new Uint8Array();
  const T = _B64_DECODE_TABLE;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array((clean.length * 3 >> 2) - padding);
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    // charCodeAt avoids the per-char substring alloc; T[code] replaces the
    // O(64) indexOf scan. Out-of-range (NaN or code >= 128) folds to -1, and
    // `=== 61` is `=== '='`, so results match the old code exactly.
    const ca = clean.charCodeAt(i);     const a = ca < 128 ? T[ca] : -1;
    const cb = clean.charCodeAt(i + 1); const b = cb < 128 ? T[cb] : -1;
    const cc = clean.charCodeAt(i + 2); const c = cc === 61 ? 0 : (cc < 128 ? T[cc] : -1);
    const cd = clean.charCodeAt(i + 3); const d = cd === 61 ? 0 : (cd < 128 ? T[cd] : -1);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < bytes.length) bytes[out++] = (n >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (n >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = n & 0xff;
  }
  return bytes;
}

function _bodyToUint8Array(body) {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  // obscura's Blob materializes its data into _bytes in the constructor.
  if (body._bytes instanceof Uint8Array) return body._bytes;
  return new TextEncoder().encode(String(body));
}

function _arrayBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function _installWasmStreamingFallback() {
  if (typeof WebAssembly === 'undefined') return;
  if (WebAssembly.instantiateStreaming && WebAssembly.instantiateStreaming.__obscuraFallback) return;
  const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
  const fallback = async function instantiateStreaming(source, imports) {
    const response = await source;
    if (response && typeof response.arrayBuffer === 'function') {
      return WebAssembly.instantiate(await response.arrayBuffer(), imports);
    }
    if (typeof nativeInstantiateStreaming === 'function') {
      return nativeInstantiateStreaming.call(WebAssembly, response, imports);
    }
    return WebAssembly.instantiate(response, imports);
  };
  fallback.__obscuraFallback = true;
  WebAssembly.instantiateStreaming = fallback;
}
_installWasmStreamingFallback();

// Serialize a FormData into a multipart/form-data body the way a browser does
// when it is passed as fetch()/XHR body. The previous shim did String(body),
// so a FormData became the literal "[object Object]" and the multipart payload
// (with its boundary) was lost; servers replied "Invalid boundary for
// multipart/form-data" (e.g. the AWS WAF challenge /mp_verify POST).
function _formDataToMultipart(fd) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let bnd = '----WebKitFormBoundary';
  for (let i = 0; i < 16; i++) bnd += chars[Math.floor(Math.random() * chars.length)];
  let out = '';
  const entries = fd._d || [];
  for (let i = 0; i < entries.length; i++) {
    const k = entries[i][0], v = entries[i][1];
    out += '--' + bnd + '\r\n';
    if (v != null && typeof v === 'object' && v._bytes != null) {
      out += 'Content-Disposition: form-data; name="' + k + '"; filename="' + (v.name || 'blob') + '"\r\n';
      out += 'Content-Type: ' + (v.type || 'application/octet-stream') + '\r\n\r\n';
      try { out += new TextDecoder().decode(v._bytes); } catch (e) {}
      out += '\r\n';
    } else {
      out += 'Content-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(v) + '\r\n';
    }
  }
  out += '--' + bnd + '--\r\n';
  return { boundary: bnd, body: out };
}

// Coerce a fetch()/XHR body into the string op_fetch_url expects, attaching a
// Content-Type header for body types that need one (FormData, URLSearchParams).
function _serializeBody(initBody, headers) {
  if (initBody == null || initBody === '') return '';
  if (initBody instanceof FormData) {
    const mp = _formDataToMultipart(initBody);
    headers['Content-Type'] = 'multipart/form-data; boundary=' + mp.boundary;
    return mp.body;
  }
  if (initBody instanceof URLSearchParams) {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    return initBody.toString();
  }
  if (typeof Blob !== 'undefined' && initBody instanceof Blob) {
    if (initBody.type && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = initBody.type;
    }
    return _bytesToBinaryString(_bodyToUint8Array(initBody));
  }
  if (typeof ArrayBuffer !== 'undefined' && initBody instanceof ArrayBuffer) {
    const bytes = new Uint8Array(initBody);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(initBody) && initBody.buffer instanceof ArrayBuffer) {
    const bytes = new Uint8Array(initBody.buffer, initBody.byteOffset, initBody.byteLength);
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  return typeof initBody === 'string' ? initBody : String(initBody);
}

globalThis.fetch = async (input, init = {}) => {
  let url = typeof input === "string"
    ? input
    : (input instanceof Request
      ? input.url
      : ((typeof URL === 'function' && input instanceof URL) ? input.href : (input?.url || input?.href || String(input || ""))));
  if (url && !url.includes('://')) {
    try {
      const base = _domParse("document_url") || "about:blank";
      url = new URL(url, base).href;
    } catch(e) { /* keep as-is if URL resolution fails */ }
  }
  const method = init.method || (input instanceof Request ? input.method : "GET");
  let _h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers || {});
  const body = _serializeBody(init.body, _h);
  const hdrs = JSON.stringify(_h);
  const fetchMode = init.mode || (input instanceof Request ? input.mode : "cors");
  const pageOrigin = (function() { try { const u = new URL(_domParse("document_url") || "about:blank"); return u.origin; } catch(e) { return ""; } })();
  const raw = await __obscura_core.ops.op_fetch_url(url, method, hdrs, body, pageOrigin, fetchMode);
  const parsed = JSON.parse(raw);
  if (parsed.blocked) {
    const err = new TypeError('net::ERR_FAILED');
    err.name = 'AbortError';
    err.__aborted = true;
    throw err;
  }
  if (parsed.corsBlocked) {
    throw new TypeError('Failed to fetch: ' + (parsed.corsError || 'CORS error'));
  }
  const respType = parsed.status === 0 ? "opaque" : (fetchMode === "no-cors" ? "opaque" : "basic");
  const responseBody = parsed.bodyBase64 ? _base64ToUint8Array(parsed.bodyBase64) : (parsed.body || "");
  const response = new Response(responseBody, {
    status: parsed.status,
    statusText: "",
    headers: parsed.headers || {},
    type: respType,
    url: parsed.url || url,
    redirected: false,
  });
  if (parsed.requestId) {
    Object.defineProperty(response, "__obscuraRequestId", {
      value: parsed.requestId,
      configurable: true,
    });
  }
  return response;
};

if (typeof Headers === "undefined") {
  globalThis.Headers = class Headers {
    constructor(init={}) { this._h={}; if(init) { if(init instanceof Headers) { init.forEach((v,k)=>{this._h[k]=v;}); } else if(typeof init==="object") { for(const[k,v]of Object.entries(init)) this._h[k.toLowerCase()]=String(v); } } }
    get(n) { return this._h[n.toLowerCase()]??null; } set(n,v) { this._h[n.toLowerCase()]=String(v); }
    has(n) { return n.toLowerCase() in this._h; } delete(n) { delete this._h[n.toLowerCase()]; }
    append(n,v) { this._h[n.toLowerCase()]=String(v); }
    forEach(cb) { for(const[k,v] of Object.entries(this._h)) cb(v,k,this); }
    entries() { return Object.entries(this._h)[Symbol.iterator](); }
    keys() { return Object.keys(this._h)[Symbol.iterator](); }
    values() { return Object.values(this._h)[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
  };
}

// XMLHttpRequestEventTarget — spec-required ancestor for XHR EventTarget methods.
// zone.js prefers to walk XMLHttpRequestEventTarget.prototype for addEventListener/
// removeEventListener/dispatchEvent descriptors before falling back to XHR.prototype.
class XMLHttpRequestEventTarget {
  addEventListener(type, handler) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    if (this._listeners && this._listeners[type]) {
      this._listeners[type] = this._listeners[type].filter(h => h !== handler);
    }
  }
  dispatchEvent(event) {
    if (!event || !event.type) return false;
    const ev = (typeof event === 'object') ? event : { type: event };
    ev.target = ev.target || this;
    ev.currentTarget = ev.currentTarget || this;
    const type = ev.type;
    const handlers = (this._listeners && this._listeners[type]) || [];
    for (const h of handlers) { try { h.call(this, ev); } catch (e) {} }
    const prop = 'on' + type;
    if (typeof this[prop] === 'function') {
      try { this[prop](ev); } catch (e) {}
    }
    return true;
  }
}
globalThis.XMLHttpRequestEventTarget = XMLHttpRequestEventTarget;
_markNative(XMLHttpRequestEventTarget);
_markNative(XMLHttpRequestEventTarget.prototype.addEventListener);
_markNative(XMLHttpRequestEventTarget.prototype.removeEventListener);
_markNative(XMLHttpRequestEventTarget.prototype.dispatchEvent);

globalThis.XMLHttpRequest = class XMLHttpRequest extends XMLHttpRequestEventTarget {
  static UNSENT = 0;
  static OPENED = 1;
  static HEADERS_RECEIVED = 2;
  static LOADING = 3;
  static DONE = 4;
  UNSENT = 0; OPENED = 1; HEADERS_RECEIVED = 2; LOADING = 3; DONE = 4;

  constructor() {
    super();
    this.readyState = 0;
    this.status = 0;
    this.statusText = "";
    this.responseText = "";
    this.responseXML = null;
    this.responseURL = "";
    this.responseType = "";
    this.response = null;
    this.timeout = 0;
    this.withCredentials = false;
    this.upload = { addEventListener(){}, removeEventListener(){} };
    this._method = "GET";
    this._url = "";
    this._headers = {};
    this._responseHeaders = {};
    this._aborted = false;
    this._listeners = {};
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
    this.onprogress = null;
    this.ontimeout = null;
    this.onloadstart = null;
    this.onloadend = null;
  }

  open(method, url, async_) {
    this._method = method;
    this._url = url;
    this._headers = {};
    this._responseHeaders = {};
    this._aborted = false;
    this.status = 0;
    this.statusText = "";
    this.responseText = "";
    this.response = null;
    this._setReadyState(1);
  }

  setRequestHeader(name, value) {
    this._headers[name] = value;
  }

  getResponseHeader(name) {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(this._responseHeaders)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  getAllResponseHeaders() {
    return Object.entries(this._responseHeaders)
      .map(([k, v]) => k + ': ' + v)
      .join('\r\n');
  }

  overrideMimeType(mime) { this._overrideMime = mime; }

  send(body) {
    if (this.readyState !== 1) return;
    if (this._aborted) return;

    const xhr = this;
    this._fireEvent('loadstart');

    let url = this._url;
    if (url && !url.includes('://')) {
      try {
        const base = _domParse("document_url") || "about:blank";
        url = new URL(url, base).href;
      } catch(e) {}
    }

    fetch(url, {
      method: this._method,
      headers: this._headers,
      body: body || undefined,
      mode: 'cors',
    }).then(async (resp) => {
      if (xhr._aborted) return;

      xhr.status = resp.status;
      xhr.statusText = resp.statusText || '';
      xhr.responseURL = resp.url || url;

      if (resp.headers) {
        resp.headers.forEach((v, k) => { xhr._responseHeaders[k] = v; });
      }

      xhr._setReadyState(2); // HEADERS_RECEIVED

      const text = await resp.text();
      if (xhr._aborted) return;

      xhr.responseText = text;
      xhr._setReadyState(3); // LOADING

      switch (xhr.responseType) {
        case 'json':
          try { xhr.response = JSON.parse(text); } catch(e) { xhr.response = null; }
          break;
        case 'text':
        case '':
          xhr.response = text;
          break;
        case 'arraybuffer':
          xhr.response = new TextEncoder().encode(text).buffer;
          break;
        case 'blob':
          xhr.response = new Blob([text]);
          break;
        case 'document':
          xhr.response = text; // simplified
          break;
        default:
          xhr.response = text;
      }

      xhr._setReadyState(4); // DONE
      xhr._fireEvent('load');
      xhr._fireEvent('loadend');
    }).catch((err) => {
      if (xhr._aborted) return;
      xhr.status = 0;
      xhr.readyState = 4;
      xhr._fireEvent('readystatechange');
      if (err && err.__aborted) {
        xhr._aborted = true;
        xhr._fireEvent('abort');
        xhr._fireEvent('loadend');
        if (xhr.onabort) xhr.onabort(err);
      } else {
        xhr._fireEvent('error');
        xhr._fireEvent('loadend');
        if (xhr.onerror) xhr.onerror(err);
      }
    });
  }

  abort() {
    this._aborted = true;
    if (this.readyState > 0 && this.readyState < 4) {
      this._setReadyState(4);
      this._fireEvent('abort');
      this._fireEvent('loadend');
    }
    this.readyState = 0;
  }

  addEventListener(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    if (this._listeners[type]) {
      this._listeners[type] = this._listeners[type].filter(h => h !== handler);
    }
  }

  // Per WHATWG DOM spec — required by zone.js which patches XHR via
  // Object.getOwnPropertyDescriptor on XMLHttpRequestEventTarget.prototype.
  dispatchEvent(event) {
    if (!event || !event.type) return false;
    const ev = (typeof event === 'object') ? event : { type: event };
    ev.target = ev.target || this;
    ev.currentTarget = ev.currentTarget || this;
    const type = ev.type;
    const handlers = (this._listeners && this._listeners[type]) || [];
    for (const h of handlers) { try { h.call(this, ev); } catch (e) {} }
    const prop = 'on' + type;
    if (typeof this[prop] === 'function') {
      try { this[prop](ev); } catch (e) {}
    }
    return true;
  }

  _setReadyState(state) {
    this.readyState = state;
    this._fireEvent('readystatechange');
    if (this.onreadystatechange) {
      try { this.onreadystatechange(); } catch(e) {}
    }
  }

  _fireEvent(type) {
    const event = { type, target: this, currentTarget: this, bubbles: false };
    const handlers = this._listeners[type] || [];
    for (const h of handlers) { try { h.call(this, event); } catch(e) {} }
    const prop = 'on' + type;
    if (type !== 'readystatechange' && typeof this[prop] === 'function') {
      try { this[prop](event); } catch(e) {}
    }
  }
};
_markNative(XMLHttpRequest);
_markNative(XMLHttpRequest.prototype.open);
_markNative(XMLHttpRequest.prototype.send);
_markNative(XMLHttpRequest.prototype.abort);
_markNative(XMLHttpRequest.prototype.setRequestHeader);
_markNative(XMLHttpRequest.prototype.addEventListener);
_markNative(XMLHttpRequest.prototype.removeEventListener);
_markNative(XMLHttpRequest.prototype.dispatchEvent);
_markNative(XMLHttpRequest.prototype.getResponseHeader);
_markNative(XMLHttpRequest.prototype.getAllResponseHeaders);

// WHATWG URL parsing/serialization is delegated to the Rust `url` crate via
// op_url_parse / op_url_set. The op returns the full component set as JSON; the
// constructor caches it so getters are plain field reads (no per-access op) and
// the hot paths (navigation, fetch, _resolveUrl) stay cheap. Returns null when
// the input is not a valid URL.
function _urlParseOp(url, base) {
  try {
    const s = __obscura_core.ops.op_url_parse(String(url), (base === undefined || base === null) ? "" : String(base));
    const c = JSON.parse(s);
    return (c && c.ok) ? c : null;
  } catch (e) { return null; }
}
function _urlSetOp(href, part, value) {
  try {
    const s = __obscura_core.ops.op_url_set(String(href), part, String(value));
    const c = JSON.parse(s);
    return (c && c.ok) ? c : null;
  } catch (e) { return null; }
}
// Returns just the resolved absolute URL string (no component JSON), or null on
// failure. Cheaper than _urlParseOp for callers that only need the href.
function _urlResolveOp(href, base) {
  try {
    const r = __obscura_core.ops.op_url_resolve(String(href), (base === undefined || base === null) ? "" : String(base));
    return r ? r : null;
  } catch (e) { return null; }
}
if (typeof URL === 'undefined' || !URL.prototype || !URL.__obscura) {
  const _URL = class URL {
    constructor(url, base) {
      const c = _urlParseOp(url, base);
      if (!c) throw new TypeError("Failed to construct 'URL': Invalid URL");
      this._c = c;
      this._sp = null;
    }
    get href() { return this._c.href; }
    set href(v) { const c = _urlParseOp(v, undefined); if (!c) throw new TypeError("Failed to set the 'href' property on 'URL': Invalid URL"); this._c = c; this._refreshSP(); }
    get protocol() { return this._c.protocol; }
    set protocol(v) { this._set('protocol', v); }
    get username() { return this._c.username; }
    set username(v) { this._set('username', v); }
    get password() { return this._c.password; }
    set password(v) { this._set('password', v); }
    get host() { return this._c.host; }
    set host(v) { this._set('host', v); }
    get hostname() { return this._c.hostname; }
    set hostname(v) { this._set('hostname', v); }
    get port() { return this._c.port; }
    set port(v) { this._set('port', v); }
    get pathname() { return this._c.pathname; }
    set pathname(v) { this._set('pathname', v); }
    get search() { return this._c.search; }
    set search(v) { this._set('search', v); this._refreshSP(); }
    get hash() { return this._c.hash; }
    set hash(v) { this._set('hash', v); }
    get origin() { return this._c.origin; }
    get searchParams() {
      if (!this._sp) { this._sp = new URLSearchParams(this._c.search); this._sp._url = this; }
      return this._sp;
    }
    _set(part, value) { const c = _urlSetOp(this._c.href, part, value); if (c) this._c = c; }
    // search changed on the URL side: refresh the bound searchParams contents.
    _refreshSP() { if (this._sp && this._sp._setFromString) this._sp._setFromString(this._c.search); }
    // searchParams mutated: write the serialized query back without re-refreshing.
    _updateSearch(qs) { this._set('search', qs ? ('?' + qs) : ''); }
    toString() { return this._c.href; }
    toJSON() { return this._c.href; }
    static createObjectURL() { return 'blob:null/fake-' + Math.random().toString(36).slice(2); }
    static revokeObjectURL() {}
    // WHATWG URL.parse: like the constructor but returns null instead of throwing.
    static parse(url, base) { const c = _urlParseOp(url, base); if (!c) return null; const u = Object.create(_URL.prototype); u._c = c; u._sp = null; return u; }
    static canParse(url, base) { return _urlParseOp(url, base) !== null; }
  };
  _URL.__obscura = true;
  globalThis.URL = _URL;
}

globalThis.requestIdleCallback = globalThis.requestIdleCallback || function requestIdleCallback(cb, opts) {
  const start = Date.now();
  return setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining() { return Math.max(0, 50 - (Date.now() - start)); },
    });
  }, 1);
};
globalThis.cancelIdleCallback = globalThis.cancelIdleCallback || function cancelIdleCallback(id) { clearTimeout(id); };
_markNative(globalThis.requestIdleCallback);
_markNative(globalThis.cancelIdleCallback);

if (typeof Request === 'undefined') {
  globalThis.Request = class Request {
    constructor(input, init = {}) {
      if (typeof input === 'string') { this.url = input; }
      else if (input instanceof Request) { this.url = input.url; init = { ...input, ...init }; }
      else if (typeof URL === 'function' && input instanceof URL) { this.url = input.href; }
      else { this.url = input?.url || input?.href || String(input); }
      this.method = (init.method || 'GET').toUpperCase();
      this.headers = new Headers(init.headers);
      this.body = init.body || null;
      this.mode = init.mode || 'cors';
      this.credentials = init.credentials || 'same-origin';
      this.redirect = init.redirect || 'follow';
      this.referrer = init.referrer || '';
      this.signal = init.signal || { aborted: false, addEventListener(){}, removeEventListener(){} };
      this.cache = init.cache || 'default';
    }
    clone() { return new Request(this.url, { method: this.method, headers: this.headers, body: this.body }); }
    async text() { return this.body ? String(this.body) : ''; }
    async json() { return JSON.parse(await this.text()); }
    async arrayBuffer() { return new TextEncoder().encode(await this.text()).buffer; }
    async blob() {
      const ct = this.headers && this.headers.get ? (this.headers.get('content-type') || '') : '';
      return new Blob(this.body != null ? [this.body] : [], { type: ct });
    }
  };
}

// Decode a response body honoring the Content-Type charset, so fetch()/XHR
// over non-UTF-8 resources (GBK, Shift_JIS, ISO-8859-x, ...) return correctly
// decoded text instead of mojibake. The UTF-8 case (the overwhelming majority)
// takes the plain TextDecoder fast path; only an explicit non-UTF-8 charset
// routes through TextDecoder(label), which falls back to UTF-8 on a bad label.
function _decodeBodyWithCharset(bytes, headers) {
  let label = '';
  try {
    const ct = headers && typeof headers.get === 'function' ? (headers.get('content-type') || '') : '';
    const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct);
    if (m) label = m[1].trim();
  } catch (e) {}
  if (!label || /^utf-?8$/i.test(label)) return new TextDecoder().decode(bytes);
  try { return new TextDecoder(label).decode(bytes); }
  catch (e) { return new TextDecoder().decode(bytes); }
}

if (typeof Response === 'undefined') {
  globalThis.Response = class Response {
    constructor(body, init = {}) {
      this._bodyBytes = _bodyToUint8Array(body); this.status = init.status || 200; this.statusText = init.statusText || '';
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new Headers(init.headers);
      this.type = init.type || 'basic'; this.url = init.url || ''; this.redirected = !!init.redirected;
    }
    async text() { return _decodeBodyWithCharset(this._bodyBytes, this.headers); }
    async json() { return JSON.parse(await this.text()); }
    async arrayBuffer() { return _arrayBufferFromBytes(this._bodyBytes); }
    async blob() { return new Blob([this._bodyBytes]); }
    clone() { return new Response(this._bodyBytes, { status: this.status, statusText: this.statusText, headers: this.headers, type: this.type, url: this.url, redirected: this.redirected }); }
    static error() { return new Response(null, { status: 0 }); }
    static redirect(url, status) { return new Response(null, { status: status || 302, headers: { Location: url } }); }
    static json(data, init) { return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }); }
  };
}

if (!Element.prototype.replaceWith) {
  Element.prototype.replaceWith = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const n of nodes) {
      if (typeof n === 'string') parent.insertBefore(document.createTextNode(n), this);
      else parent.insertBefore(n, this);
    }
    parent.removeChild(this);
  };
  _markNative(Element.prototype.replaceWith);
}
if (!Element.prototype.before) {
  Element.prototype.before = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const n of nodes) {
      if (typeof n === 'string') parent.insertBefore(document.createTextNode(n), this);
      else parent.insertBefore(n, this);
    }
  };
  _markNative(Element.prototype.before);
}
if (!Element.prototype.after) {
  Element.prototype.after = function(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const ref = this.nextSibling;
    for (const n of nodes) {
      if (typeof n === 'string') parent.insertBefore(document.createTextNode(n), ref);
      else parent.insertBefore(n, ref);
    }
  };
  _markNative(Element.prototype.after);
}

// ChildNode mixin: also mix before/after/replaceWith/remove into
// CharacterData.prototype (covers Text, Comment, ProcessingInstruction).
// These are the same implementations as Element.prototype — frameworks
// (Svelte 5, Vue, Lit) anchor on Comment/Text nodes and call these methods.
if (!CharacterData.prototype.before) CharacterData.prototype.before = Element.prototype.before;
if (!CharacterData.prototype.after) CharacterData.prototype.after = Element.prototype.after;
if (!CharacterData.prototype.replaceWith) CharacterData.prototype.replaceWith = Element.prototype.replaceWith;
if (!CharacterData.prototype.remove) CharacterData.prototype.remove = Element.prototype.remove;

if (!('isConnected' in Node.prototype)) {
  Object.defineProperty(Node.prototype, 'isConnected', {
    get() {
      let node = this;
      while (node) {
        if (node.nodeType === 9) return true; // Document node
        node = node.parentNode;
      }
      return false;
    }
  });
}

globalThis.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    this._callback = callback;
    this._targets = new Set();
    this._connected = true;
    this._fireCount = 0;
  }
  _fireFor(targets) {
    if (!this._connected || !targets.length) return;
    const records = targets.map(target => {
      const r = target.getBoundingClientRect ? target.getBoundingClientRect() : { x: 0, y: 0, width: 100, height: 20 };
      return {
        target,
        contentRect: { x: r.x || 0, y: r.y || 0, width: r.width || 100, height: r.height || 20, top: r.top || 0, left: r.left || 0, bottom: r.bottom || 20, right: r.right || 100 },
        borderBoxSize: [{ blockSize: r.height || 20, inlineSize: r.width || 100 }],
        contentBoxSize: [{ blockSize: r.height || 20, inlineSize: r.width || 100 }],
        devicePixelContentBoxSize: [{ blockSize: r.height || 20, inlineSize: r.width || 100 }],
      };
    });
    try { this._callback(records, this); } catch (e) { /* RO callbacks must not propagate */ }
  }
  observe(el) {
    if (!el || !this._connected) return;
    if (this._targets.has(el)) return;
    this._targets.add(el);
    Promise.resolve().then(() => this._fireFor([el]));
    [200, 800].forEach(delay => {
      setTimeout(() => {
        if (this._connected && this._targets.has(el) && this._fireCount < 16) {
          this._fireCount++;
          this._fireFor([el]);
        }
      }, delay);
    });
  }
  unobserve(el) { this._targets.delete(el); }
  disconnect() { this._connected = false; this._targets.clear(); }
};

if (typeof TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(str) {
      str = String(str);
      const buf = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 0x80) buf.push(c);
        else if (c < 0x800) { buf.push(0xC0|(c>>6), 0x80|(c&0x3F)); }
        else if (c < 0xD800 || c >= 0xE000) { buf.push(0xE0|(c>>12), 0x80|((c>>6)&0x3F), 0x80|(c&0x3F)); }
        else { c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF)); buf.push(0xF0|(c>>18), 0x80|((c>>12)&0x3F), 0x80|((c>>6)&0x3F), 0x80|(c&0x3F)); }
      }
      return new Uint8Array(buf);
    }
    encodeInto(str, dest) { const enc = this.encode(str); dest.set(enc.slice(0, dest.length)); return { read: str.length, written: Math.min(enc.length, dest.length) }; }
  };
}
// Fast pure-JS UTF-8 decode (the common case: Response/Blob .text(), most
// pages). Avoids the op + JSON round trip for plain UTF-8.
function _utf8DecodeBytes(bytes, start) {
  let str = '', i = start | 0;
  const n = bytes.length;
  while (i < n) {
    let c = bytes[i++];
    if (c < 0x80) str += String.fromCharCode(c);
    else if (c < 0xE0) str += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
    else if (c < 0xF0) { const b1 = bytes[i++], b2 = bytes[i++]; str += String.fromCharCode(((c & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F)); }
    else { const b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++]; const cp = ((c & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F); if (cp > 0xFFFF) { const s = cp - 0x10000; str += String.fromCharCode(0xD800 + (s >> 10), 0xDC00 + (s & 0x3FF)); } else str += String.fromCharCode(cp); }
  }
  return str;
}
if (typeof TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    constructor(label, options) {
      // No-arg construction (Response.text()/Blob.text() and most pages) is
      // UTF-8; skip the label-validation op on that hot path.
      let name;
      if (label === undefined) {
        name = 'utf-8';
      } else {
        name = __obscura_core.ops.op_encoding_for_label(String(label));
        if (!name) throw new RangeError("Failed to construct 'TextDecoder': The encoding label provided ('" + label + "') is invalid.");
      }
      const o = options || {};
      Object.defineProperty(this, 'encoding', { value: name, enumerable: true });
      Object.defineProperty(this, 'fatal', { value: !!o.fatal, enumerable: true });
      Object.defineProperty(this, 'ignoreBOM', { value: !!o.ignoreBOM, enumerable: true });
    }
    decode(input, options) {
      if (input === undefined) return '';
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      // Fast path: plain UTF-8, non-fatal (Response/Blob text, most pages).
      if (this.encoding === 'utf-8' && !this.fatal) {
        let off = 0;
        if (!this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) off = 3;
        return _utf8DecodeBytes(bytes, off);
      }
      // Legacy encodings / fatal mode: encoding_rs via the op.
      const r = JSON.parse(__obscura_core.ops.op_text_decode(this.encoding, bytes, this.fatal, this.ignoreBOM));
      if (!r.ok) throw new TypeError("Failed to execute 'decode' on 'TextDecoder': The encoded data was not valid.");
      return r.v;
    }
  };
}

globalThis.matchMedia = _markNative(function matchMedia(q) {
  var s = (q || '').toLowerCase().replace(/\s+/g, '');
  var matches = false;
  if (s.includes('prefers-color-scheme:light')) matches = false;
  else if (s.includes('prefers-color-scheme:dark')) matches = true;
  else if (s.includes('prefers-reduced-motion:no-preference')) matches = true;
  else if (s.includes('prefers-reduced-motion:reduce')) matches = false;
  else if (s.includes('any-pointer:fine')) matches = true;
  else if (s.includes('any-pointer:coarse')) matches = false;
  else if (s.includes('pointer:fine')) matches = true;
  else if (s.includes('hover:hover')) matches = true;
  else if (s.includes('any-hover:hover')) matches = true;
  else if (s.includes('color)') || s === '(color)') matches = true;
  else if (s.includes('min-width')) {
    var m = s.match(/min-width:\s*(\d+)px/);
    matches = m ? (globalThis.innerWidth || 1440) >= parseInt(m[1]) : false;
  }
  else if (s.includes('max-width')) {
    var m2 = s.match(/max-width:\s*(\d+)px/);
    matches = m2 ? (globalThis.innerWidth || 1440) <= parseInt(m2[1]) : false;
  }
  return { matches: matches, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true;} };
});
globalThis.getComputedStyle = (el) => {
  if (!el) el = document.body || {};
  const style = el?.style || el?._style || new CSSStyleDeclaration();
  // React virtualization libraries (react-window, tanstack-virtual,
  // react-virtuoso) all compute container dimensions via getComputedStyle.
  // The defaults table previously returned `auto` for width/height and
  // `'static'` for position, which made every list render 0 items. Pulling
  // width/height from the synthesized bounding rect makes those libraries
  // actually render content.
  const dimensionFor = (name) => {
    try {
      const r = el.getBoundingClientRect && el.getBoundingClientRect();
      if (!r) return null;
      switch (name) {
        case 'width': case 'inline-size':
          return r.width != null ? `${r.width}px` : null;
        case 'height': case 'block-size':
          return r.height != null ? `${r.height}px` : null;
        case 'left': return r.left != null ? `${r.left}px` : null;
        case 'top': return r.top != null ? `${r.top}px` : null;
        case 'right': return r.right != null ? `${r.right}px` : null;
        case 'bottom': return r.bottom != null ? `${r.bottom}px` : null;
        case 'client-width': case 'offset-width':
          return r.width != null ? `${r.width}px` : null;
        case 'client-height': case 'offset-height':
          return r.height != null ? `${r.height}px` : null;
      }
    } catch (e) {}
    return null;
  };

  const defaultsKebab = {
    display: 'block', visibility: 'visible', opacity: '1',
    position: 'static', overflow: 'visible',
    transform: 'none', 'transform-origin': '0px 0px',
    transition: 'none', animation: 'none',
    float: 'none', clear: 'none',
    margin: '0px', padding: '0px',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'font-size': '16px', 'line-height': 'normal', 'font-weight': '400',
    'font-family': 'Times',
    color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)',
    'border-width': '0px', 'border-style': 'none', 'border-color': 'rgb(0, 0, 0)',
    'border-top-width': '0px', 'border-right-width': '0px',
    'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-radius': '0px',
    'z-index': 'auto', 'pointer-events': 'auto',
    'box-sizing': 'content-box', cursor: 'auto',
    'white-space': 'normal', 'text-align': 'start',
    'flex-direction': 'row', 'flex-wrap': 'nowrap', 'align-items': 'normal',
    'justify-content': 'normal', gap: 'normal',
    'grid-template-columns': 'none', 'grid-template-rows': 'none',
    'will-change': 'auto', 'backface-visibility': 'visible',
  };

  const lookup = (rawProp) => {
    if (typeof rawProp !== 'string') return '';
    // Inline value first.
    const inlineVal = target.getPropertyValue ? target.getPropertyValue(rawProp) : '';
    if (inlineVal) return inlineVal;
    const kebab = rawProp.replace(/([A-Z])/g, '-$1').toLowerCase();
    const dim = dimensionFor(kebab);
    if (dim != null) return dim;
    if (defaultsKebab[rawProp]) return defaultsKebab[rawProp];
    if (defaultsKebab[kebab]) return defaultsKebab[kebab];
    return '';
  };

  const target = style;
  return new Proxy(style, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
      if (prop in target) return target[prop];
      if (prop === 'getPropertyValue') return (name) => lookup(name);
      if (prop === 'getPropertyPriority') return () => '';
      if (prop === 'item') return (i) => '';
      if (prop === 'length') return 0;
      if (prop === 'cssText') return '';
      if (prop === 'parentRule') return null;
      if (typeof prop === 'string') return lookup(prop);
      return undefined;
    },
  });
};
// Returns the one Selection instance for a document (cached on the document),
// so window.getSelection() === document.getSelection(). The real Selection
// class is defined below, after Range. _selectionFor is hoisted.

class _IframeDocument {
  constructor(html, url, iframeEl) {
    this._url = url;
    this._iframeEl = iframeEl;
    this.nodeType = 9;
    this.nodeName = '#document';
    this.readyState = 'complete';
    this.characterSet = 'UTF-8';
    this.contentType = 'text/html';
    this.visibilityState = 'visible';
    this.hidden = false;

    this._root = document.createElement('html');
    this._head = document.createElement('head');
    this._body = document.createElement('body');
    this._root.appendChild(this._head);
    this._root.appendChild(this._body);
    var bodyContent = html
      .replace(/^<!DOCTYPE[^>]*>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '')
      .replace(/^\s+/, ''); // trim leading whitespace (before <body> content)
    if (bodyContent) {
      this._body.innerHTML = bodyContent;
    }

    this._title = '';
    if (this._head) {
      const titleEl = this._head.querySelector('title');
      if (titleEl) this._title = titleEl.textContent;
    }
  }

  get documentElement() { return this._root; }
  get head() { return this._head; }
  get body() { return this._body; }
  get title() { return this._title; }
  set title(v) { this._title = v; }
  get URL() { return this._url; }
  get documentURI() { return this._url; }
  get location() { return this._iframeEl?.contentWindow?.location; }
  get defaultView() { return this._iframeEl?.contentWindow; }
  get ownerDocument() { return null; }
  get compatMode() { return 'CSS1Compat'; }
  get activeElement() { return this._body; }

  getElementById(id) {
    return this._root.querySelector('#' + id);
  }
  querySelector(sel) {
    return this._root.querySelector(sel);
  }
  querySelectorAll(sel) {
    return this._root.querySelectorAll(sel);
  }
  getElementsByTagName(tag) {
    return this._root.querySelectorAll(tag);
  }
  getElementsByClassName(cls) {
    return _getElementsByClassName(this._root, cls);
  }
  createElement(tag) { return document.createElement(tag); }
  createElementNS(ns, tag) { return document.createElementNS(ns, tag); }
  createTextNode(text) { return document.createTextNode(text); }
  createComment(text) { return document.createComment(text); }
  createDocumentFragment() { return document.createDocumentFragment(); }
  createEvent(type) { return document.createEvent(type); }
  createRange() { return new Range(); }
  hasFocus() { return false; }

  get cookie() { return ''; }
  set cookie(v) {}
  get implementation() { return document.implementation; }
  get styleSheets() { return []; }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }

  write(html) {
    if (this._body) this._body.innerHTML += html;
  }
  writeln(html) { this.write(html + '\n'); }
  open() { if (this._body) this._body.innerHTML = ''; }
  close() {}
}

class _IframeWindow {
  constructor(doc, url) {
    this.document = doc;
    this._url = url;
    this.self = this;
    this.top = globalThis;
    this.parent = globalThis;
    this.window = this;
    this.frames = this;
    this.frameElement = null;
    this.length = 0;
    this.name = '';
    this.closed = false;
    this.navigator = globalThis.navigator;
    this.screen = globalThis.screen;
    this.innerWidth = 300;
    this.innerHeight = 150;
    this.outerWidth = 300;
    this.outerHeight = 150;
    this.devicePixelRatio = globalThis.devicePixelRatio;
    this.localStorage = globalThis.localStorage;
    this.sessionStorage = globalThis.sessionStorage;
    this.performance = globalThis.performance;
    this.crypto = globalThis.crypto;
    this.console = globalThis.console;
    this.chrome = globalThis.chrome;

    try {
      const u = new URL(url);
      this.location = {
        href: url, origin: u.origin, protocol: u.protocol,
        host: u.host, hostname: u.hostname, port: u.port,
        pathname: u.pathname, search: u.search, hash: u.hash,
        toString() { return url; }, assign(){}, reload(){}, replace(){},
      };
    } catch(e) {
      this.location = { href: url, origin: '', protocol: '', host: '', hostname: '', port: '', pathname: '/', search: '', hash: '', toString() { return url; }, assign(){}, reload(){}, replace(){} };
    }

    // A same-origin iframe's contentWindow exposes the SAME global surface as
    // the top window (every interface constructor, method, and global). CF's
    // challenge creates a probe iframe and reads pristine natives off its
    // contentWindow; any global obscura defines on the top globalThis but not
    // here came back `undefined` and landed as an UNDEF slot in the challenge
    // VM's register file (crash: "X is not a function"). Mirror the ENTIRE
    // globalThis surface rather than a hand-picked subset. Skip internal
    // (`__obscura*` / numeric) names and the origin-specific properties already
    // set on this instance above (self/window/top/parent/document/location/…).
    for (const k of Object.getOwnPropertyNames(globalThis)) {
      if (k[0] === '_' && k[1] === '_') continue;
      if (/^\d+$/.test(k)) continue;
      if (Object.prototype.hasOwnProperty.call(this, k)) continue;
      try { const v = globalThis[k]; if (v !== undefined) this[k] = v; } catch (e) {}
    }
    // opener is null (not undefined) unless this window was opened via
    // window.open() from a same-origin script, which never applies here.
    this.opener = null;
    this.origin = this.location.origin;
    this.history = this.history || { length: 1, state: null, back(){}, forward(){}, go(){}, pushState(){}, replaceState(){} };
  }

  postMessage(data, origin) {
    const event = new MessageEvent('message', {
      data: data,
      origin: this.location.origin,
      source: this,
    });
    Promise.resolve().then(() => {
      globalThis.dispatchEvent?.(event);
    });
  }

  setTimeout(fn, ms) { return globalThis.setTimeout(fn, ms); }
  clearTimeout(id) { globalThis.clearTimeout(id); }
  setInterval(fn, ms) { return globalThis.setInterval(fn, ms); }
  clearInterval(id) { globalThis.clearInterval(id); }
  requestAnimationFrame(fn) { return globalThis.requestAnimationFrame(fn); }

  addEventListener(type, fn) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners?.[type]) {
      this._listeners[type] = this._listeners[type].filter(h => h !== fn);
    }
  }
  dispatchEvent(event) {
    const handlers = this._listeners?.[event?.type] || [];
    for (const h of handlers) { try { h.call(this, event); } catch(e) {} }
    return true;
  }

  getComputedStyle(el) { return globalThis.getComputedStyle(el); }
  matchMedia(q) { return globalThis.matchMedia(q); }
  getSelection() { return globalThis.getSelection(); }
  fetch(input, init) { return globalThis.fetch(input, init); }
  close() { this.closed = true; }
  focus() {}
  blur() {}
}

// Encode an RGBA pixel buffer into a valid PNG data URL.
// Uses stored-block DEFLATE (no compression) wrapped in zlib.
// This produces a larger file than a real browser but the hash is unique
// per session (from _fpNoise) and valid, so it does not match the known
// headless stub.
function _encodePNG(w, h, rgba) {
  // RGB scanlines: filter byte (0) + 3 bytes per pixel
  var rowLen = 1 + w * 3;
  var raw = new Uint8Array(h * rowLen);
  for (var y = 0; y < h; y++) {
    var base = y * rowLen;
    raw[base] = 0;
    for (var x = 0; x < w; x++) {
      var s = (y * w + x) << 2, d = base + 1 + x * 3;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2];
    }
  }
  // Adler32 of raw
  var s1 = 1, s2 = 0, M = 65521;
  for (var i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]) % M; s2 = (s2 + s1) % M; }
  var adler = ((s2 << 16) | s1) >>> 0;
  // Stored DEFLATE blocks (zlib level 0)
  var MAXB = 65535, nb = Math.ceil(raw.length / MAXB) || 1;
  var dlen = 2 + nb * 5 + raw.length + 4;
  var def = new Uint8Array(dlen), dp = 0;
  def[dp++] = 0x78; def[dp++] = 0x01;
  for (var bi = 0; bi < nb; bi++) {
    var bs = bi * MAXB, be = Math.min(raw.length, bs + MAXB), bl = be - bs;
    def[dp++] = bi === nb-1 ? 1 : 0;
    def[dp++] = bl&0xff; def[dp++] = (bl>>8)&0xff;
    def[dp++] = (~bl)&0xff; def[dp++] = (~bl>>8)&0xff;
    def.set(raw.subarray(bs, be), dp); dp += bl;
  }
  def[dp++]=(adler>>24)&0xff; def[dp++]=(adler>>16)&0xff; def[dp++]=(adler>>8)&0xff; def[dp]=adler&0xff;
  // CRC32 (lazy table)
  if (!_encodePNG._t) {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):(c>>>1); t[n]=c; }
    _encodePNG._t = t;
  }
  var T = _encodePNG._t;
  function crc32(a, st, ln) { var c=0xFFFFFFFF; for(var i=st,e=st+ln;i<e;i++) c=T[(c^a[i])&0xff]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
  function putChunk(out, off, type, data) {
    var dl = data.length;
    out[off]=(dl>>24)&0xff; out[off+1]=(dl>>16)&0xff; out[off+2]=(dl>>8)&0xff; out[off+3]=dl&0xff;
    out[off+4]=type.charCodeAt(0); out[off+5]=type.charCodeAt(1); out[off+6]=type.charCodeAt(2); out[off+7]=type.charCodeAt(3);
    out.set(data, off+8);
    var cr = crc32(out, off+4, 4+dl);
    out[off+8+dl]=(cr>>24)&0xff; out[off+9+dl]=(cr>>16)&0xff; out[off+10+dl]=(cr>>8)&0xff; out[off+11+dl]=cr&0xff;
    return off+12+dl;
  }
  var ihd = new Uint8Array(13);
  ihd[0]=(w>>24)&0xff; ihd[1]=(w>>16)&0xff; ihd[2]=(w>>8)&0xff; ihd[3]=w&0xff;
  ihd[4]=(h>>24)&0xff; ihd[5]=(h>>16)&0xff; ihd[6]=(h>>8)&0xff; ihd[7]=h&0xff;
  ihd[8]=8; ihd[9]=2; // 8-bit RGB
  var png = new Uint8Array(8 + 25 + (12+dlen) + 12);
  png.set([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  var p = 8;
  p = putChunk(png, p, 'IHDR', ihd);
  p = putChunk(png, p, 'IDAT', def);
  putChunk(png, p, 'IEND', new Uint8Array(0));
  // Base64 encode
  var C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var b64 = 'data:image/png;base64,';
  for (var i = 0; i < png.length; i += 3) {
    var a=png[i], b=i+1<png.length?png[i+1]:0, c=i+2<png.length?png[i+2]:0;
    b64 += C[a>>2] + C[((a&3)<<4)|(b>>4)] + (i+1<png.length?C[((b&15)<<2)|(c>>6)]:'=') + (i+2<png.length?C[c&63]:'=');
  }
  return b64;
}

globalThis.__ariaQuerySelector = function(root, selector) { return null; };
globalThis.__ariaQuerySelectorAll = async function*(root, selector) { /* yields nothing */ };

// Stock Windows 10 font family set (lowercased). A font-detection probe
// measures a reference string in "'TestFont', <generic>" and compares the
// width against the plain <generic>: an installed font shifts the metrics, a
// missing one falls back to the generic and matches. measureText/element
// widths that ignore the family therefore make EVERY font look absent, so the
// fingerprint collapses to the hash of an empty set (SHA-256("")) — a blatant
// anti-detect tell. _fontAdvance gives each installed family a distinct,
// deterministic per-character advance while generics and unknown families keep
// the baseline, so a probe recovers a realistic Windows font list.
const _WIN_FONTS = new Set([
  'arial','arial black','bahnschrift','calibri','cambria','cambria math','candara',
  'comic sans ms','consolas','constantia','corbel','courier new','ebrima',
  'franklin gothic medium','gabriola','gadugi','georgia','impact','ink free',
  'javanese text','leelawadee ui','lucida console','lucida sans unicode','ms gothic',
  'mv boli','malgun gothic','marlett','microsoft himalaya','microsoft jhenghei',
  'microsoft new tai lue','microsoft phagspa','microsoft sans serif','microsoft tai le',
  'microsoft yahei','microsoft yi baiti','mingliu-extb','mongolian baiti','myanmar text',
  'nirmala ui','palatino linotype','segoe mdl2 assets','segoe print','segoe script',
  'segoe ui','segoe ui emoji','segoe ui historic','segoe ui symbol','simsun','sitka',
  'sylfaen','symbol','tahoma','times new roman','trebuchet ms','verdana','webdings',
  'wingdings','yu gothic','yu gothic ui','microsoft yahei ui','dubai',
]);
function _canvasPrimaryFont(fontStr) {
  // Grab the first family token from a CSS font shorthand ("italic 72px 'Arial', serif").
  const s = String(fontStr || '');
  const m = s.match(/(?:\d[\d.]*(?:px|pt|em|%)\s+)?(.+)$/);
  let fam = (m ? m[1] : s).split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return fam;
}
function _fontAdvance(fontStr) {
  const fam = _canvasPrimaryFont(fontStr);
  // Generic families and unknown families measure at the baseline advance, so
  // an uninstalled probe font falls back to the generic and reads as absent.
  if (!fam || fam === 'monospace' || fam === 'sans-serif' || fam === 'serif' ||
      fam === 'cursive' || fam === 'fantasy' || fam === 'system-ui' || !_WIN_FONTS.has(fam)) {
    return 6.0;
  }
  // Deterministic per-font advance in ~[5.5, 6.7], stable across runs.
  let h = 0;
  for (let i = 0; i < fam.length; i++) h = (h * 131 + fam.charCodeAt(i)) >>> 0;
  return 5.5 + (h % 1200) / 1000;
}
// Font-detection probes measure a text element after setting an inline
// font-family, reading offsetWidth / getBoundingClientRect().width. Return a
// family-dependent width for exactly that pattern (inline font-family + text)
// so a probe recovers the installed Windows set; null (→ the caller's default)
// for everything else keeps the blast radius off ordinary layout reads.
function _fontProbeWidth(el) {
  try {
    const st = el.style;
    if (!st) return null;
    const gp = st.getPropertyValue ? (p) => st.getPropertyValue(p) : () => '';
    let fam = gp('font-family') || st.fontFamily || '';
    const fontSh = gp('font') || st.font || '';
    if (!fam && fontSh) fam = fontSh;
    if (!fam) return null;
    const txt = el.textContent || '';
    if (!txt) return null;
    const size = parseInt(gp('font-size') || st.fontSize || fontSh) || 16;
    const adv = _fontAdvance(size + 'px ' + fam);
    return { w: Math.round(txt.length * adv * (size / 10)), h: Math.max(1, Math.round(size * 1.15)) };
  } catch (e) { return null; }
}
// Box size for a non-viewport element. There is no layout engine, so an
// element with no measurable text gets a deterministic, per-session,
// SUB-PIXEL box instead of a flat round 100x20 — otherwise every element
// reads identical and the element-geometry fingerprint (iphey's Client Rects
// on #dom-element-geometry-hidden) hashes to a fixed round value catalogued as
// a synthetic/anti-detect signature. Kept below the hit-test grid spacing
// (GX=110, GY=30 in getBoundingClientRect) so cells stay distinct.
function _elemBox(el) {
  const p = _fontProbeWidth(el);
  if (p) return { w: p.w, h: p.h };
  const nid = (el._nid | 0);
  const s = _fpRand((nid * 2654435761) >>> 0);
  const s2 = _fpRand((nid * 40503 + 7) >>> 0);
  return { w: 72 + s * 32, h: 17 + s2 * 8 };
}

class _Canvas2D {
  constructor(canvas) {
    this.canvas = canvas;
    // Honor the width/height IDL property (canvas.width = N) as well as the
    // content attribute — fingerprint tests size the canvas via the property, and
    // reading only the attribute left every such canvas at the 300x150 default
    // (a 16x16 probe encoded a 300x150 PNG → oversized/mismatched → test "error").
    var pw = (typeof canvas.width === 'number' && canvas.width > 0) ? canvas.width : parseInt(canvas.getAttribute('width'));
    var ph = (typeof canvas.height === 'number' && canvas.height > 0) ? canvas.height : parseInt(canvas.getAttribute('height'));
    this._w = pw || 300;
    this._h = ph || 150;
    // An untouched canvas is transparent black in real Chrome — every pixel
    // [0,0,0,0]. The old code pre-filled it with white+noise, so getImageData on
    // a blank canvas returned opaque ~255 pixels (sannysoft TRANSPARENT_PIXEL
    // warn, and a transparent-pixel probe tell). Uint8ClampedArray is already
    // zero-initialized; the canvas fingerprint comes from seeded drawing
    // (fillText/_setPixel using the F1 session seed), not from a noisy blank.
    this._buf = new Uint8ClampedArray(this._w * this._h * 4);
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this._stateStack = [];
  }
  _parseColor(css) {
    if (!css || typeof css !== 'string' || css === 'none') return [0,0,0,0];
    if (css.startsWith('#')) {
      const hex = css.slice(1);
      if (hex.length === 3) return [parseInt(hex[0]+hex[0],16),parseInt(hex[1]+hex[1],16),parseInt(hex[2]+hex[2],16),255];
      if (hex.length === 6) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
      if (hex.length === 8) return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),parseInt(hex.slice(6,8),16)];
    }
    const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1],+m[2],+m[3],m[4]!==undefined?Math.round(+m[4]*255):255];
    const named = {red:[255,0,0,255],green:[0,128,0,255],blue:[0,0,255,255],white:[255,255,255,255],black:[0,0,0,255],yellow:[255,255,0,255],orange:[255,165,0,255],gray:[128,128,128,255],transparent:[0,0,0,0]};
    return named[css] || [0,0,0,255];
  }
  _setPixel(x, y, r, g, b, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= this._w || y < 0 || y >= this._h) return;
    const idx = (y * this._w + x) * 4;
    const alpha = (a / 255) * this.globalAlpha;
    if (this.globalCompositeOperation === 'multiply') {
      this._buf[idx+0] = Math.round((r/255) * (this._buf[idx+0]/255) * 255);
      this._buf[idx+1] = Math.round((g/255) * (this._buf[idx+1]/255) * 255);
      this._buf[idx+2] = Math.round((b/255) * (this._buf[idx+2]/255) * 255);
      this._buf[idx+3] = Math.min(255, this._buf[idx+3] + Math.round(a * alpha));
    } else {
      this._buf[idx+0] = Math.round(r * alpha + this._buf[idx+0] * (1 - alpha));
      this._buf[idx+1] = Math.round(g * alpha + this._buf[idx+1] * (1 - alpha));
      this._buf[idx+2] = Math.round(b * alpha + this._buf[idx+2] * (1 - alpha));
      this._buf[idx+3] = Math.min(255, Math.round(a * alpha + this._buf[idx+3] * (1 - alpha)));
    }
  }
  fillRect(x, y, w, h) {
    const [r,g,b,a] = this._parseColor(this.fillStyle);
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let py = Math.max(0,y); py < Math.min(this._h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(this._w, x+w); px++) {
        this._setPixel(px, py, r, g, b, a);
      }
    }
  }
  clearRect(x, y, w, h) {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let py = Math.max(0,y); py < Math.min(this._h, y+h); py++) {
      for (let px = Math.max(0,x); px < Math.min(this._w, x+w); px++) {
        const idx = (py * this._w + px) * 4;
        this._buf[idx] = this._buf[idx+1] = this._buf[idx+2] = this._buf[idx+3] = 0;
      }
    }
  }
  strokeRect(x, y, w, h) {
    const [r,g,b,a] = this._parseColor(this.strokeStyle);
    const lw = this.lineWidth;
    for (let px = Math.round(x); px < Math.round(x+w); px++) {
      for (let l = 0; l < lw; l++) { this._setPixel(px, Math.round(y)+l, r,g,b,a); this._setPixel(px, Math.round(y+h)-1-l, r,g,b,a); }
    }
    for (let py = Math.round(y); py < Math.round(y+h); py++) {
      for (let l = 0; l < lw; l++) { this._setPixel(Math.round(x)+l, py, r,g,b,a); this._setPixel(Math.round(x+w)-1-l, py, r,g,b,a); }
    }
  }
  fillText(text, x, y) {
    const [r,g,b,a] = this._parseColor(this.fillStyle);
    const fontSize = parseInt(this.font) || 10;
    const scale = Math.max(1, Math.round(fontSize / 10));
    const str = String(text);
    let cx = Math.round(x);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          const on = ((_fpRand(code * 100 + row * 10 + col) > 0.45) &&
                      (row > 0 && row < 6 && col > 0 && col < 4)) ||
                     (_fpRand(code * 200 + row * 7 + col) > 0.7);
          if (on) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                this._setPixel(cx + col*scale + sx, Math.round(y) - 7*scale + row*scale + sy, r, g, b, a);
              }
            }
          }
        }
      }
      cx += 6 * scale;
    }
  }
  strokeText(text, x, y) { this.fillText(text, x, y); }
  measureText(t) {
    const fontSize = parseInt(this.font) || 10;
    const scale = Math.max(1, Math.round(fontSize / 10));
    const adv = _fontAdvance(this.font);
    const width = String(t).length * adv * scale;
    return {
      width,
      actualBoundingBoxAscent: 7 * scale,
      actualBoundingBoxDescent: 2 * scale,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      fontBoundingBoxAscent: Math.round(fontSize * 0.92),
      fontBoundingBoxDescent: Math.round(fontSize * 0.21),
    };
  }
  getImageData(x, y, w, h) {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcX = x + px, srcY = y + py;
        const dstIdx = (py * w + px) * 4;
        if (srcX >= 0 && srcX < this._w && srcY >= 0 && srcY < this._h) {
          const srcIdx = (srcY * this._w + srcX) * 4;
          data[dstIdx] = this._buf[srcIdx];
          data[dstIdx+1] = this._buf[srcIdx+1];
          data[dstIdx+2] = this._buf[srcIdx+2];
          data[dstIdx+3] = this._buf[srcIdx+3];
        }
      }
    }
    return { data, width: w, height: h };
  }
  putImageData(imageData, dx, dy) {
    dx=Math.round(dx); dy=Math.round(dy);
    const {data, width: w, height: h} = imageData;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const srcIdx = (py * w + px) * 4;
        const x = dx + px, y = dy + py;
        if (x >= 0 && x < this._w && y >= 0 && y < this._h) {
          const dstIdx = (y * this._w + x) * 4;
          this._buf[dstIdx] = data[srcIdx];
          this._buf[dstIdx+1] = data[srcIdx+1];
          this._buf[dstIdx+2] = data[srcIdx+2];
          this._buf[dstIdx+3] = data[srcIdx+3];
        }
      }
    }
  }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w*h*4), width: w, height: h }; }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (img && img._ctx && img._ctx._buf) {
      const src = img._ctx;
      dx = dx ?? sx; dy = dy ?? sy; dw = dw ?? (sw ?? src._w); dh = dh ?? (sh ?? src._h);
      for (let py = 0; py < dh; py++) {
        for (let px = 0; px < dw; px++) {
          const srcX = Math.floor((sx||0) + px * (sw||src._w) / dw);
          const srcY = Math.floor((sy||0) + py * (sh||src._h) / dh);
          if (srcX >= 0 && srcX < src._w && srcY >= 0 && srcY < src._h) {
            const srcIdx = (srcY * src._w + srcX) * 4;
            this._setPixel(dx+px, dy+py, src._buf[srcIdx], src._buf[srcIdx+1], src._buf[srcIdx+2], src._buf[srcIdx+3]);
          }
        }
      }
    }
  }
  beginPath() { this._path = []; }
  closePath() {}
  moveTo(x, y) { if (this._path) this._path.push({t:'M',x,y}); }
  lineTo(x, y) { if (this._path) this._path.push({t:'L',x,y}); }
  bezierCurveTo() {} quadraticCurveTo() {}
  arc(x, y, r, s, e) { if (this._path) this._path.push({t:'A',x,y,r}); }
  arcTo() {}
  rect(x, y, w, h) { this.fillRect(x, y, w, h); }
  fill() {
    if (!this._path) return;
    const [r,g,b,a] = this._parseColor(this.fillStyle);
    for (const seg of this._path) {
      if (seg.t === 'A') {
        const cx = Math.round(seg.x), cy = Math.round(seg.y), rad = seg.r;
        const r2 = rad * rad;
        for (let py = Math.max(0, cy - rad); py <= Math.min(this._h - 1, cy + rad); py++) {
          for (let px = Math.max(0, cx - rad); px <= Math.min(this._w - 1, cx + rad); px++) {
            if ((px-cx)*(px-cx) + (py-cy)*(py-cy) <= r2) this._setPixel(px, py, r, g, b, a);
          }
        }
      }
    }
    this._path = [];
  }
  stroke() {}
  clip() {}
  save() { this._stateStack.push({fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, font: this.font, lineWidth: this.lineWidth}); }
  restore() { const s = this._stateStack.pop(); if (s) Object.assign(this, s); }
  translate() {} rotate() {} scale() {}
  setTransform() {} resetTransform() {} transform() {}
  createLinearGradient(x0,y0,x1,y1) { return { addColorStop(){}, _x0:x0,_y0:y0,_x1:x1,_y1:y1 }; }
  createRadialGradient() { return { addColorStop(){} }; }
  createPattern() { return {}; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
  // Line-dash plus a few path/style methods that charting libraries (Highcharts,
  // ECharts) call on every animation frame. A missing setLineDash threw
  // "is not a function" from a timer each tick, spamming errors (#258).
  setLineDash() {}
  getLineDash() { return []; }
  ellipse() {}
  roundRect() {}
  createConicGradient() { return { addColorStop(){} }; }
  getContextAttributes() { return { alpha: true, desynchronized: false, colorSpace: "srgb", willReadFrequently: false }; }
}

// Extensions a real ANGLE/Chrome WebGL1 context advertises (~39). Used by both
// getSupportedExtensions() and getExtension() so they agree; the previous
// 4-item list made obscura's WebGL match no real GPU.
const _WEBGL_EXTENSIONS = [
  'ANGLE_instanced_arrays','EXT_blend_minmax','EXT_clip_control','EXT_color_buffer_half_float',
  'EXT_depth_clamp','EXT_disjoint_timer_query','EXT_float_blend','EXT_frag_depth',
  'EXT_polygon_offset_clamp','EXT_shader_texture_lod','EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc','EXT_texture_filter_anisotropic','EXT_texture_mirror_clamp_to_edge',
  'EXT_sRGB','KHR_parallel_shader_compile','OES_element_index_uint','OES_fbo_render_mipmap',
  'OES_standard_derivatives','OES_texture_float','OES_texture_float_linear','OES_texture_half_float',
  'OES_texture_half_float_linear','OES_vertex_array_object','WEBGL_blend_func_extended',
  'WEBGL_color_buffer_float','WEBGL_compressed_texture_astc','WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_etc1','WEBGL_compressed_texture_pvrtc','WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info','WEBGL_debug_shaders',
  'WEBGL_depth_texture','WEBGL_draw_buffers','WEBGL_lose_context','WEBGL_multi_draw','WEBGL_polygon_mode',
];
Element.prototype.getContext = function getContext(type) {
  if (type === '2d') {
    if (!this._ctx) {
      this._ctx = new _Canvas2D(this);
    }
    return this._ctx;
  }
  if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
    return {
      canvas: this,
      // GL_VENDOR/RENDERER/VERSION/SHADING_LANGUAGE_VERSION must be exposed
      // as properties on the context (not just handled in getParameter) —
      // fingerprint scripts read `gl.getParameter(gl.VERSION)` directly, and
      // a missing constant resolves to `getParameter(undefined)`, which
      // returned the array fallback `[0, 0]` instead of a version string
      // (confirmed live: bot.sannysoft.com/CreepJS-style probes hit this).
      VENDOR: 0x1F00,
      RENDERER: 0x1F01,
      VERSION: 0x1F02,
      SHADING_LANGUAGE_VERSION: 0x8B8C,
      MAX_TEXTURE_SIZE: 0x0D33,
      MAX_VIEWPORT_DIMS: 0x0D3A,
      MAX_RENDERBUFFER_SIZE: 0x84E8,
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84EA,
      MAX_DRAW_BUFFERS_WEBGL: 0x8824,
      getContextAttributes() { return { alpha: true, antialias: true, depth: true, failIfMajorPerformanceCaveat: false, powerPreference: "default", premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: true, desynchronized: false }; },
      uniform2f() {},
      getExtension(name) {
        if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
        if (name === 'WEBGL_lose_context') return { loseContext(){}, restoreContext(){} };
        // A real ANGLE context exposes ~39 extensions; returning null for all but
        // one made obscura's WebGL look like no real GPU (a strong anti-detect
        // tell). Hand back a non-null stub for every extension the enumeration
        // (getSupportedExtensions) advertises so getExtension() agrees.
        if (_WEBGL_EXTENSIONS.indexOf(name) >= 0) return {};
        return null;
      },
      getParameter(pname) {
        if (pname === 0x9245) return _fp('gpuVendor');
        if (pname === 0x9246) return _fp('gpu');
        if (pname === 0x1F01) return 'WebKit WebGL';  // GL_RENDERER
        if (pname === 0x1F00) return 'WebKit';          // GL_VENDOR
        if (pname === 0x1F02) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)'; // GL_VERSION (WebGL1)
        if (pname === 0x8B8C) return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)'; // GL_SHADING_LANGUAGE_VERSION (WebGL1)
        if (pname === undefined) return [0, 0];
        if (pname === 0x0D33) return 16384;     // GL_MAX_TEXTURE_SIZE
        if (pname === 0x0D3A) return new Int32Array([32767, 32767]); // GL_MAX_VIEWPORT_DIMS
        if (pname === 0x851C) return 16384;     // MAX_CUBE_MAP_TEXTURE_SIZE
        if (pname === 0x84E8) return 16384;     // MAX_RENDERBUFFER_SIZE
        if (pname === 0x8869) return 16;        // MAX_VERTEX_ATTRIBS
        if (pname === 0x8DFB) return 4096;      // MAX_VERTEX_UNIFORM_VECTORS
        if (pname === 0x8DFC) return 30;        // MAX_VARYING_VECTORS
        if (pname === 0x8B4C) return 16;        // MAX_VERTEX_TEXTURE_IMAGE_UNITS
        if (pname === 0x8872) return 16;        // MAX_TEXTURE_IMAGE_UNITS
        if (pname === 0x8B4D) return 32;        // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        if (pname === 0x8DFD) return 1024;      // MAX_FRAGMENT_UNIFORM_VECTORS
        if (pname === 0x846E) return new Float32Array([1, 1]);       // ALIASED_LINE_WIDTH_RANGE
        if (pname === 0x846D) return new Float32Array([1, 1024]);    // ALIASED_POINT_SIZE_RANGE
        if (pname === 0x84FF) return 16;        // MAX_TEXTURE_MAX_ANISOTROPY_EXT
        if (pname === 0x0D50) return 4;         // SUBPIXEL_BITS
        if (pname === 0x0D52) return 8;         // RED_BITS
        if (pname === 0x0D53) return 8;         // GREEN_BITS
        if (pname === 0x0D54) return 8;         // BLUE_BITS
        if (pname === 0x0D55) return 8;         // ALPHA_BITS
        if (pname === 0x0D56) return 24;        // DEPTH_BITS
        if (pname === 0x0D57) return 0;         // STENCIL_BITS
        return 0;
      },
      getSupportedExtensions() { return _WEBGL_EXTENSIONS.slice(); },
      getShaderPrecisionFormat(shaderType, precisionType) {
        // Integer precision types report differently from floats on a real GPU
        // (e.g. HIGH_INT => {rangeMin:31,rangeMax:30,precision:0}); returning the
        // float triple for everything is a tell. 0x8DF3/4/5 = LOW/MEDIUM/HIGH_INT.
        if (precisionType === 0x8DF3 || precisionType === 0x8DF4 || precisionType === 0x8DF5) {
          return { rangeMin: 31, rangeMax: 30, precision: 0 };
        }
        return { rangeMin: 127, rangeMax: 127, precision: 23 };
      },
      createBuffer() { return {}; }, createShader() { return {}; }, createProgram() { return {}; },
      shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {},
      getProgramParameter() { return true; }, useProgram() {}, deleteShader() {},
      bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
      drawArrays() {}, drawElements() {}, viewport() {}, clear() {}, clearColor() {},
      enable() {}, disable() {}, blendFunc() {}, depthFunc() {},
      getUniformLocation() { return {}; }, getAttribLocation() { return 0; },
      uniform1f() {}, uniform1i() {}, uniformMatrix4fv() {},
      createTexture() { return {}; }, bindTexture() {}, texImage2D() {}, texParameteri() {},
      activeTexture() {}, pixelStorei() {}, generateMipmap() {},
      createFramebuffer() { return {}; }, bindFramebuffer() {}, framebufferTexture2D() {},
      // Deterministic per-session, NOT Math.random(): a real GPU rasterizes the
      // same scene to identical bytes every read, so a fingerprinter reading
      // twice gets one stable value. Random noise per read is the textbook
      // anti-detect-browser signature (it perturbs the fingerprint each time).
      readPixels(x,y,w,h,f,t,d) { if(d) for(let i=0;i<d.length;i++) d[i]=Math.floor(_fpRand(i * 2654435761 >>> 0) * 256); },
      VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, LINK_STATUS: 0x8B82,
      ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4, FLOAT: 0x1406,
      TRIANGLES: 0x0004, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100,
      TEXTURE_2D: 0x0DE1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    };
  }
  return null;
};
Element.prototype.toDataURL = function(type) {
  if (this._ctx && this._ctx._buf) {
    const ctx = this._ctx;
    return _encodePNG(ctx._w, ctx._h, ctx._buf);
  }
  return _fp('canvasFingerprint');
};
Element.prototype.toBlob = function(cb, type, q) { cb(new Blob([''])); };
// SVG text geometry. A flat 0 made getComputedTextLength() (iphey's "SVG
// Computed Style" probe on an <svg><text>) read 0.0000 — no real browser
// renders text to zero width, so it's an anti-detect tell. Derive a
// font-aware length from the same advance model as canvas/DOM font metrics so
// the value is non-zero, stable, and consistent across surfaces.
function _svgTextMetrics(el) {
  const txt = el.textContent || '';
  const st = el.style;
  const gp = (st && st.getPropertyValue) ? (p) => st.getPropertyValue(p) : () => '';
  const fam = gp('font-family') || (st && st.fontFamily) || (el.getAttribute && el.getAttribute('font-family')) || 'sans-serif';
  const size = parseInt(gp('font-size') || (st && st.fontSize) || (el.getAttribute && el.getAttribute('font-size')) || '') || 16;
  const adv = _fontAdvance(size + 'px ' + fam);
  return { len: txt.length * adv * (size / 10), size };
}
Element.prototype.getBBox = function() {
  const m = _svgTextMetrics(this);
  return { x: 0, y: 0, width: m.len, height: m.len ? Math.round(m.size * 1.15) : 0 };
};
Element.prototype.getComputedTextLength = function() { return _svgTextMetrics(this).len; };
Element.prototype.getExtentOfChar = function(ch) {
  const m = _svgTextMetrics(this);
  const per = (this.textContent || '').length ? m.len / (this.textContent || '').length : 0;
  return { x: 0, y: 0, width: per, height: per ? Math.round(m.size * 1.15) : 0 };
};
Element.prototype.getSubStringLength = function(ch, len) {
  const m = _svgTextMetrics(this);
  const total = (this.textContent || '').length;
  return total ? m.len * (Math.min(len || 0, total) / total) : 0;
};

_markNative(Element.prototype.getContext);
_markNative(Element.prototype.toDataURL);
_markNative(Element.prototype.toBlob);

Element.prototype.attachShadow = function attachShadow(opts) {
  var _mode = opts == null ? undefined : opts.mode;
  if (_mode !== 'open' && _mode !== 'closed') {
    throw new TypeError('Failed to execute attachShadow on Element: the mode value is not a valid ShadowRootMode.');
  }
  var _ln = (this.localName || '').toLowerCase();
  if (!globalThis.__obscura_shadowHostNames.has(_ln) && _ln.indexOf('-') === -1) {
    throw new DOMException('Failed to execute attachShadow on Element: this element does not support attachShadow', 'NotSupportedError');
  }
  if (this._shadowRoot) {
    throw new DOMException('Failed to execute attachShadow on Element: the element already hosts a shadow tree.', 'NotSupportedError');
  }
  const host = this;
  const children = [];
  const shadow = {
    mode: opts.mode,
    host: host,
    get innerHTML() { return children.map(c => c.outerHTML || c.textContent || '').join(''); },
    set innerHTML(v) {
      children.length = 0;
      if (v) {
        const tmp = document.createElement('div');
        tmp.innerHTML = v;
        for (let i = 0; i < tmp.childNodes.length; i++) children.push(tmp.childNodes[i]);
      }
    },
    get childNodes() { return children; },
    get firstChild() { return children[0] || null; },
    get lastChild() { return children[children.length - 1] || null; },
    get firstElementChild() { return children.find(c => c.nodeType === 1) || null; },
    get children() { return children.filter(c => c.nodeType === 1); },
    appendChild(c) {
      if (c) {
        children.push(c);
        try { c.parentNode = shadow; } catch (_) { /* parentNode is getter-only on Node, ignore */ }
      }
      return c;
    },
    insertBefore(n, ref) {
      if (!n) return n;
      if (!ref) { shadow.appendChild(n); return n; }
      const idx = children.indexOf(ref);
      if (idx >= 0) {
        children.splice(idx, 0, n);
        try { n.parentNode = shadow; } catch (_) {}
      }
      else shadow.appendChild(n);
      return n;
    },
    removeChild(c) { const idx = children.indexOf(c); if (idx >= 0) children.splice(idx, 1); return c; },
    replaceChild(n, o) {
      const idx = children.indexOf(o);
      if (idx >= 0) {
        children[idx] = n;
        try { n.parentNode = shadow; } catch (_) {}
      }
      return o;
    },
    querySelector(s) {
      for (const c of children) {
        if (c.matches && c.matches(s)) return c;
        if (c.querySelector) { const r = c.querySelector(s); if (r) return r; }
      }
      return null;
    },
    querySelectorAll(s) {
      const results = [];
      for (const c of children) {
        if (c.matches && c.matches(s)) results.push(c);
        if (c.querySelectorAll) results.push(...c.querySelectorAll(s));
      }
      return results;
    },
    getElementById(id) { return shadow.querySelector('#' + id); },
    contains(n) { return children.includes(n); },
    getRootNode() { return shadow; },
    get ownerDocument() { return document; },
    get nodeType() { return 11; }, // DOCUMENT_FRAGMENT_NODE
    get nodeName() { return '#document-fragment'; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setHTMLUnsafe(v) { this.innerHTML = String(v == null ? "" : v); },
    getHTML() { return this.innerHTML; },
    // Own textContent: ShadowRoot now extends DocumentFragment, so without
    // these the inherited Node accessors run against this._nid. The setter in
    // particular would target the host document and wipe it. Operate on the
    // shadow's own `children` store instead.
    get textContent() { return children.map(c => c.textContent || "").join(""); },
    set textContent(v) {
      children.length = 0;
      if (v != null && v !== "") children.push(document.createTextNode(String(v)));
    },
    hasChildNodes() { return children.length > 0; },
    // A detached fragment id backs any inherited nid-based method we do not
    // override, so they stay non-destructive (operate on an empty fragment)
    // rather than falling through to node 0 / the document.
    _nid: +_dom("create_document_fragment"),
    activeElement: null,
    get styleSheets() { return []; },
    cloneNode() { throw new DOMException('Failed to execute cloneNode on Node: ShadowRoot nodes are not clonable.', 'NotSupportedError'); },
  };
  Object.setPrototypeOf(shadow, ShadowRoot.prototype);
  this._shadowRoot = shadow;
  return shadow;
};

_markNative(Element.prototype.attachShadow);

Object.defineProperty(Element.prototype, 'shadowRoot', {
  configurable: true,
  enumerable: true,
  get: function () {
    var sr = this._shadowRoot;
    return sr && sr.mode === 'open' ? sr : null;
  },
});

// setHTMLUnsafe / getHTML: shims over innerHTML. setHTMLUnsafe parses markup
// like innerHTML (declarative shadow roots inside are not expanded yet, but the
// call no longer throws so the rest of a test file can run); getHTML serializes
// like innerHTML.
Element.prototype.setHTMLUnsafe = function setHTMLUnsafe(html) { this.innerHTML = String(html == null ? "" : html); };
Element.prototype.getHTML = function getHTML() { return this.innerHTML; };
_markNative(Element.prototype.setHTMLUnsafe);
_markNative(Element.prototype.getHTML);
// Document.parseHTMLUnsafe(html): static that parses into a new HTML document.
if (typeof Document !== 'undefined' && typeof Document.parseHTMLUnsafe !== 'function') {
  Document.parseHTMLUnsafe = function parseHTMLUnsafe(html) {
    return new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
  };
  _markNative(Document.parseHTMLUnsafe);
}

globalThis.AudioBuffer = class AudioBuffer {
  constructor(opts) {
    var o = (typeof opts === 'object' && opts !== null) ? opts : {};
    this.numberOfChannels = o.numberOfChannels || 1;
    this.length = o.length || 0;
    this.sampleRate = o.sampleRate || 44100;
    this.duration = this.length / (this.sampleRate || 44100);
    this._chs = [];
    for (var c = 0; c < this.numberOfChannels; c++) this._chs.push(new Float32Array(this.length));
  }
  getChannelData(c) { return this._chs[c] || this._chs[0] || new Float32Array(0); }
  copyFromChannel(dst, ch, start) { var s=this._chs[ch]||this._chs[0]; start=start||0; for(var i=0;i<dst.length;i++) dst[i]=(s&&s[start+i])||0; }
  copyToChannel(src, ch, start) { var d=this._chs[ch]||this._chs[0]; start=start||0; if(d) for(var i=0;i<src.length;i++) d[start+i]=src[i]; }
};
globalThis.AudioContext = class AudioContext {
  constructor() { this.sampleRate=_fp('audioSampleRate'); this.state='running'; this.currentTime=0; this.baseLatency=_fp('audioBaseLatency'); this.destination={maxChannelCount:2,numberOfInputs:1,numberOfOutputs:0,channelCount:2}; this._listeners={}; }
  addEventListener(type, fn) { if (!this._listeners[type]) this._listeners[type]=[]; this._listeners[type].push(fn); }
  removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type]=this._listeners[type].filter(h=>h!==fn); }
  _ap(v, min=-3.4028235e38, max=3.4028235e38) { return { value: v, defaultValue: v, minValue: min, maxValue: max, setValueAtTime(){} }; }
  createOscillator() { return {context:this,type:'sine',frequency:this._ap(440, -22050, 22050),detune:this._ap(0, -153600, 153600),connect(){},start(){},stop(){},disconnect(){},addEventListener(){},removeEventListener(){}}; }
  createDynamicsCompressor() { return {context:this,threshold:this._ap(_fp('compThreshold'), -100, 0),knee:this._ap(_fp('compKnee'), 0, 40),ratio:this._ap(_fp('compRatio'), 1, 20),attack:this._ap(0.003, 0, 1),release:this._ap(0.25, 0, 1),reduction:0,connect(){},disconnect(){}}; }
  createAnalyser() {
    return {context:this,fftSize:2048,frequencyBinCount:1024,channelCount:2,channelCountMode:'max',channelInterpretation:'speakers',maxDecibels:-30,minDecibels:-100,numberOfInputs:1,numberOfOutputs:1,smoothingTimeConstant:0.8,connect(){},disconnect(){},
      getByteFrequencyData(a){for(let i=0;i<a.length;i++)a[i]=Math.floor(_fpRand(600+i)*10);},
      getFloatFrequencyData(a){for(let i=0;i<a.length;i++)a[i]=-100+_fpRand(700+i)*5;}
    };
  }
  createGain() { return {context:this,gain:this._ap(1),connect(){},disconnect(){}}; }
  createBiquadFilter() { return {context:this,type:'lowpass',frequency:this._ap(350, 0, 22050),Q:this._ap(1, 0.0001, 1000),gain:this._ap(0, -40, 40),connect(){},disconnect(){}}; }
  createBufferSource() { return {context:this,buffer:null,connect(){},start(){},stop(){},disconnect(){},loop:false}; }
  createBuffer(ch,len,rate) { return new globalThis.AudioBuffer({numberOfChannels:ch||1,length:len||0,sampleRate:rate||44100}); }
  createScriptProcessor() { return {connect(){},disconnect(){},onaudioprocess:null}; }
  decodeAudioData(buf) { return Promise.resolve(this.createBuffer(2,44100,44100)); }
  resume() { this.state='running'; return Promise.resolve(); }
  suspend() { this.state='suspended'; return Promise.resolve(); }
  close() { this.state='closed'; return Promise.resolve(); }
};
globalThis.OfflineAudioContext = class OfflineAudioContext extends AudioContext {
  constructor(ch,len,rate) {
    super();
    if (typeof ch === 'object' && ch !== null) {
      this.length = ch.length || 44100;
      this.sampleRate = ch.sampleRate || 44100;
    } else {
      this.length = len || 44100;
      this.sampleRate = rate || 44100;
    }
    this.oncomplete = null;
  }
  startRendering() {
    var self = this;
    var buf = this.createBuffer(1, self.length, 44100);
    var data = buf.getChannelData(0);
    // Simulate compressed triangle wave at 10kHz.
    // Target: sum(|data[4500..5000]|) matches Chrome Linux (~124.04347527516074).
    var target = 124.04347527516074 + (_fpRand(9991) - 0.5) * 0.002;
    var freq = 10000, sr = 44100;
    for (var i = 0; i < self.length; i++) {
      var phase = ((i * freq / sr) % 1 + 1) % 1;
      data[i] = phase < 0.5 ? 4*phase - 1 : 3 - 4*phase;
    }
    var s = 0;
    for (var i = 4500; i < 5000; i++) s += Math.abs(data[i]);
    var scale = s > 0 ? target / s : 0;
    for (var i = 0; i < self.length; i++) data[i] *= scale;
    // Fire oncomplete + 'complete' listeners on next microtask so callers
    // can register handlers synchronously after startRendering().
    var p = Promise.resolve().then(function() {
      var evt = {renderedBuffer: buf, target: self, type: 'complete'};
      if (typeof self.oncomplete === 'function') {
        try { self.oncomplete(evt); } catch(e) {}
      }
      var listeners = (self._listeners && self._listeners['complete']) || [];
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](evt); } catch(e) {}
      }
      return buf;
    });
    return p;
  }
};
globalThis.webkitAudioContext = globalThis.AudioContext;

globalThis.speechSynthesis = (function () {
  const _voices = [{ name: 'Google US English', lang: 'en-US', default: true, localService: true, voiceURI: 'Google US English' }];
  const _ls = {};
  let _onvoiceschanged = null;
  const ss = {
    speaking: false, pending: false, paused: false,
    getVoices() { return _voices.slice(); },
    speak() {}, cancel() {}, pause() {}, resume() {},
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      (_ls[type] || (_ls[type] = [])).push(fn);
      // Real Chrome loads voices asynchronously and fires `voiceschanged` once
      // they're ready; collectors (e.g. MixVisit) `await` that event before
      // reading getVoices(). The earlier no-op addEventListener meant the event
      // never arrived and those collectors hung forever. Voices are already
      // available here, so fire once right after a listener subscribes.
      if (type === 'voiceschanged') {
        setTimeout(() => { try { ss.dispatchEvent(new Event('voiceschanged')); } catch (e) {} }, 0);
      }
    },
    removeEventListener(type, fn) {
      const a = _ls[type]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent(evt) {
      (_ls[evt.type] || []).slice().forEach((f) => { try { f.call(ss, evt); } catch (e) {} });
      if (evt.type === 'voiceschanged' && typeof _onvoiceschanged === 'function') {
        try { _onvoiceschanged.call(ss, evt); } catch (e) {}
      }
      return true;
    },
    get onvoiceschanged() { return _onvoiceschanged; },
    set onvoiceschanged(fn) {
      _onvoiceschanged = fn;
      if (typeof fn === 'function') setTimeout(() => { try { ss.dispatchEvent(new Event('voiceschanged')); } catch (e) {} }, 0);
    },
  };
  return ss;
})();
globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance { constructor(t){this.text=t;this.lang='en-US';this.rate=1;this.pitch=1;this.volume=1;} };

globalThis.MediaStream = class MediaStream { constructor(){this.id='';this.active=true;} getTracks(){return [];} getAudioTracks(){return [];} getVideoTracks(){return [];} addTrack(){} removeTrack(){} clone(){return new MediaStream();} };
globalThis.MediaStreamTrack = class MediaStreamTrack { constructor(){this.kind='';this.enabled=true;this.readyState='live';} stop(){} clone(){return new MediaStreamTrack();} };

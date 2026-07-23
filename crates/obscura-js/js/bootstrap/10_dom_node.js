class Node {
  static ELEMENT_NODE = 1;
  static ATTRIBUTE_NODE = 2;
  static TEXT_NODE = 3;
  static CDATA_SECTION_NODE = 4;
  static ENTITY_REFERENCE_NODE = 5;
  static ENTITY_NODE = 6;
  static PROCESSING_INSTRUCTION_NODE = 7;
  static COMMENT_NODE = 8;
  static DOCUMENT_NODE = 9;
  static DOCUMENT_TYPE_NODE = 10;
  static DOCUMENT_FRAGMENT_NODE = 11;
  static NOTATION_NODE = 12;
  static DOCUMENT_POSITION_DISCONNECTED = 1;
  static DOCUMENT_POSITION_PRECEDING = 2;
  static DOCUMENT_POSITION_FOLLOWING = 4;
  static DOCUMENT_POSITION_CONTAINS = 8;
  static DOCUMENT_POSITION_CONTAINED_BY = 16;
  static DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 32;

  constructor(nid) { this._nid = nid; }
  get nodeType() { return +_dom("node_type", this._nid); }
  get nodeName() { return _domParse("node_name", this._nid) || ""; }
  get ownerDocument() { return globalThis.document; }
  // https://dom.spec.whatwg.org/#dom-node-baseuri
  get baseURI() {
    try {
      const doc = globalThis.document;
      const docUrl = (doc && doc.URL) || "";
      const baseEl = (doc && doc.querySelector) ? doc.querySelector("base[href]") : null;
      if (baseEl) {
        const href = baseEl.getAttribute("href");
        if (href) {
          return docUrl ? new URL(href, docUrl).href : href;
        }
      }
      return docUrl;
    } catch (e) {
      return "";
    }
  }
  get textContent() { return _domParse("text_content", this._nid) ?? ""; }
  set textContent(v) {
    const oldChildren = _domParse("child_nodes", this._nid) || [];
    for (const c of oldChildren) _dom("remove_child", c);
    let added = [];
    if (v != null && v !== "") {
      const tn = +_dom("create_text_node", String(v));
      _dom("append_child", this._nid, tn);
      added = [tn];
    }
    // Real MutationObserver fires childList for the children swap.
    // Without this React 18+ hydration mismatch detection and many polling
    // libs (intersection-driven lazy load, content sync) silently stall.
    if (globalThis.__mutationObservers?.length) {
      globalThis.__notifyMutation('childList', this._nid, added, oldChildren);
    }
  }
  get nodeValue() {
    const t = this.nodeType;
    if (t === 3 || t === 8) return _domParse("text_content", this._nid) ?? "";
    return null;
  }
  set nodeValue(v) {
    const t = this.nodeType;
    if (t === 3 || t === 8) _dom("set_text_content", this._nid, String(v ?? ""));
  }
  get parentNode() { return _wrap(+_dom("parent_node", this._nid)); }
  get parentElement() { const p = this.parentNode; return p && p.nodeType === 1 ? p : null; }
  get childNodes() {
    const ids = _domParse("child_nodes", this._nid) || [];
    return _nodeList(ids.map(_wrap).filter(Boolean));
  }
  get firstChild() { return _wrap(+_dom("first_child", this._nid)); }
  get lastChild() { return _wrap(+_dom("last_child", this._nid)); }
  get nextSibling() { return _wrap(+_dom("next_sibling", this._nid)); }
  get previousSibling() { return _wrap(+_dom("prev_sibling", this._nid)); }
  appendChild(c) {
    if (!c) return c;
    if (c instanceof DocumentFragment) {
      const children = Array.from(c.childNodes);
      for (const child of children) this.appendChild(child);
      return c;
    }
    _dom("append_child", this._nid, c._nid);
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('childList', this._nid, [c._nid], []);
    if (c instanceof Element && c.tagName === 'SCRIPT') {
      const scriptType = c.getAttribute('type') || '';
      const isModule = scriptType === 'module';
      if (scriptType && !isModule && scriptType !== 'text/javascript' && scriptType !== 'application/javascript') {
        return c;
      }
      const src = c.getAttribute('src');
      const prevNid = globalThis.__currentScriptNid;
      if (src) {
        // Resolve against <base href> when present, else the document URL.
        // The base href is resolved to an absolute URL first: a bare path like
        // <base href="/"> (the common Angular form) is not a valid URL base on
        // its own and would otherwise throw. Both the base and the final
        // resolution are guarded so a bad value can never escape appendChild.
        let baseHref;
        try {
          const baseEl = globalThis.document?.querySelector('base[href]');
          baseHref = baseEl ? baseEl.getAttribute('href') : null;
        } catch(e) { baseHref = null; }
        const docUrl = globalThis.location?.href || 'http://localhost/';
        let baseUrl;
        try { baseUrl = baseHref ? new URL(baseHref, docUrl).href : docUrl; }
        catch(e) { baseUrl = docUrl; }
        let fullUrl;
        try {
          fullUrl = src.startsWith('http') || src.startsWith('data:')
            ? src
            : new URL(src, baseUrl).href;
        } catch(e) {
          console.error('Dynamic script URL resolve failed (' + src + '):', e.message);
          fullUrl = src;
        }
        const pageOrigin = (function() { try { return new URL(baseUrl).origin; } catch(e) { return ""; } })();
        // Enqueue — serialized via __processDynScriptQueue to prevent
        // concurrent import() calls from triggering deno_core RefCell panic.
        __dynScriptQueue.push({
          url: fullUrl,
          isModule,
          nid: c._nid,
          prevNid,
          pageOrigin,
          dispatchEvent: (ev) => { try { c.dispatchEvent(ev); } catch(e) {} },
        });
        __processDynScriptQueue();
      } else {
        const code = c.textContent;
        if (code) {
          if (isModule) {
            const dataUrl = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
            __dynScriptQueue.push({
              url: dataUrl,
              isModule: true,
              nid: c._nid,
              prevNid,
              pageOrigin: "",
              dispatchEvent: (ev) => { try { c.dispatchEvent(ev); } catch(e) {} },
            });
            __processDynScriptQueue();
          } else {
            globalThis.__currentScriptNid = c._nid;
            try { (0, eval)(code); }
            catch(e) { console.error('Dynamic inline script error:', e.message); }
            finally { globalThis.__currentScriptNid = prevNid || 0; }
          }
        }
      }
    } else if (c instanceof Element && c.tagName === 'IFRAME') {
      __registerDynamicIframe(c);
    }
    if (c instanceof Element && c.tagName === 'LINK') {
      _loadLinkedStylesheet(c);
    }
    return c;
  }
  removeChild(c) {
    if (!c) return c;
    _dom("remove_child", c._nid);
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('childList', this._nid, [], [c._nid]);
    return c;
  }
  replaceChild(newChild, oldChild) {
    if (!oldChild || !newChild) return oldChild;
    if (newChild instanceof DocumentFragment) {
      const children = Array.from(newChild.childNodes);
      for (const child of children) this.insertBefore(child, oldChild);
      this.removeChild(oldChild);
      return oldChild;
    }
    _dom("insert_before", newChild._nid, oldChild._nid);
    _dom("remove_child", oldChild._nid);
    return oldChild;
  }
  insertBefore(n, ref) {
    if (!n) return n;
    if (!ref) { this.appendChild(n); return n; }
    if (n instanceof DocumentFragment) {
      const children = Array.from(n.childNodes);
      for (const child of children) this.insertBefore(child, ref);
      return n;
    }
    _dom("insert_before", n._nid, ref._nid);
    return n;
  }
  contains(o) { return o ? _dom("contains", this._nid, o._nid) === "true" : false; }
  hasChildNodes() { return _dom("has_child_nodes", this._nid) === "true"; }
  cloneNode(deep) {
    const t = this.nodeType;
    if (t === 1) {
      if (deep) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = _domParse("outer_html", this._nid) || "";
        const clone = wrapper.firstChild;
        return clone;
      }
      const el = document.createElement(this.nodeName.toLowerCase());
      const html = _domParse("outer_html", this._nid) || "";
      const attrMatch = html.match(/^<[a-zA-Z][^\s>]*([\s\S]*?)>/);
      if (attrMatch && attrMatch[1]) {
        const attrStr = attrMatch[1].trim();
        const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
        let m;
        while ((m = re.exec(attrStr)) !== null) {
          const name = m[1];
          const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || "";
          if (name !== this.nodeName.toLowerCase()) el.setAttribute(name, val);
        }
      }
      return el;
    }
    if (t === 3) return document.createTextNode(this.textContent);
    if (t === 8) return document.createComment(this.nodeValue || "");
    return null;
  }
  compareDocumentPosition(other) {
    if (!other) return 0;
    if (this._nid === other._nid) return 0;
    // Different roots: DISCONNECTED | IMPLEMENTATION_SPECIFIC plus a stable
    // (consistent across calls) PRECEDING/FOLLOWING bit, chosen by node-id order.
    if (+_dom("node_root", this._nid) !== +_dom("node_root", other._nid)) {
      return 1 | 32 | ((this._nid < other._nid) ? 4 : 2);
    }
    if (this.contains(other)) return 16 | 4;          // CONTAINED_BY | FOLLOWING
    if (other.contains && other.contains(this)) return 8 | 2; // CONTAINS | PRECEDING
    // Same root, neither contains the other: real tree order (compare_order op:
    // -1 => this precedes other => other FOLLOWS this(4); +1 => this PRECEDING(2)).
    return (+_dom("compare_order", this._nid, other._nid) < 0) ? 4 : 2;
  }
  getRootNode() { return globalThis.document; }
  normalize() {
    // Merge adjacent exclusive Text nodes, drop empty ones, recurse. Detached
    // removed nodes keep their own data (read from the backing node by nid).
    let child = this.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child.nodeType === 3) {
        let data = child.data, sib = child.nextSibling;
        while (sib && sib.nodeType === 3) { const after = sib.nextSibling; data += sib.data; this.removeChild(sib); sib = after; }
        if (data.length === 0) { this.removeChild(child); child = sib; continue; }
        if (data !== child.data) child.data = data;
        child = sib; continue;
      } else if (child.nodeType === 1 || child.nodeType === 11) {
        child.normalize();
      }
      child = next;
    }
  }
  isEqualNode(other) {
    if (!other) return false;
    if (this._nid === other._nid) return true;
    if (this.nodeType !== other.nodeType) return false;
    if (this.nodeName !== other.nodeName) return false;
    if (this.nodeValue !== other.nodeValue) return false;
    const a = this.attributes ? this.attributes : null;
    const b = other.attributes ? other.attributes : null;
    if ((a && a.length) || (b && b.length)) {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (other.getAttribute(a[i].name) !== a[i].value) return false;
      }
    }
    const cA = this.childNodes || [];
    const cB = other.childNodes || [];
    if (cA.length !== cB.length) return false;
    for (let i = 0; i < cA.length; i++) {
      if (!cA[i].isEqualNode(cB[i])) return false;
    }
    return true;
  }
  isSameNode(other) { return other && this._nid === other._nid; }
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
}
class CharacterData extends Node {
  get data() {
    return _domParse("text_content", this._nid) ?? "";
  }
  set data(v) {
    const oldValue = _domParse("text_content", this._nid) ?? "";
    _dom("set_text_content", this._nid, String(v ?? ""));
    if (globalThis.__mutationObservers?.length) {
      globalThis.__notifyMutation('characterData', this._nid, [], [], null, oldValue);
    }
  }
  get length() { return this.data.length; }
  substringData(offset, count) {
    return this.data.substring(offset, offset + count);
  }
  appendData(s) { this.data += s; }
  insertData(offset, s) {
    const d = this.data;
    this.data = d.slice(0, offset) + s + d.slice(offset);
  }
  deleteData(offset, count) {
    const d = this.data;
    this.data = d.slice(0, offset) + d.slice(offset + count);
  }
  replaceData(offset, count, s) {
    const d = this.data;
    this.data = d.slice(0, offset) + s + d.slice(offset + count);
  }
}

class Text extends CharacterData {
  get nodeName() { return "#text"; }
  get nodeType() { return 3; }
  get wholeText() { return this.data; }
  splitText(offset) {
    const d = this.data;
    const tail = d.substring(offset);
    this.data = d.substring(0, offset);
    const newNid = +_dom("create_text_node", tail);
    const parent = this.parentNode;
    if (parent) {
      const ref = this.nextSibling;
      parent.insertBefore(_wrap(newNid), ref);
    }
    return _wrap(newNid);
  }
  cloneNode() { return document.createTextNode(this.data); }
}

class Comment extends CharacterData {
  get nodeName() { return "#comment"; }
  get nodeType() { return 8; }
  cloneNode() { return document.createComment(this.data); }
}

// DOMTokenList backs class/rel/sandbox/etc. attribute reflection. It parses the
// associated content attribute as an ordered set of tokens and writes changes
// straight back, so reads and writes stay live with the element. A Proxy is
// layered on top so numeric indexing (list[0]) hits item().
class DOMTokenList {
  constructor(el, attr, supportedTokens) {
    // Non-enumerable so the element <-> token-list cycle is not visible to
    // enumeration/serialization (JSON.stringify(classList) would otherwise
    // throw "circular structure").
    Object.defineProperty(this, "_el", { value: el, writable: true, enumerable: false });
    Object.defineProperty(this, "_attr", { value: attr, writable: true, enumerable: false });
    Object.defineProperty(this, "_supported", { value: supportedTokens || null, writable: true, enumerable: false });
    return new Proxy(this, {
      get(t, k, r) {
        if (typeof k === "string" && /^\d+$/.test(k)) return t.item(+k);
        return Reflect.get(t, k, r);
      },
      has(t, k) {
        if (typeof k === "string" && /^\d+$/.test(k)) return +k < t.length;
        return Reflect.has(t, k);
      },
    });
  }
  get [Symbol.toStringTag]() { return "DOMTokenList"; }
  _tokens() {
    const v = this._el.getAttribute(this._attr);
    if (!v) return [];
    const seen = new Set();
    const out = [];
    for (const tok of v.split(/[ \t\n\f\r]+/)) {
      if (tok && !seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
    return out;
  }
  _write(tokens) {
    this._el.setAttribute(this._attr, tokens.join(" "));
  }
  get length() { return this._tokens().length; }
  get value() { return this._el.getAttribute(this._attr) || ""; }
  set value(v) { this._el.setAttribute(this._attr, String(v)); }
  item(i) { const t = this._tokens(); return (i >= 0 && i < t.length) ? t[i] : null; }
  contains(token) { return this._tokens().includes(String(token)); }
  add(...tokens) {
    const t = this._tokens();
    for (const raw of tokens) {
      const tok = String(raw);
      if (tok === "") throw new DOMException("The token provided must not be empty.", "SyntaxError");
      if (/[ \t\n\f\r]/.test(tok)) throw new DOMException("The token provided contains HTML space characters, which are not valid in tokens.", "InvalidCharacterError");
      if (!t.includes(tok)) t.push(tok);
    }
    this._write(t);
  }
  remove(...tokens) {
    let t = this._tokens();
    for (const raw of tokens) {
      const tok = String(raw);
      if (tok === "") throw new DOMException("The token provided must not be empty.", "SyntaxError");
      if (/[ \t\n\f\r]/.test(tok)) throw new DOMException("The token provided contains HTML space characters, which are not valid in tokens.", "InvalidCharacterError");
      t = t.filter((x) => x !== tok);
    }
    this._write(t);
  }
  toggle(token, force) {
    const tok = String(token);
    if (tok === "") throw new DOMException("The token provided must not be empty.", "SyntaxError");
    if (/[ \t\n\f\r]/.test(tok)) throw new DOMException("The token provided contains HTML space characters, which are not valid in tokens.", "InvalidCharacterError");
    const t = this._tokens();
    const has = t.includes(tok);
    if (has) {
      if (force === true) return true;
      this._write(t.filter((x) => x !== tok));
      return false;
    }
    if (force === false) return false;
    t.push(tok);
    this._write(t);
    return true;
  }
  replace(token, newToken) {
    const a = String(token), b = String(newToken);
    if (a === "" || b === "") throw new DOMException("The token provided must not be empty.", "SyntaxError");
    if (/[ \t\n\f\r]/.test(a) || /[ \t\n\f\r]/.test(b)) throw new DOMException("The token provided contains HTML space characters, which are not valid in tokens.", "InvalidCharacterError");
    const t = this._tokens();
    const i = t.indexOf(a);
    if (i === -1) return false;
    if (t.includes(b) && b !== a) { t.splice(i, 1); } else { t[i] = b; }
    this._write(t);
    return true;
  }
  supports(token) {
    if (!this._supported) throw new TypeError("DOMTokenList has no supported tokens.");
    return this._supported.includes(String(token).toLowerCase());
  }
  forEach(cb, thisArg) {
    const t = this._tokens();
    for (let i = 0; i < t.length; i++) cb.call(thisArg, t[i], i, this);
  }
  *values() { yield* this._tokens(); }
  *keys() { const t = this._tokens(); for (let i = 0; i < t.length; i++) yield i; }
  *entries() { const t = this._tokens(); for (let i = 0; i < t.length; i++) yield [i, t[i]]; }
  [Symbol.iterator]() { return this._tokens()[Symbol.iterator](); }
  toString() { return this.value; }
}

// CDATASection: a Text-derived node (nodeType 4) used only in XML documents.
// Extends Text so data/length/textContent/childNodes reuse the working text
// node machinery; only the type-identifying getters differ.
class CDATASection extends Text {
  get nodeName() { return "#cdata-section"; }
  get nodeType() { return 4; }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = v; }
  cloneNode() { return new CDATASection(+_dom("create_text_node", this.data)); }
}

// ProcessingInstruction: nodeType 7, nodeName === target. Extends CharacterData
// and carries a separate target. Backed by a text node so data/nodeValue/
// textContent/length work without native PI support.
class ProcessingInstruction extends CharacterData {
  constructor(nid, target) { super(nid); this._target = target; }
  get target() { return this._target; }
  get nodeName() { return this._target; }
  get nodeType() { return 7; }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = v; }
  cloneNode() { return new ProcessingInstruction(+_dom("create_text_node", this.data), this._target); }
}

// Document character encoding (WHATWG canonical name, e.g. "UTF-8", "EUC-JP").
// Cached per runtime: the encoding is fixed for a document's lifetime and this
// is read on every <a>/<area> URL-component access, so the UTF-8 common case
// must reduce to a single cached-boolean read with no op call and no allocation.
let __docEncoding;
let __docIsUtf8;
function _docEncoding() {
  if (__docEncoding === undefined) {
    const e = _domParse("document_encoding");
    __docEncoding = (typeof e === 'string' && e) ? e : 'UTF-8';
    __docIsUtf8 = __docEncoding.toLowerCase() === 'utf-8';
  }
  return __docEncoding;
}
function _docIsUtf8() { if (__docIsUtf8 === undefined) _docEncoding(); return __docIsUtf8; }
// WHATWG "special scheme" check (these get the special-query percent-encode set).
function _isSpecialScheme(protocol) {
  const s = (protocol || '').replace(/:$/, '').toLowerCase();
  return s === 'http' || s === 'https' || s === 'ws' || s === 'wss' || s === 'ftp' || s === 'file';
}
// Apply the WHATWG URL "encoding override": in a legacy (non-UTF-8) document
// the query of an <a>/<area> href is percent-encoded in the document charset,
// not UTF-8. The url op already produced a UTF-8-encoded query; recover the
// original characters (percent-decode + UTF-8) and re-encode them through the
// document charset. Pure-ASCII queries round-trip unchanged.
function _applyDocQueryEncoding(u) {
  if (!u || !u.search || u.search.length < 2) return u;
  let decoded;
  try { decoded = decodeURIComponent(u.search.slice(1)); } catch (e) { return u; }
  let reencoded;
  try { reencoded = __obscura_core.ops.op_url_encode_query(decoded, _docEncoding(), _isSpecialScheme(u.protocol)); }
  catch (e) { return u; }
  const newSearch = '?' + reencoded;
  if (newSearch === u.search) return u;
  const hashIdx = u.href.indexOf('#');
  const frag = hashIdx >= 0 ? u.href.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? u.href.slice(0, hashIdx) : u.href;
  const qIdx = beforeHash.indexOf('?');
  u.href = (qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash) + newSearch + frag;
  u.search = newSearch;
  return u;
}

// HTMLHyperlinkElementUtils helpers (the <a>/<area> URL-decomposition members).
// The element's href attribute is parsed against the document base URL via the
// WHATWG url op; component getters read it, setters rewrite the href attribute.
function _anchorBase() { return _domParse("document_url") || "about:blank"; }
function _elemHrefURL(el) {
  const raw = el.getAttribute('href');
  if (raw === null || raw === undefined) return null;
  const u = _urlParseOp(raw, _anchorBase());
  if (u && !_docIsUtf8()) return _applyDocQueryEncoding(u);
  return u;
}
function _setElemHrefPart(el, part, value) {
  const u = _elemHrefURL(el);
  if (!u) return;
  const c = _urlSetOp(u.href, part, value);
  if (c) el.setAttribute('href', c.href);
}

// --- <input> number/date conversion (valueAsNumber/valueAsDate/stepUp/Down) ---
// Applicable types and their step scale factor + default step (HTML spec).
const _INPUT_NUM_TYPES = { date: 1, month: 1, week: 1, time: 1, 'datetime-local': 1, number: 1, range: 1 };
const _INPUT_DATE_TYPES = { date: 1, month: 1, week: 1, time: 1, 'datetime-local': 1 };
const _INPUT_STEP_SCALE = { date: 86400000, 'datetime-local': 1000, month: 1, number: 1, range: 1, time: 1000, week: 604800000 };
const _INPUT_STEP_DEFAULT = { date: 1, 'datetime-local': 60, month: 1, number: 1, range: 1, time: 60, week: 1 };
function _pad(n, w) { n = String(Math.abs(n | 0)); while (n.length < w) n = '0' + n; return n; }
function _daysInMonth(y, m) { return [31, ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function _isoWeek1Monday(y) { const jan4 = Date.UTC(y, 0, 4); const dow = (new Date(jan4).getUTCDay() + 6) % 7; return jan4 - dow * 86400000; }
// Parse an <input> value string to its numeric form per type; NaN if invalid.
function _inputParseNumber(type, v) {
  v = String(v == null ? '' : v);
  let m;
  switch (type) {
    case 'number': case 'range': { if (v === '') return NaN; const n = Number(v); return isFinite(n) ? n : NaN; }
    case 'date': if ((m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(v))) { const y = +m[1], mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= _daysInMonth(y, mo)) return Date.UTC(y, mo - 1, d); } return NaN;
    case 'month': if ((m = /^(\d{4,})-(\d{2})$/.exec(v))) { const y = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12) return (y - 1970) * 12 + (mo - 1); } return NaN;
    case 'week': if ((m = /^(\d{4,})-W(\d{2})$/.exec(v))) { const y = +m[1], w = +m[2]; if (w >= 1 && w <= 53) return _isoWeek1Monday(y) + (w - 1) * 604800000; } return NaN;
    case 'time': if ((m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(v))) { const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0, ms = m[4] ? +((m[4] + '00').slice(0, 3)) : 0; if (h <= 23 && mi <= 59 && s <= 59) return ((h * 60 + mi) * 60 + s) * 1000 + ms; } return NaN;
    case 'datetime-local': if ((m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(v))) { const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0, ms = m[7] ? +((m[7] + '00').slice(0, 3)) : 0; if (mo >= 1 && mo <= 12 && d >= 1 && d <= _daysInMonth(y, mo) && h <= 23 && mi <= 59 && s <= 59) return Date.UTC(y, mo - 1, d, h, mi, s, ms); } return NaN;
  }
  return NaN;
}
// Format a numeric value back to an <input> value string per type.
function _inputFormatNumber(type, n) {
  switch (type) {
    case 'number': case 'range': return String(n);
    case 'date': { const dt = new Date(n); return _pad(dt.getUTCFullYear(), 4) + '-' + _pad(dt.getUTCMonth() + 1, 2) + '-' + _pad(dt.getUTCDate(), 2); }
    case 'month': { const y = 1970 + Math.floor(n / 12); const mo = ((n % 12) + 12) % 12 + 1; return _pad(y, 4) + '-' + _pad(mo, 2); }
    case 'week': { const d = new Date(n); const dow = (d.getUTCDay() + 6) % 7; const thu = n - dow * 86400000 + 3 * 86400000; const ty = new Date(thu).getUTCFullYear(); const w = Math.round((n - dow * 86400000 - _isoWeek1Monday(ty)) / 604800000) + 1; return _pad(ty, 4) + '-W' + _pad(w, 2); }
    case 'time': { n = ((n % 86400000) + 86400000) % 86400000; const ms = n % 1000; n = Math.floor(n / 1000); const s = n % 60; n = Math.floor(n / 60); const mi = n % 60; const h = Math.floor(n / 60); let str = _pad(h, 2) + ':' + _pad(mi, 2); if (s || ms) { str += ':' + _pad(s, 2); if (ms) str += '.' + _pad(ms, 3); } return str; }
    case 'datetime-local': { const dt = new Date(n); let str = _pad(dt.getUTCFullYear(), 4) + '-' + _pad(dt.getUTCMonth() + 1, 2) + '-' + _pad(dt.getUTCDate(), 2) + 'T' + _pad(dt.getUTCHours(), 2) + ':' + _pad(dt.getUTCMinutes(), 2); const s = dt.getUTCSeconds(), ms = dt.getUTCMilliseconds(); if (s || ms) { str += ':' + _pad(s, 2); if (ms) str += '.' + _pad(ms, 3); } return str; }
  }
  return String(n);
}

// WebIDL interface constants live on both the interface object and the interface
// prototype object (instances inherit; idlharness checks Node.prototype).
Object.assign(Node.prototype, {
  ELEMENT_NODE: 1, ATTRIBUTE_NODE: 2, TEXT_NODE: 3, CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5, ENTITY_NODE: 6, PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12, DOCUMENT_POSITION_DISCONNECTED: 1, DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16, DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
});

// HTML elements ASCII-lowercase attribute names (setAttribute('accessKey') is
// stored as 'accesskey'). The toLowerCase is gated behind a cheap uppercase
// charCode scan so the all-lowercase common case (href, class, id, data-*)
// allocates nothing and never consults the namespace; only when an uppercase
// ASCII letter is present do we check the element is HTML before folding.
function _htmlAttrName(el, n) {
  n = typeof n === "string" ? n : String(n);
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      return el.namespaceURI === "http://www.w3.org/1999/xhtml" ? n.toLowerCase() : n;
    }
  }
  return n;
}

// A submit button per the HTML spec: a <button> whose type is submit — the
// default, including when the type attribute is missing or invalid — or an
// <input> of type submit/image. Used to validate requestSubmit's submitter.
function _isSubmitButton(el) {
  if (!el || typeof el.localName !== "string") return false;
  const type = ((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
  if (el.localName === "button") return type !== "reset" && type !== "button";
  if (el.localName === "input") return type === "submit" || type === "image";
  return false;
}


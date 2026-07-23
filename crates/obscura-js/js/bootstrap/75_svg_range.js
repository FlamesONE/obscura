function SVGAnimatedString(el, attr, fallbackAttr) {
  this._el = el;
  this._attr = attr;
  this._fallback = fallbackAttr || null;
}
SVGAnimatedString.prototype._read = function() {
  let v = this._el.getAttribute(this._attr);
  if (v === null && this._fallback) v = this._el.getAttribute(this._fallback);
  return v == null ? '' : v;
};
Object.defineProperty(SVGAnimatedString.prototype, 'baseVal', {
  get() { return this._read(); },
  set(v) { this._el.setAttribute(this._attr, String(v)); },
  configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, 'animVal', {
  get() { return this._read(); },
  configurable: true, enumerable: true,
});
Object.defineProperty(SVGAnimatedString.prototype, Symbol.toStringTag, { value: 'SVGAnimatedString', configurable: true });
_markNative(SVGAnimatedString);

globalThis.SVGElement = Element;
globalThis.SVGSVGElement = Element;
globalThis.CharacterData = CharacterData;
globalThis.Text = Text;
globalThis.Comment = Comment;

globalThis.CDATASection = CDATASection;
globalThis.ProcessingInstruction = ProcessingInstruction;
// True when the document was loaded from an XML/XHTML source. Obscura has no
// native XML tree, so this is inferred from contentType (derived from the URL).
function _isXMLDocument(doc) {
  const ct = (doc && doc.contentType) || "text/html";
  return ct !== "text/html";
}
// XML Name production, sufficient for createProcessingInstruction targets.
const _piNameStart = "A-Za-z_:\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
const _piNameChar = _piNameStart + "0-9.\\u00B7\\u0300-\\u036F\\u203F-\\u2040\\-";
const _piNameRe = new RegExp("^[" + _piNameStart + "][" + _piNameChar + "]*$");
function _isValidPITarget(target) {
  return typeof target === "string" && target.length > 0 && _piNameRe.test(target);
}
globalThis.DocumentFragment = DocumentFragment;
globalThis.DocumentType = DocumentType;
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.Document = Document;
globalThis.XPathResult = globalThis.XPathResult || class XPathResult {};
Object.assign(globalThis.XPathResult, {
  ANY_TYPE: 0,
  NUMBER_TYPE: 1,
  STRING_TYPE: 2,
  BOOLEAN_TYPE: 3,
  UNORDERED_NODE_ITERATOR_TYPE: 4,
  ORDERED_NODE_ITERATOR_TYPE: 5,
  UNORDERED_NODE_SNAPSHOT_TYPE: 6,
  ORDERED_NODE_SNAPSHOT_TYPE: 7,
  ANY_UNORDERED_NODE_TYPE: 8,
  FIRST_ORDERED_NODE_TYPE: 9,
});
// XMLDocument is a subclass of Document (DOMParser of an XML type and
// implementation.createDocument produce one). The interface must exist globally.
if (typeof XMLDocument === "undefined") globalThis.XMLDocument = class XMLDocument extends Document {};
// ParentNode mixin: Document and DocumentFragment are ParentNodes too, so they
// share Element's append / prepend / replaceChildren.
for (const _proto of [Document.prototype, DocumentFragment.prototype]) {
  _proto.append = Element.prototype.append;
  _proto.prepend = Element.prototype.prepend;
  _proto.replaceChildren = Element.prototype.replaceChildren;
}
globalThis.EventTarget = Node;
globalThis.HTMLCollection = class HTMLCollection extends Array {
  item(i) {
    i = i >>> 0;
    return this[i] != null ? this[i] : null;
  }
  namedItem(name) {
    if (name === undefined || name === null || name === "") return null;
    name = String(name);
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      if (!el) continue;
      // id always contributes; name only for HTML elements in HTML documents.
      if (el.id === name) return el;
      if (_isHTMLEl(el) && typeof el.getAttribute === "function" && el.getAttribute("name") === name) return el;
    }
    return null;
  }
  // Factory: build an HTMLCollection from an array of elements. Named access
  // (collection[name]) is served lazily by a Proxy so there is NO per-element
  // work at build time (eager defineProperty per id was an O(n) build cost that
  // made querySelectorAll on large result sets ~26x slower). The Proxy only
  // resolves a name when an unknown string key is actually read.
  static _from(arr) {
    const c = new HTMLCollection();
    if (arr) for (let i = 0; i < arr.length; i++) { if (arr[i]) c[c.length] = arr[i]; }
    return new Proxy(c, _htmlCollectionProxy);
  }
};
_markNative(HTMLCollection.prototype.item);
_markNative(HTMLCollection.prototype.namedItem);
// Shared (allocated once) Proxy traps for HTMLCollection named access. Indices,
// length, and inherited methods resolve normally via Reflect; only an unknown
// non-numeric string key falls back to namedItem(), so item/namedItem and the
// Array methods are never shadowed and id="namedItem" cannot recurse.
const _htmlCollectionProxy = {
  get(t, k, r) {
    const v = Reflect.get(t, k, r);
    if (v !== undefined || typeof k !== "string") return v;
    return t.namedItem ? (t.namedItem(k) || undefined) : undefined;
  },
  has(t, k) {
    if (Reflect.has(t, k)) return true;
    return typeof k === "string" && !!(t.namedItem && t.namedItem(k));
  },
};
// True for elements in the HTML namespace (the only ones whose name attribute
// contributes to an HTMLCollection's supported property names).
function _isHTMLEl(el) {
  return !!el && (el.namespaceURI === undefined || el.namespaceURI === "http://www.w3.org/1999/xhtml");
}
// Build a NodeList (no named access, per spec) for querySelectorAll and
// childNodes. Kept light on purpose: querySelectorAll is the hottest query API.
function _nodeList(els) {
  const nl = new NodeList();
  for (let i = 0; i < els.length; i++) nl[i] = els[i];
  nl.length = els.length;
  return nl;
}
globalThis.DOMTokenList = DOMTokenList;
// NodeList is its own type, not an Array subclass: in a real browser
// Array.isArray(nodeList) is false and Object.prototype.toString reports
// "[object NodeList]". Fingerprinting and feature-detection scripts check both.
// It keeps the array-like surface scripts actually use: indexed access, length,
// item(), forEach(), entries/keys/values, and iteration (so spread and for..of
// work).
globalThis.NodeList = class NodeList {
  constructor() { this.length = 0; }
  item(i) { i = i >>> 0; return this[i] != null ? this[i] : null; }
  forEach(cb, thisArg) {
    for (let i = 0; i < this.length; i++) cb.call(thisArg, this[i], i, this);
  }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this[i]; }
  *entries() { for (let i = 0; i < this.length; i++) yield [i, this[i]]; }
  *keys() { for (let i = 0; i < this.length; i++) yield i; }
  *values() { for (let i = 0; i < this.length; i++) yield this[i]; }
  get [Symbol.toStringTag]() { return 'NodeList'; }
};
_markNative(NodeList);
_markNative(NodeList.prototype.item);
_markNative(NodeList.prototype.forEach);
// Live Range over the real DOM tree. dom/ranges/* tests are pure boundary-point
// algorithms (no layout, no editing engine), so a property-storing Range with
// correct tree-order comparison passes them. Mutating ops (extract/delete/
// insert/surround) are kept minimal: they do not throw, but do not rewrite the
// tree (that is the editing mega-bucket, out of scope).
function _rngNodeLength(n) {
  const t = n.nodeType;
  if (t === 3 || t === 4 || t === 8 || t === 7) return (n.data || n.nodeValue || "").length;
  return n.childNodes.length;
}
// Index among siblings, computed in Rust (one op) instead of serializing the
// whole childNodes list per call: the Range matrices call this heavily.
function _rngNodeIndex(n) {
  if (!n.parentNode) return 0;
  return +_dom("node_index", n._nid);
}
function _rngSame(a, b) { return a === b || (!!a && !!b && a._nid === b._nid); }
// Root nid in one op (callers only read ._nid), instead of an O(depth) walk.
function _rngRoot(n) { return { _nid: +_dom("node_root", n._nid) }; }
function _rngAncestors(n) { const a = []; let c = n; while (c) { a.push(c); c = c.parentNode; } return a; }
// document (preorder) tree order: -1 if a precedes b, 1 if a follows b, 0 same.
// Computed in Rust (one op) rather than walking ancestor chains over per-step
// DOM ops, which made the large dom/ranges matrices time out.
function _rngOrder(a, b) {
  if (_rngSame(a, b)) return 0;
  return +_dom("compare_order", a._nid, b._nid) || 0;
}
// Position of (nA,oA) relative to (nB,oB): -1 before, 0 equal, 1 after.
function _rngCmp(nA, oA, nB, oB) {
  if (_rngSame(nA, nB)) return oA < oB ? -1 : (oA > oB ? 1 : 0);
  if (_rngOrder(nA, nB) > 0) return -_rngCmp(nB, oB, nA, oA);
  if (nA.contains && nA.contains(nB)) { // nA is a strict ancestor of nB
    let child = nB;
    while (child && child.parentNode && child.parentNode._nid !== nA._nid) child = child.parentNode;
    if (child && child.parentNode && child.parentNode._nid === nA._nid && _rngNodeIndex(child) < oA) return 1;
    return -1;
  }
  return -1;
}
function _rngCheckOffset(n, o) {
  if (n && n.nodeType === 10) throw new DOMException("Range boundary cannot be a DocumentType", "InvalidNodeTypeError");
  if (o < 0 || o > _rngNodeLength(n)) throw new DOMException("Range offset out of bounds", "IndexSizeError");
}
globalThis.Range = class Range {
  constructor() {
    const d = globalThis.document || null;
    this._sc = d; this._so = 0; this._ec = d; this._eo = 0;
  }
  get startContainer() { return this._sc; }
  get startOffset() { return this._so; }
  get endContainer() { return this._ec; }
  get endOffset() { return this._eo; }
  get collapsed() { return _rngSame(this._sc, this._ec) && this._so === this._eo; }
  get commonAncestorContainer() {
    if (!this._sc || !this._ec) return null;
    const setA = new Set(_rngAncestors(this._sc).map(n => n._nid));
    let c = this._ec;
    while (c) { if (setA.has(c._nid)) return c; c = c.parentNode; }
    return null;
  }
  setStart(n, o) { _rngCheckOffset(n, o); this._sc = n; this._so = o; if (_rngRoot(n)._nid !== _rngRoot(this._ec)._nid || _rngCmp(this._sc, this._so, this._ec, this._eo) > 0) { this._ec = n; this._eo = o; } }
  setEnd(n, o) { _rngCheckOffset(n, o); this._ec = n; this._eo = o; if (_rngRoot(n)._nid !== _rngRoot(this._sc)._nid || _rngCmp(this._sc, this._so, this._ec, this._eo) > 0) { this._sc = n; this._so = o; } }
  setStartBefore(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setStart(p, _rngNodeIndex(n)); }
  setStartAfter(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setStart(p, _rngNodeIndex(n) + 1); }
  setEndBefore(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setEnd(p, _rngNodeIndex(n)); }
  setEndAfter(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); this.setEnd(p, _rngNodeIndex(n) + 1); }
  collapse(toStart) { if (toStart) { this._ec = this._sc; this._eo = this._so; } else { this._sc = this._ec; this._so = this._eo; } }
  selectNode(n) { const p = n.parentNode; if (!p) throw new DOMException("node has no parent", "InvalidNodeTypeError"); const i = _rngNodeIndex(n); this._sc = p; this._so = i; this._ec = p; this._eo = i + 1; }
  selectNodeContents(n) { if (n && n.nodeType === 10) throw new DOMException("cannot select a DocumentType", "InvalidNodeTypeError"); const len = _rngNodeLength(n); this._sc = n; this._so = 0; this._ec = n; this._eo = len; }
  comparePoint(n, o) {
    o = o >>> 0; // offset is a WebIDL unsigned long: -1 -> 4294967295 -> IndexSizeError
    if (_rngRoot(n)._nid !== _rngRoot(this._sc)._nid) throw new DOMException("nodes are in different trees", "WrongDocumentError");
    if (n.nodeType === 10) throw new DOMException("node is a DocumentType", "InvalidNodeTypeError");
    if (o > _rngNodeLength(n)) throw new DOMException("offset out of bounds", "IndexSizeError");
    if (_rngCmp(n, o, this._sc, this._so) < 0) return -1;
    if (_rngCmp(n, o, this._ec, this._eo) > 0) return 1;
    return 0;
  }
  isPointInRange(n, o) {
    o = o >>> 0;
    if (!this._sc || _rngRoot(n)._nid !== _rngRoot(this._sc)._nid) return false;
    if (n.nodeType === 10) throw new DOMException("node is a DocumentType", "InvalidNodeTypeError");
    if (o > _rngNodeLength(n)) throw new DOMException("offset out of bounds", "IndexSizeError");
    return _rngCmp(n, o, this._sc, this._so) >= 0 && _rngCmp(n, o, this._ec, this._eo) <= 0;
  }
  compareBoundaryPoints(how, other) {
    // `how` is a WebIDL `unsigned short`: ToUint16-convert before validating,
    // so NaN/Infinity become 0 (START_TO_START) rather than throwing.
    let h = Math.trunc(Number(how));
    if (!Number.isFinite(h)) h = 0;
    h = ((h % 65536) + 65536) % 65536;
    let a, b;
    switch (h) {
      case 0: a = [this._sc, this._so]; b = [other._sc, other._so]; break; // START_TO_START
      case 1: a = [this._ec, this._eo]; b = [other._sc, other._so]; break; // START_TO_END
      case 2: a = [this._ec, this._eo]; b = [other._ec, other._eo]; break; // END_TO_END
      case 3: a = [this._sc, this._so]; b = [other._ec, other._eo]; break; // END_TO_START
      default: throw new DOMException("invalid comparison type", "NotSupportedError");
    }
    // Different roots -> WrongDocumentError. Guard so a null/foreign container
    // raises that DOMException rather than a raw TypeError from _rngRoot.
    let differ;
    try { differ = _rngRoot(a[0])._nid !== _rngRoot(b[0])._nid; }
    catch (e) { differ = true; }
    if (differ) throw new DOMException("The two Ranges are not in the same tree.", "WrongDocumentError");
    return _rngCmp(a[0], a[1], b[0], b[1]);
  }
  intersectsNode(n) {
    if (_rngRoot(n)._nid !== _rngRoot(this._sc)._nid) return false;
    const p = n.parentNode;
    if (!p) return true;
    const o = _rngNodeIndex(n);
    return _rngCmp(p, o, this._ec, this._eo) < 0 && _rngCmp(p, o + 1, this._sc, this._so) > 0;
  }
  cloneRange() { const r = new Range(); r._sc = this._sc; r._so = this._so; r._ec = this._ec; r._eo = this._eo; return r; }
  createContextualFragment(html) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'createContextualFragment' on 'Range': 1 argument required, but only 0 present.");
    const node = this._sc;
    const ownerDoc = (node && node.ownerDocument) || globalThis.document;
    const frag = ownerDoc.createDocumentFragment();
    frag.innerHTML = String(html);
    return frag;
  }
  toString() {
    const sc = this._sc, ec = this._ec;
    if (!sc) return "";
    if (_rngSame(sc, ec) && (sc.nodeType === 3 || sc.nodeType === 4)) return (sc.data || "").slice(this._so, this._eo);
    let s = "";
    if (sc.nodeType === 3 || sc.nodeType === 4) s += (sc.data || "").slice(this._so);
    const cac = this.commonAncestorContainer;
    if (cac) {
      const walk = (node) => {
        if (node.nodeType === 3 || node.nodeType === 4) {
          if (!_rngSame(node, sc) && !_rngSame(node, ec) &&
              _rngCmp(node, 0, this._sc, this._so) >= 0 && _rngCmp(node, _rngNodeLength(node), this._ec, this._eo) <= 0) {
            s += (node.data || "");
          }
        }
        const kids = node.childNodes;
        for (let i = 0; i < kids.length; i++) if (kids[i]) walk(kids[i]);
      };
      walk(cac);
    }
    if (!_rngSame(sc, ec) && (ec.nodeType === 3 || ec.nodeType === 4)) s += (ec.data || "").slice(0, this._eo);
    return s;
  }
  cloneContents() { return (globalThis.document || document).createDocumentFragment(); }
  extractContents() { return (globalThis.document || document).createDocumentFragment(); }
  deleteContents() {}
  insertNode(node) { if (node && this._sc && this._sc.insertBefore) { const kids = this._sc.childNodes; this._sc.insertBefore(node, kids[this._so] || null); } }
  surroundContents(node) { this.insertNode(node); }
  detach() {}
  getBoundingClientRect() {
    if (this.collapsed) return new DOMRect();
    let cac = this.commonAncestorContainer;
    while (cac && cac.nodeType !== 1 && cac.nodeType !== 9) cac = cac.parentNode;
    if (cac && cac.getBoundingClientRect) {
      const r = cac.getBoundingClientRect();
      return new DOMRect(r.x, r.y, r.width, r.height);
    }
    return new DOMRect();
  }
  getClientRects() {
    if (this.collapsed) return new DOMRectList([]);
    return new DOMRectList([this.getBoundingClientRect()]);
  }
  static get START_TO_START() { return 0; }
  static get START_TO_END() { return 1; }
  static get END_TO_END() { return 2; }
  static get END_TO_START() { return 3; }
};
Object.assign(globalThis.Range.prototype, { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 });
globalThis.StaticRange = class StaticRange {
  constructor(init) {
    if (!init || init.startContainer == null || init.endContainer == null)
      throw new TypeError("Failed to construct 'StaticRange': required members are undefined");
    const sc = init.startContainer, ec = init.endContainer;
    if (sc.nodeType === 10 || ec.nodeType === 10 || sc.nodeType === 7 || ec.nodeType === 7)
      throw new DOMException("StaticRange endpoints cannot be DocumentType or ProcessingInstruction", "InvalidNodeTypeError");
    this._sc = sc; this._so = init.startOffset >>> 0; this._ec = ec; this._eo = init.endOffset >>> 0;
  }
  get startContainer() { return this._sc; }
  get startOffset() { return this._so; }
  get endContainer() { return this._ec; }
  get endOffset() { return this._eo; }
  get collapsed() { return _rngSame(this._sc, this._ec) && this._so === this._eo; }
};
// Live Selection over the real Range: at most one range + a direction, one
// instance per document. Everything except modify() (needs visual line/word
// layout) is layout-free, built on the Range boundary-point helpers above.
globalThis.Selection = class Selection {
  constructor(doc) { this._doc = doc; this._range = null; this._direction = 'none'; }
  _setRange(r, dir) { this._range = r; this._direction = dir; }
  _inDoc(node) { return !!(node && this._doc && this._doc.contains && this._doc.contains(node)); }
  get rangeCount() { return this._range ? 1 : 0; }
  get isCollapsed() { return !this._range || this._range.collapsed; }
  get type() { return !this._range ? 'None' : (this._range.collapsed ? 'Caret' : 'Range'); }
  get _anchor() { const r = this._range; if (!r) return null; return this._direction === 'backwards' ? [r.endContainer, r.endOffset] : [r.startContainer, r.startOffset]; }
  get _focus() { const r = this._range; if (!r) return null; return this._direction === 'backwards' ? [r.startContainer, r.startOffset] : [r.endContainer, r.endOffset]; }
  get anchorNode() { return this._anchor ? this._anchor[0] : null; }
  get anchorOffset() { return this._anchor ? this._anchor[1] : 0; }
  get focusNode() { return this._focus ? this._focus[0] : null; }
  get focusOffset() { return this._focus ? this._focus[1] : 0; }
  getRangeAt(i) { i = +i; if (!this._range || i < 0 || i > 0) throw new DOMException('The index provided is out of range.', 'IndexSizeError'); return this._range; }
  addRange(range) { if (this._range) return; if (!(range instanceof Range)) return; if (!this._inDoc(range.startContainer) || !this._inDoc(range.endContainer)) return; this._setRange(range, 'forwards'); }
  removeRange(range) { if (!(range instanceof Range)) throw new TypeError("Failed to execute 'removeRange' on 'Selection': parameter 1 is not a Range."); if (this._range === range) this._setRange(null, 'none'); else throw new DOMException('The range was not found.', 'NotFoundError'); }
  removeAllRanges() { this._setRange(null, 'none'); }
  empty() { this.removeAllRanges(); }
  collapse(node, offset) { if (node == null) { this.removeAllRanges(); return; } offset = offset >>> 0; _rngCheckOffset(node, offset); if (!this._inDoc(node)) return; const r = new Range(); r.setStart(node, offset); r.setEnd(node, offset); this._setRange(r, 'forwards'); }
  setPosition(node, offset) { this.collapse(node, offset); }
  collapseToStart() { if (!this._range) throw new DOMException('There is no selection to collapse.', 'InvalidStateError'); const r = new Range(); r.setStart(this._range.startContainer, this._range.startOffset); r.setEnd(this._range.startContainer, this._range.startOffset); this._setRange(r, 'forwards'); }
  collapseToEnd() { if (!this._range) throw new DOMException('There is no selection to collapse.', 'InvalidStateError'); const r = new Range(); r.setStart(this._range.endContainer, this._range.endOffset); r.setEnd(this._range.endContainer, this._range.endOffset); this._setRange(r, 'forwards'); }
  extend(node, offset) { if (!this._range) throw new DOMException('There is no selection to extend.', 'InvalidStateError'); if (!this._inDoc(node)) return; offset = offset >>> 0; _rngCheckOffset(node, offset); const a = this._anchor; const r = new Range(); if (_rngRoot(node)._nid !== _rngRoot(a[0])._nid) { r.setStart(node, offset); r.setEnd(node, offset); this._setRange(r, 'forwards'); return; } if (_rngCmp(a[0], a[1], node, offset) <= 0) { r.setStart(a[0], a[1]); r.setEnd(node, offset); this._setRange(r, 'forwards'); } else { r.setStart(node, offset); r.setEnd(a[0], a[1]); this._setRange(r, 'backwards'); } }
  setBaseAndExtent(aN, aO, fN, fO) { if (arguments.length < 4) throw new TypeError("Failed to execute 'setBaseAndExtent' on 'Selection': 4 arguments required."); if (aN == null || fN == null) throw new TypeError("Failed to execute 'setBaseAndExtent' on 'Selection': nodes must not be null."); aO = +aO; fO = +fO; if (aO < 0 || aO > _rngNodeLength(aN)) throw new DOMException('anchor offset out of range', 'IndexSizeError'); if (fO < 0 || fO > _rngNodeLength(fN)) throw new DOMException('focus offset out of range', 'IndexSizeError'); if (!this._inDoc(aN) || !this._inDoc(fN)) { this.removeAllRanges(); return; } const r = new Range(); if (_rngCmp(aN, aO, fN, fO) <= 0) { r.setStart(aN, aO); r.setEnd(fN, fO); this._setRange(r, 'forwards'); } else { r.setStart(fN, fO); r.setEnd(aN, aO); this._setRange(r, 'backwards'); } }
  selectAllChildren(node) { if (node && node.nodeType === 10) throw new DOMException('cannot selectAllChildren of a DocumentType', 'InvalidNodeTypeError'); if (!this._inDoc(node)) return; const len = _rngNodeLength(node); const r = new Range(); r.setStart(node, 0); r.setEnd(node, len); this._setRange(r, 'forwards'); }
  containsNode(node, allowPartial) { const r = this._range; if (!r || !node) return false; if (_rngRoot(node)._nid !== _rngRoot(r.startContainer)._nid) return false; const len = _rngNodeLength(node); if (allowPartial) return _rngCmp(node, len, r.startContainer, r.startOffset) > 0 && _rngCmp(node, 0, r.endContainer, r.endOffset) < 0; return _rngCmp(node, 0, r.startContainer, r.startOffset) >= 0 && _rngCmp(node, len, r.endContainer, r.endOffset) <= 0; }
  deleteFromDocument() { if (this._range) this._range.deleteContents(); }
  toString() { return this._range ? this._range.toString() : ''; }
  modify() {}
};
_markNative(globalThis.Selection);

[
  navigator.getBattery, navigator.getGamepads, navigator.sendBeacon,
  navigator.javaEnabled, navigator.geolocation?.getCurrentPosition,
  navigator.geolocation?.watchPosition,
  navigator.serviceWorker?.register,
  navigator.permissions?.query, navigator.credentials?.get,
  navigator.storage?.estimate, navigator.storage?.persist, navigator.storage?.persisted,
  globalThis.fetch, globalThis.matchMedia, globalThis.getComputedStyle,
  globalThis.getSelection, globalThis.requestAnimationFrame,
  globalThis.cancelAnimationFrame, globalThis.setTimeout, globalThis.clearTimeout,
  globalThis.setInterval, globalThis.clearInterval, globalThis.queueMicrotask,
  globalThis.structuredClone, globalThis.reportError,
  globalThis.btoa, globalThis.atob,
  console.log, console.warn, console.error, console.info, console.debug,
  console.dir, console.assert,
  Element.prototype.getAttribute, Element.prototype.setAttribute,
  Element.prototype.removeAttribute, Element.prototype.hasAttribute,
  Element.prototype.querySelector, Element.prototype.querySelectorAll,
  Element.prototype.getElementsByTagName, Element.prototype.getElementsByClassName,
  Element.prototype.matches, Element.prototype.closest,
  Element.prototype.getBoundingClientRect, Element.prototype.getClientRects,
  Element.prototype.checkVisibility,
  Element.prototype.addEventListener, Element.prototype.removeEventListener,
  Element.prototype.dispatchEvent, Element.prototype.click,
  Element.prototype.focus, Element.prototype.blur,
  Element.prototype.showPopover, Element.prototype.hidePopover, Element.prototype.togglePopover,
  Element.prototype.cloneNode, Element.prototype.attachShadow,
  Element.prototype.insertAdjacentHTML, Element.prototype.insertAdjacentText,
  Element.prototype.insertAdjacentElement, Element.prototype.scrollIntoView,
  Element.prototype.scrollTo, Element.prototype.scrollBy, Element.prototype.scroll,
  Element.prototype.append, Element.prototype.prepend, Element.prototype.remove,
  Element.prototype.before, Element.prototype.after, Element.prototype.replaceWith,
  HTMLFormElement.prototype.reset,
  Element.prototype.getContext, Element.prototype.toDataURL, Element.prototype.toBlob,
  Element.prototype.getBBox,
  Node.prototype.appendChild, Node.prototype.removeChild,
  Node.prototype.replaceChild, Node.prototype.insertBefore,
  Node.prototype.contains, Node.prototype.hasChildNodes, Node.prototype.cloneNode,
  CharacterData.prototype.before, CharacterData.prototype.after,
  CharacterData.prototype.replaceWith, CharacterData.prototype.remove,
  Document.prototype.getElementById, Document.prototype.querySelector,
  Document.prototype.querySelectorAll, Document.prototype.getElementsByTagName,
  Document.prototype.createElement, Document.prototype.createElementNS,
  Document.prototype.createTextNode, Document.prototype.createComment,
  Document.prototype.createCDATASection, Document.prototype.createProcessingInstruction,
  Document.prototype.createDocumentFragment, Document.prototype.createEvent,
  Document.prototype.hasFocus,
  Storage, Storage.prototype.getItem, Storage.prototype.setItem,
  Storage.prototype.removeItem, Storage.prototype.clear, Storage.prototype.key,
  Notification, Notification.requestPermission,
  window.chrome?.csi, window.chrome?.loadTimes,
  MutationObserver, ResizeObserver, IntersectionObserver, PerformanceObserver,
  XMLSerializer, XMLSerializer.prototype.serializeToString,
].forEach(fn => { if (typeof fn === 'function') _markNative(fn); });


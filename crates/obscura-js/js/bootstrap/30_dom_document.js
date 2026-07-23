class Document extends Node {
  get documentElement() { return _wrapEl(+_dom("document_element")); }
  get head() { return this.querySelector("head"); }
  get body() { return this.querySelector("body"); }
  get doctype() {
    if (this._doctype !== undefined) return this._doctype;
    const info = _domParse("document_doctype");
    if (info && info.name) {
      this._doctype = new DocumentType(info.nodeId, info.name, info.publicId || "", info.systemId || "");
    } else {
      this._doctype = null;
    }
    return this._doctype;
  }
  get title() { return _domParse("document_title") ?? ""; }
  set title(v) {}
  get URL() { return __currentUrl(); }
  get documentURI() { return this.URL; }
  get location() { return globalThis.location; }
  set location(url) { __obscura_core.ops.op_navigate(_resolveUrl(String(url)), 'GET', ''); }
  get defaultView() { return globalThis; }
  get nodeType() { return 9; }
  get nodeName() { return "#document"; }
  get ownerDocument() { return null; } // Document has no ownerDocument
  get compatMode() { return "CSS1Compat"; }
  // The document's character encoding, detected from the response charset
  // (HTTP Content-Type -> <meta charset>). characterSet/charset/inputEncoding
  // are WHATWG aliases. A node-less document (DOMParser/createDocument) has no
  // backing encoding and reports UTF-8.
  get characterSet() { return (this._nid === undefined || this._nid === null) ? "UTF-8" : _docEncoding(); }
  get charset() { return this.characterSet; }
  get inputEncoding() { return this.characterSet; }
  get contentType() {
    // An explicit type set by DOMParser/createDocument wins.
    if (this._contentType) return this._contentType;
    // `new Document()` (the WHATWG constructor, no backing node id) creates an
    // XML document, so createCDATASection/etc. must not throw. Live documents
    // wrapped from the tree carry a real nid and fall through to URL-derived.
    if (this._nid === undefined || this._nid === null) return "application/xml";
    const url = this.URL || "";
    // data: URLs carry their MIME type explicitly.
    const dm = /^data:([^,;]+)/i.exec(url);
    if (dm) {
      const mime = dm[1].toLowerCase();
      if (mime === "application/xhtml+xml") return "application/xhtml+xml";
      if (mime === "text/xml") return "text/xml";
      if (mime === "application/xml" || mime.endsWith("+xml")) return "application/xml";
    }
    if (/\.xhtml(?:[?#]|$)/i.test(url)) return "application/xhtml+xml";
    if (/\.(?:xml|svg)(?:[?#]|$)/i.test(url)) return "application/xml";
    return "text/html";
  }
  get readyState() { return globalThis.__documentReadyState__ || 'complete'; }
  get currentScript() {
    // Next.js / Turbopack chunk loader reads document.currentScript.src to
    // derive its base path. page.rs sets __currentScriptNid before each
    // <script> body runs and clears it after, mirroring real Chrome.
    const nid = globalThis.__currentScriptNid;
    return nid ? _wrapEl(+nid) : null;
  }
  get hidden() { return false; }
  get visibilityState() { return "visible"; }
  getElementById(id) { return _wrapEl(+_dom("get_element_by_id", id)); }
  querySelector(s) { return _wrapEl(+_dom("query_selector", s)); }
  querySelectorAll(s) {
    const ids = _domParse("query_selector_all", s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  getElementsByTagName(t) { return HTMLCollection._from(this.querySelectorAll(t)); }
  getElementsByClassName(c) { return _getElementsByClassName(this, c); }
  getElementsByName(name) { return this.querySelectorAll('[name="' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]'); }
  evaluate(expression, contextNode, namespaceResolver, type, result) {
    return _makeXPathResult(type, _xpathFindNodes(expression, contextNode || this));
  }
  createElement(t) {
    const el = _wrapEl(+_dom("create_element", t.toLowerCase()));
    if (el && t.toLowerCase() === 'template') {
      el._templateContent = this.createDocumentFragment();
    }
    return el;
  }
  createElementNS(ns, t) {
    const el = this.createElement(t);
    if (el) el._ns = ns;
    return el;
  }
  createTextNode(t) { return _wrap(+_dom("create_text_node", String(t))); }
  createComment(t) {
    const nid = +_dom("create_comment_node", String(t ?? ""));
    const n = new Comment(nid);
    _cache.set(nid, n);
    return n;
  }
  createCDATASection(data) {
    // Spec: throw NotSupportedError on an HTML document, reject data
    // containing "]]>", then return a CDATASection node.
    if (!_isXMLDocument(this)) {
      throw new DOMException("createCDATASection is not supported in HTML documents", "NotSupportedError");
    }
    const str = String(data);
    if (str.indexOf("]]>") !== -1) {
      throw new DOMException("CDATA section data must not contain ']]>'", "InvalidCharacterError");
    }
    const nid = +_dom("create_text_node", str);
    const n = new CDATASection(nid);
    _cache.set(nid, n);
    return n;
  }
  createProcessingInstruction(target, data) {
    // Spec: not gated on document type. Reject targets that are not an XML
    // Name, then reject data containing "?>", then return a PI node.
    const tgt = String(target);
    const str = String(data);
    if (!_isValidPITarget(tgt)) {
      throw new DOMException("Invalid processing instruction target", "InvalidCharacterError");
    }
    if (str.indexOf("?>") !== -1) {
      throw new DOMException("Processing instruction data must not contain '?>'", "InvalidCharacterError");
    }
    const nid = +_dom("create_text_node", str);
    const n = new ProcessingInstruction(nid, tgt);
    _cache.set(nid, n);
    return n;
  }
  createDocumentFragment() {
    const nid = +_dom("create_document_fragment");
    const frag = new DocumentFragment(nid);
    _cache.set(nid, frag);
    return frag;
  }
  // Legacy DOM Level 2 event factory. Spec returns an event of the requested
  // class with an empty type until init*Event() is called. We previously
  // returned a generic Event for every type, which broke libraries that call
  // createEvent('CustomEvent').initCustomEvent(...) — see issue #41.
  createEvent(type) {
    const map = {
      'customevent': CustomEvent, 'customevents': CustomEvent,
      'mouseevent': MouseEvent,   'mouseevents': MouseEvent,
      'keyboardevent': KeyboardEvent, 'keyboardevents': KeyboardEvent,
      'focusevent': FocusEvent,
      'inputevent': InputEvent,
      'uievent': UIEvent, 'uievents': UIEvent,
      'compositionevent': CompositionEvent,
      'wheelevent': WheelEvent,
      'pointerevent': PointerEvent,
      'errorevent': ErrorEvent,
      'popstateevent': PopStateEvent,
      'animationevent': AnimationEvent,
      'transitionevent': TransitionEvent,
    };
    const Cls = map[String(type || '').toLowerCase()] || Event;
    return new Cls('');
  }
  createRange() { return new Range(); }
  addEventListener(type, fn, opts) {
    if (typeof fn !== 'function') return;
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    if (!this._listeners[type].includes(fn)) this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners?.[type]) {
      this._listeners[type] = this._listeners[type].filter(h => h !== fn);
    }
  }
  dispatchEvent(event) {
    if (!event) return true;
    const handlers = (this._listeners?.[event.type] || []).slice();
    for (const h of handlers) { try { h.call(this, event); } catch(e) { console.error('document event error:', e); } }
    return !event.defaultPrevented;
  }
  createTreeWalker(root, whatToShow, filter) {
    // whatToShow is unsigned long; default SHOW_ALL only when the arg is omitted.
    // An explicit 0 (show nothing) must stay 0, not become SHOW_ALL.
    whatToShow = (whatToShow === undefined) ? 0xFFFFFFFF : (whatToShow >>> 0);
    const walker = {
      root: root,
      currentNode: root,
      whatToShow: whatToShow,
      filter: filter || null,
      // Three-valued per NodeFilter: 1 ACCEPT, 2 REJECT, 3 SKIP. REJECT and
      // SKIP both mean "don't return this node", but only REJECT prunes its
      // descendants, so nextNode() needs to tell them apart (issue #461).
      // A node filtered out by whatToShow is a SKIP: the spec never consults
      // the filter for it, and its descendants stay eligible.
      _filter(node) {
        const nodeType = node.nodeType;
        if (!((whatToShow >> (nodeType - 1)) & 1)) return 3;
        if (this.filter) {
          if (typeof this.filter === 'function') return this.filter(node);
          if (this.filter.acceptNode) return this.filter.acceptNode(node);
        }
        return 1;
      },
      _accept(node) { return this._filter(node) === 1; },
      nextNode() {
        let node = _wrap(+_dom("next_in_subtree", this.root._nid, this.currentNode._nid));
        while (node) {
          const verdict = this._filter(node);
          if (verdict === 1) { this.currentNode = node; return node; }
          // FILTER_REJECT skips the node AND its subtree; FILTER_SKIP (and any
          // other non-accept value) skips only the node. NodeIterator has no
          // pruning at all, so `_rejectIsSkip` keeps it on the plain step.
          const step = (verdict === 2 && !this._rejectIsSkip)
            ? "next_after_subtree"
            : "next_in_subtree";
          node = _wrap(+_dom(step, this.root._nid, node._nid));
        }
        return null;
      },
      // DOM 6.1 "previousNode", implemented as specified (issue #462). The old
      // version looked at exactly one candidate — the previous sibling's
      // deepest last child — and returned null the moment it was filtered out,
      // so a backward walk died mid-tree the way nextNode used to before #432.
      //
      // Unlike nextNode this stays in JS rather than using a DOM traversal op:
      // the descent into last children has to stop on FILTER_REJECT, so the
      // filter is consulted at every step anyway and there is no run of
      // crossings for a native helper to collapse.
      previousNode() {
        let node = this.currentNode;
        while (node !== this.root) {
          let sibling = node.previousSibling;
          while (sibling) {
            node = sibling;
            let verdict = this._filter(node);
            // Descend to the deepest last descendant, but never into a rejected
            // subtree — that is what makes REJECT prune backwards as well.
            while (verdict !== 2 && node.lastChild) {
              node = node.lastChild;
              verdict = this._filter(node);
            }
            if (verdict === 1) { this.currentNode = node; return node; }
            sibling = node.previousSibling;
          }
          const parent = node.parentNode;
          // Reaching root (or a detached node) ends the walk: root is never
          // returned by a backward traversal.
          if (!parent || node === this.root) return null;
          node = parent;
          if (node === this.root) return null;
          if (this._filter(node) === 1) { this.currentNode = node; return node; }
        }
        return null;
      },
      firstChild() {
        let child = this.currentNode.firstChild;
        while (child) {
          if (this._accept(child)) { this.currentNode = child; return child; }
          child = child.nextSibling;
        }
        return null;
      },
      lastChild() {
        let child = this.currentNode.lastChild;
        while (child) {
          if (this._accept(child)) { this.currentNode = child; return child; }
          child = child.previousSibling;
        }
        return null;
      },
      nextSibling() {
        let sibling = this.currentNode.nextSibling;
        while (sibling) {
          if (this._accept(sibling)) { this.currentNode = sibling; return sibling; }
          sibling = sibling.nextSibling;
        }
        return null;
      },
      previousSibling() {
        let sibling = this.currentNode.previousSibling;
        while (sibling) {
          if (this._accept(sibling)) { this.currentNode = sibling; return sibling; }
          sibling = sibling.previousSibling;
        }
        return null;
      },
      parentNode() {
        let parent = this.currentNode.parentNode;
        if (parent && parent !== this.root && this._accept(parent)) {
          this.currentNode = parent;
          return parent;
        }
        return null;
      },
    };
    return walker;
  }
  createNodeIterator(root, whatToShow, filter) {
    // Shares the TreeWalker implementation, but DOM 6.2 gives NodeIterator no
    // subtree pruning: FILTER_REJECT behaves exactly as FILTER_SKIP there.
    const iterator = this.createTreeWalker(root, whatToShow, filter);
    iterator._rejectIsSkip = true;
    return iterator;
  }
  getSelection() { return this.defaultView ? _selectionFor(this) : null; }
  get activeElement() { return globalThis.__obscura_focused || this.body; }
  get implementation() {
    const ownerDoc = this;
    return {
      // Spec: createHTMLDocument returns a NEW detached Document. jQuery
      // 3.x's selector feature-detect calls `body.innerHTML = '<form>'` on
      // the result — when we returned `globalThis.document`, the real
      // `<body>` was wiped, taking every page on the open web that ships
      // jQuery 3.x with it. Reuse the DOMParser path to build a detached
      // document, then optionally set the title.
      createHTMLDocument(title) {
        // Build head>title and body explicitly. Parsing a full skeleton string
        // as innerHTML of <html> collapses through the fragment parser (it
        // dropped head/body and kept only <title>), leaving doc.body null.
        const doc = new DOMParser().parseFromString("", "text/html");
        const root = doc.documentElement;
        const head = document.createElement("head");
        const titleEl = document.createElement("title");
        if (title != null) titleEl.textContent = String(title);
        head.appendChild(titleEl);
        const body = document.createElement("body");
        root.appendChild(head);
        root.appendChild(body);
        return doc;
      },
      // Real spec: createDocument(namespaceURI, qualifiedName, doctype) →
      // an XML document with a root element of the given name. We don't
      // have a separate XML stack, so return a minimal detached document
      // with an element of the requested local name as documentElement.
      createDocument(_ns, qualifiedName, _doctype) {
        const name = (qualifiedName && String(qualifiedName)) || "root";
        const safe = name.replace(/[^a-zA-Z0-9-]/g, "");
        const html = qualifiedName ? `<${safe}></${safe}>` : "";
        const doc = new DOMParser().parseFromString(html, "application/xml");
        if (_doctype) doc._docType = _doctype;
        return doc;
      },
      // createDocumentType(qualifiedName, publicId, systemId): build a detached
      // DocumentType node. Browsers validate leniently here (only a name with
      // ASCII whitespace or ">" is rejected, matching the WPT cases); the node's
      // owner document is the document whose implementation was used.
      createDocumentType(qualifiedName, publicId, systemId) {
        const name = String(qualifiedName);
        if (name === "" || /[\t\n\f\r >]/.test(name)) {
          throw new DOMException("The qualified name '" + name + "' contains an invalid character", "InvalidCharacterError");
        }
        const dt = new DocumentType(
          +_dom("create_comment_node", ""),
          name,
          publicId === undefined ? "" : String(publicId),
          systemId === undefined ? "" : String(systemId)
        );
        dt._ownerDocument = ownerDoc;
        return dt;
      },
      hasFeature() { return true; },
    };
  }
  get styleSheets() { return []; }
  get forms() { return this.querySelectorAll("form"); }
  get images() { return this.querySelectorAll("img"); }
  get links() { return this.querySelectorAll("a[href], area[href]"); }
  get scripts() { return this.querySelectorAll("script"); }
  get cookie() {
    return __obscura_core.ops.op_get_cookies();
  }
  set cookie(v) {
    if (!v) return;
    __obscura_core.ops.op_set_cookie(v);
  }
  write(...args) {
    var html = args.join('');
    if (!html) return;
    var body = this.body;
    if (!body) return;
    var temp = this.createElement('div');
    temp.innerHTML = html;
    var children = temp.childNodes;
    for (var i = 0; i < children.length; i++) {
      body.appendChild(children[i]);
    }
  }
  writeln(...args) {
    this.write(args.join('') + '\n');
  }
  open() {
    var body = this.body;
    if (body) body.innerHTML = '';
    return this;
  }
  close() {
    return;
  }
  hasFocus() { return true; }
  execCommand() { return false; }
}

class DocumentFragment extends Node {
  constructor(nid) {
    super(nid !== undefined ? nid : +_dom("create_document_fragment"));
  }
  get nodeType() { return 11; }
  get nodeName() { return "#document-fragment"; }
  get innerHTML() { return _domParse("inner_html", this._nid) ?? ""; }
  set innerHTML(v) { _dom("set_inner_html", this._nid, String(v ?? "")); }
  querySelector(s) { return _wrapEl(+_dom("query_selector_scoped", this._nid, s)); }
  querySelectorAll(s) {
    const ids = _domParse("query_selector_all_scoped", this._nid, s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  get children() {
    const ids = _domParse("element_children", this._nid) || [];
    return HTMLCollection._from(ids.map(_wrapEl).filter(Boolean));
  }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const ch = this.children; return ch[ch.length - 1] || null; }
  getElementById(id) {
    const needle = String(id);
    const stack = Array.from(this.childNodes || []).reverse();
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 1 && node.id === needle) return node;
      const children = node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return null;
  }
  cloneNode(deep) {
    const frag = document.createDocumentFragment();
    if (deep) frag.innerHTML = this.innerHTML;
    return frag;
  }
}

class DocumentType extends Node {
  constructor(nid, name, publicId, systemId) {
    super(nid);
    this._name = name;
    this._publicId = publicId;
    this._systemId = systemId;
  }
  get nodeType() { return 10; }
  get nodeName() { return this._name; }
  get name() { return this._name; }
  get publicId() { return this._publicId; }
  get systemId() { return this._systemId; }
  get nodeValue() { return null; }
  set nodeValue(v) {}
  get ownerDocument() { return this._ownerDocument || globalThis.document; }
}

const _cache = new Map();

// Media elements need canPlayType for codec detection fingerprinting.
// Values match Chrome 145 on Linux x86_64 without proprietary codecs.
class HTMLMediaElement extends Element {
  canPlayType(type) {
    if (!type || typeof type !== 'string') return '';
    const mime = type.split(';')[0].trim().toLowerCase();
    if (mime === 'video/mp4' || mime === 'video/webm' || mime === 'video/ogg') return 'probably';
    if (mime === 'video/x-matroska') return 'maybe';
    if (mime === 'audio/ogg' || mime === 'audio/webm' || mime === 'audio/wav' ||
        mime === 'audio/mpeg') return 'probably';
    if (mime === 'audio/mp4' || mime === 'audio/x-m4a' || mime === 'audio/aac') return 'maybe';
    return '';
  }
  load() {}
  play() { return Promise.resolve(); }
  pause() {}
  get paused() { return true; }
  get ended() { return false; }
  get readyState() { return 0; }
  get currentTime() { return 0; }
  set currentTime(v) {}
  get duration() { return NaN; }
  get volume() { return 1; }
  set volume(v) {}
  get muted() { return false; }
  set muted(v) {}
  get src() { return this.getAttribute('src') || ''; }
  set src(v) { this.setAttribute('src', v); }
}
_markNative(HTMLMediaElement.prototype.canPlayType);
_markNative(HTMLMediaElement.prototype.play);
_markNative(HTMLMediaElement.prototype.load);
_markNative(HTMLMediaElement.prototype.pause);
class HTMLVideoElement extends HTMLMediaElement {}
class HTMLAudioElement extends HTMLMediaElement {}
globalThis.HTMLMediaElement = HTMLMediaElement;
globalThis.HTMLVideoElement = HTMLVideoElement;
globalThis.HTMLAudioElement = HTMLAudioElement;

function _elementClassFor(nid) {
  const tag = _domParse("tag_name", nid);
  if (tag === "FORM" && globalThis.HTMLFormElement) return globalThis.HTMLFormElement;
  if (tag === "AUDIO") return HTMLAudioElement;
  if (tag === "VIDEO") return HTMLVideoElement;
  return Element;
}
function _wrap(nid) {
  if (nid < 0 || nid === null || nid === undefined || isNaN(nid)) return null;
  if (_cache.has(nid)) return _cache.get(nid);
  const t = +_dom("node_type", nid);
  let n;
  if (t === 1) { const C = _elementClassFor(nid); n = new C(nid); }
  else if (t === 3) n = new Text(nid);
  else if (t === 8) n = new Comment(nid);
  else if (t === 9) n = new Document(nid);
  else n = new Node(nid);
  _cache.set(nid, n);
  return n;
}
function _wrapEl(nid) {
  if (nid < 0 || nid === null || nid === undefined || isNaN(nid)) return null;
  if (_cache.has(nid)) return _cache.get(nid);
  const C = _elementClassFor(nid);
  const n = new C(nid);
  _cache.set(nid, n);
  return n;
}

globalThis._wrap = _wrap;
globalThis.self = globalThis;

globalThis.document = null;
function _resolveUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:')) return url;
  try { return new URL(url, _domParse("document_url") || "about:blank").href; } catch(e) { return url; }
}
// `__virtualUrl` is set by `history.pushState`/`replaceState` (and cleared by
// any real navigation). When set, `location.href` and friends read it instead
// of the underlying `document_url`. Without this, client-side routers
// (Next.js, React Router, vue-router) call `pushState` but the URL never
// changes, so their `useLocation` hooks return the wrong path and the UI
// freezes on the original route.
globalThis.__virtualUrl = null;
function __currentUrl() {
  return globalThis.__virtualUrl || _domParse("document_url") || "about:blank";
}
globalThis.location = {
  get href() { return __currentUrl(); },
  set href(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; __obscura_core.ops.op_navigate(r, 'GET', ''); },
  get origin() { try { return new URL(this.href).origin; } catch { return ""; } },
  get protocol() { try { return new URL(this.href).protocol; } catch { return ""; } },
  get host() { try { return new URL(this.href).host; } catch { return ""; } },
  get hostname() { try { return new URL(this.href).hostname; } catch { return ""; } },
  get pathname() { try { return new URL(this.href).pathname; } catch { return "/"; } },
  get search() { try { return new URL(this.href).search; } catch { return ""; } },
  get hash() { try { return new URL(this.href).hash; } catch { return ""; } },
  get port() { try { return new URL(this.href).port; } catch { return ""; } },
  toString() { return this.href; },
  assign(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; __obscura_core.ops.op_navigate(r, 'GET', ''); },
  reload() { var r = _resolveUrl(this.href); globalThis.__virtualUrl = r; __obscura_core.ops.op_navigate(r, 'GET', ''); },
  replace(url) { var r = _resolveUrl(url); globalThis.__virtualUrl = r; __obscura_core.ops.op_navigate(r, 'GET', ''); },
};
const _locationObj = globalThis.location;
Object.defineProperty(globalThis, 'location', {
  get() { return _locationObj; },
  set(url) { var r = _resolveUrl(String(url)); globalThis.__virtualUrl = r; __obscura_core.ops.op_navigate(r, 'GET', ''); },
  configurable: false,
  enumerable: true,
});

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
globalThis.parent = globalThis;
globalThis.frames = globalThis;
globalThis.frameElement = null;
globalThis.length = 0;

// HTML spec exposes on* event handler IDL attributes via the GlobalEventHandlers
// mixin on Window, Document, and HTMLElement. Libraries feature-detect the modern
// event path through these: jQuery checks `("on" + ev) in window`, and React
// decides whether the `input` event is supported via `("oninput" in document)`.
// When that check fails React falls back to a legacy change-detection path that
// never fires onChange for controlled inputs (issue #324). Initialising these to
// null on all three targets makes the checks match real browsers. On Document and
// Element they are non-enumerable so they don't surface in `for..in` over nodes.
for (const _ev of [
  "abort","beforeprint","beforeunload","blur","cancel","canplay","canplaythrough",
  "change","click","close","contextmenu","cuechange","dblclick","drag","dragend",
  "dragenter","dragleave","dragover","dragstart","drop","durationchange","emptied",
  "ended","error","focus","focusin","focusout","formdata","gotpointercapture",
  "hashchange","input","invalid","keydown","keypress","keyup","languagechange",
  "load","loadeddata","loadedmetadata","loadstart","lostpointercapture","message",
  "mousedown","mouseenter","mouseleave","mousemove","mouseout","mouseover","mouseup",
  "offline","online","pagehide","pageshow","paste","pause","play","playing",
  "pointercancel","pointerdown","pointerenter","pointerleave","pointermove",
  "pointerout","pointerover","pointerup","popstate","progress","ratechange",
  "rejectionhandled","reset","resize","scroll","seeked","seeking","select",
  "stalled","storage","submit","suspend","timeupdate","toggle","unhandledrejection",
  "unload","volumechange","waiting","wheel",
]) {
  const _on = "on" + _ev;
  if (!(_on in globalThis)) globalThis[_on] = null;
  for (const _proto of [Document.prototype, Element.prototype]) {
    if (!(_on in _proto)) {
      Object.defineProperty(_proto, _on, { value: null, writable: true, configurable: true, enumerable: false });
    }
  }
}

globalThis.Window = globalThis.Window || function Window() {};
Object.defineProperty(globalThis.Window, Symbol.hasInstance, {
  value(obj) { return obj === globalThis || (obj && obj.window === obj); },
  configurable: true,
});


// Remove the static _iframeRegistry and replace with dynamic getters.
Object.defineProperty(globalThis, 'length', {
  get() {
    return document.querySelectorAll('iframe').length;
  },
  configurable: true,
  enumerable: true
});

// Since we cannot define a Proxy on globalThis easily, we'll define a reasonable number of indexed getters.
for (let i = 0; i < 50; i++) {
  Object.defineProperty(globalThis, i, {
    get() {
      const iframes = document.querySelectorAll('iframe');
      if (i < iframes.length) {
        return iframes[i].contentWindow;
      }
      return undefined;
    },
    configurable: true,
    enumerable: false
  });
}

// Navigator constructor so that typeof Navigator !== 'undefined' and
// navigatorPrototype checks don't throw a ReferenceError.

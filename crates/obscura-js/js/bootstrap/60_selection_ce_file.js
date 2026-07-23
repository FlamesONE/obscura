function _selectionFor(doc) {
  if (!doc) return null;
  if (!doc._selection) doc._selection = new Selection(doc);
  return doc._selection;
}
globalThis.getSelection = _markNative(function getSelection() {
  return _selectionFor(globalThis.document);
});

globalThis.CSSStyleSheet = class CSSStyleSheet {
  constructor(options) {
    this.cssRules = [];
    this.ownerRule = null;
    this.disabled = false;
    this._rules = [];
  }
  insertRule(rule, index) {
    const idx = index ?? this._rules.length;
    this._rules.splice(idx, 0, { cssText: rule, type: 1 });
    this.cssRules = this._rules;
    return idx;
  }
  deleteRule(index) {
    this._rules.splice(index, 1);
    this.cssRules = this._rules;
  }
  addRule(selector, style, index) {
    return this.insertRule(selector + '{' + style + '}', index);
  }
  removeRule(index) { this.deleteRule(index); }
  replace(text) {
    this._rules = [{ cssText: text, type: 1 }];
    this.cssRules = this._rules;
    return Promise.resolve(this);
  }
  replaceSync(text) {
    this._rules = [{ cssText: text, type: 1 }];
    this.cssRules = this._rules;
  }
};

Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
  get() { return this._adoptedStyleSheets || []; },
  set(sheets) { this._adoptedStyleSheets = sheets; },
});

globalThis.__mutationObservers = [];
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    this._callback = callback;
    this._targets = [];
    this._records = [];
  }
  observe(target, options) {
    this._targets.push({ target, options: options || {} });
    globalThis.__mutationObservers.push(this);
  }
  disconnect() {
    this._targets = [];
    const idx = globalThis.__mutationObservers.indexOf(this);
    if (idx >= 0) globalThis.__mutationObservers.splice(idx, 1);
  }
  takeRecords() {
    const r = this._records.slice();
    this._records = [];
    return r;
  }
  _notify(records) {
    this._records.push(...records);
    Promise.resolve().then(() => {
      if (this._records.length > 0) {
        const batch = this._records.splice(0);
        try { this._callback(batch, this); } catch(e) { /* observer errors shouldn't propagate */ }
      }
    });
  }
};
globalThis.__notifyMutation = function(type, target_nid, addedNodes, removedNodes, attributeName, oldValue) {
  if (!globalThis.__mutationObservers.length) return;
  // Use `_wrap` (the canonical node-id → wrapper resolver) instead of a
  // direct cache poke. The previous code referenced `globalThis._cache`,
  // but `_cache` is a module-local Map — the lookup always returned
  // undefined, so the function silently bailed every time. Result: no
  // MutationObserver fired in obscura, ever, despite the call sites being
  // wired up at appendChild / setAttribute. _wrap also lazily creates a
  // wrapper for nodes that didn't have one yet (e.g. children parsed from
  // `set innerHTML`), which we need for record.target/added/removed.
  const target = _wrap(target_nid);
  if (!target) return;
  const record = {
    type: type, // 'childList', 'attributes', 'characterData'
    target: target,
    addedNodes: (addedNodes || []).map(nid => _wrap(nid)).filter(Boolean),
    removedNodes: (removedNodes || []).map(nid => _wrap(nid)).filter(Boolean),
    attributeName: attributeName || null,
    oldValue: oldValue ?? null,
    previousSibling: null,
    nextSibling: null,
  };
  // Walk target → ancestors so a subtree-mode observer rooted at any
  // ancestor matches. The previous implementation just checked that
  // `target.contains` and `target.closest` were defined (always true on
  // any Element), so subtree=true silently behaved like subtree=false and
  // every nested mutation missed its subscriber.
  for (const obs of globalThis.__mutationObservers) {
    let matched = false;
    for (const t of obs._targets) {
      const root = t.target;
      if (!root) continue;
      // Filter by type per the observer options. Default behaviour matches
      // real MutationObserver: attribute mutations need options.attributes,
      // characterData mutations need options.characterData, childList
      // needs options.childList.
      const wantsType =
        (type === 'attributes' && t.options.attributes) ||
        (type === 'characterData' && t.options.characterData) ||
        (type === 'childList' && t.options.childList);
      if (!wantsType) continue;
      if (root._nid === target_nid) { matched = true; break; }
      if (t.options.subtree) {
        // Walk parents until we hit the observed root or run off the tree.
        let cur = target.parentNode;
        while (cur) {
          if (cur._nid === root._nid) { matched = true; break; }
          cur = cur.parentNode;
        }
        if (matched) break;
      }
    }
    if (matched) obs._notify([record]);
  }
};

globalThis.ShadowRoot = class ShadowRoot extends DocumentFragment {};
// Constructible-stylesheet adoption, mirroring Document.adoptedStyleSheets.
Object.defineProperty(globalThis.ShadowRoot.prototype, 'adoptedStyleSheets', {
  get() { return this._adoptedStyleSheets || []; },
  set(sheets) { this._adoptedStyleSheets = sheets; },
  configurable: true,
});
globalThis.__obscura_shadowHostNames = new Set(['article','aside','blockquote','body','div','footer','h1','h2','h3','h4','h5','h6','header','main','nav','p','section','span']);
function _isConstructorCE(v) {
  if (typeof v !== 'function') return false;
  try { Reflect.construct(function () {}, [], v); return true; } catch (e) { return false; }
}
const _CE_RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);
function _isValidCustomElementName(name) {
  if (typeof name !== 'string' || _CE_RESERVED.has(name)) return false;
  // PotentialCustomElementName (approx): lowercase start, a hyphen, no uppercase.
  return /^[a-z][a-z0-9._·À-￿-]*-[a-z0-9._·À-￿-]*$/.test(name);
}
class CustomElementRegistry {
  constructor() { this._registry = new Map(); this._byCtor = new Map(); this._whenDefinedResolvers = new Map(); this._defining = false; }
  define(name, cls, opts) {
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not a constructor.");
    if (!_isValidCustomElementName(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError");
    if (this._defining) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': operation is not supported while a definition is in progress", "NotSupportedError");
    if (this._registry.has(name)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the name \"" + name + "\" has already been used with this registry", "NotSupportedError");
    if (this._byCtor.has(cls)) throw new DOMException("Failed to execute 'define' on 'CustomElementRegistry': the constructor has already been used with this registry", "NotSupportedError");
    this._defining = true;
    try { this._byCtor.set(cls, name); this._defineInner(name, cls, opts); } finally { this._defining = false; }
  }
  _defineInner(name, cls, opts) {
    this._registry.set(name, cls);
    // Upgrade existing matching elements: instantiate the class on each,
    // fire connectedCallback if the element is in the document. Without
    // this, lit / MusicKit / Polymer components never wire up their
    // shadow DOM or render, leaving heavy chunks of YouTube,
    // music.apple.com, and any web-component site as empty shells.
    try {
      const matches = globalThis.document?.querySelectorAll(name) || [];
      for (const el of matches) this._upgradeElement(el, cls);
    } catch (e) {}
    const resolvers = this._whenDefinedResolvers.get(name);
    if (resolvers) {
      for (const r of resolvers) r(cls);
      this._whenDefinedResolvers.delete(name);
    }
  }
  _upgradeElement(el, cls) {
    if (el.__customUpgraded) return;
    el.__customUpgraded = true;
    try {
      // Web Components spec: copy own props from the prototype onto the
      // element. JS-side classes define behavior via methods on the
      // prototype; we don't truly swap prototypes (Element is shared),
      // so attach the prototype methods directly to the instance.
      const proto = cls.prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc) Object.defineProperty(el, key, desc);
      }
      // Run constructor-side init on the element. Real custom elements
      // run the class constructor, but Element instances aren't a `cls`
      // subclass here; calling `.call(el)` runs whatever init logic the
      // class defines without needing a new allocation.
      try { cls.call(el); } catch (e) {}
      if (typeof el.connectedCallback === 'function' && globalThis.document?.contains?.(el)) {
        try { el.connectedCallback(); } catch (e) {}
      }
    } catch (e) {}
  }
  get(name) { return this._registry.get(name); }
  getName(cls) {
    if (!_isConstructorCE(cls)) throw new TypeError("Failed to execute 'getName' on 'CustomElementRegistry': parameter 1 is not a constructor.");
    return this._byCtor.has(cls) ? this._byCtor.get(cls) : null;
  }
  whenDefined(name) {
    if (!_isValidCustomElementName(name)) return Promise.reject(new DOMException("Failed to execute 'whenDefined' on 'CustomElementRegistry': \"" + name + "\" is not a valid custom element name", "SyntaxError"));
    const cls = this._registry.get(name);
    if (cls) return Promise.resolve(cls);
    return new Promise((resolve) => {
      const list = this._whenDefinedResolvers.get(name) || [];
      list.push(resolve);
      this._whenDefinedResolvers.set(name, list);
    });
  }
  upgrade(root) {
    if (!root || !root.querySelectorAll) return;
    for (const [name, cls] of this._registry.entries()) {
      const matches = root.querySelectorAll(name);
      for (const el of matches) this._upgradeElement(el, cls);
    }
  }
}
globalThis.CustomElementRegistry = CustomElementRegistry;
globalThis.customElements = new CustomElementRegistry();
globalThis.HTMLUnknownElement = Element;
// ElementInternals: form-associated custom element internals. Validity/state
// are JS-observable; ARIA reflection that needs the accessibility tree is not.
globalThis.ElementInternals = class ElementInternals {
  constructor(el) { this._el = el; this._valid = true; this._flags = {}; this._message = ''; this._value = null; this._states = new Set(); }
  setFormValue(value, state) { this._value = value; }
  setValidity(flags, message, anchor) {
    flags = flags || {};
    const bad = Object.keys(flags).some((k) => k !== 'valid' && flags[k]);
    if (bad && (message == null || message === '')) throw new TypeError("Failed to execute 'setValidity' on 'ElementInternals': The second argument should not be empty if one or more flags in the first argument are true.");
    this._flags = flags; this._valid = !bad; this._message = bad ? String(message) : '';
  }
  checkValidity() { return this._valid; }
  reportValidity() { return this._valid; }
  get validity() {
    const f = this._flags || {};
    return { valid: this._valid, valueMissing: !!f.valueMissing, typeMismatch: !!f.typeMismatch, patternMismatch: !!f.patternMismatch, tooLong: !!f.tooLong, tooShort: !!f.tooShort, rangeUnderflow: !!f.rangeUnderflow, rangeOverflow: !!f.rangeOverflow, stepMismatch: !!f.stepMismatch, badInput: !!f.badInput, customError: !!f.customError };
  }
  get validationMessage() { return this._message || ''; }
  get willValidate() { return true; }
  get form() { return this._el && this._el.closest ? this._el.closest('form') : null; }
  get labels() { return _nodeList([]); }
  get shadowRoot() { return (this._el && this._el._shadowRoot) || null; }
  get states() { return this._states; }
};
// Full standard constant set (issue #439). The partial version here lacked
// FILTER_ACCEPT/REJECT/SKIP and most SHOW_* values, so the canonical
// `acceptNode() { return NodeFilter.FILTER_ACCEPT; }` filter idiom returned
// undefined and TreeWalker/NodeIterator rejected every node.
globalThis.NodeFilter = {
  SHOW_ALL: 0xFFFFFFFF,
  SHOW_ELEMENT: 0x1,
  SHOW_ATTRIBUTE: 0x2,
  SHOW_TEXT: 0x4,
  SHOW_CDATA_SECTION: 0x8,
  SHOW_ENTITY_REFERENCE: 0x10,
  SHOW_ENTITY: 0x20,
  SHOW_PROCESSING_INSTRUCTION: 0x40,
  SHOW_COMMENT: 0x80,
  SHOW_DOCUMENT: 0x100,
  SHOW_DOCUMENT_TYPE: 0x200,
  SHOW_DOCUMENT_FRAGMENT: 0x400,
  SHOW_NOTATION: 0x800,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
};
// ResizeObserver is defined earlier with real per-target firing; the stub
// that previously lived here was a no-op that clobbered the real class.
//
// IntersectionObserver: without a layout engine we can't compute real
// intersection geometry, so every observed target is treated as fully
// in-viewport (`isIntersecting: true`, `intersectionRatio: 1`). Real
// libraries lean on this in three patterns we must support:
//
//   1. Lazy load: observe(img) -> first intersection -> load src -> unobserve.
//      One fire is enough — covered by the initial microtask fire.
//   2. Infinite scroll: observe(sentinel) -> on intersection load more ->
//      new sentinel mounts -> fire again. Needs re-fires as DOM grows.
//   3. Reveal-on-scroll animations: observe(card) -> isIntersecting flips
//      true once and an animation runs. One fire is enough.
//
// To cover (2) without spinning forever, we burst-fire at an exponential
// backoff schedule and ALSO re-fire whenever the DOM mutates (a strong
// signal that the page just rendered something new). Per-observer total
// fire cap stops us from looping on a never-disconnected observer.
globalThis.__intersectionObservers = [];
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(callback, options) {
    this._callback = callback;
    this._options = options || {};
    this._targets = new Set();
    this._connected = true;
    this._fireCount = 0;
    globalThis.__intersectionObservers.push(this);
  }
  _fireFor(targets) {
    if (!this._connected || !targets.length || this._fireCount >= 256) return;
    this._fireCount++;
    const records = targets.map(target => ({
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect
        ? target.getBoundingClientRect()
        : { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 },
      intersectionRect: target.getBoundingClientRect
        ? target.getBoundingClientRect()
        : { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 },
      rootBounds: { x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 },
      time: Date.now(),
    }));
    try { this._callback(records, this); } catch (e) { /* IO callbacks must not propagate */ }
  }
  observe(el) {
    if (!el || !this._connected) return;
    if (this._targets.has(el)) return;
    this._targets.add(el);
    Promise.resolve().then(() => this._fireFor([el]));
    // Exponential burst to cover infinite-scroll sentinels that "re-arm"
    // after content lands. Without a real scroll/layout signal, we fake the
    // re-fire schedule. Beyond ~10s the page has usually settled.
    [120, 500, 1500, 3500, 7000].forEach(delay => {
      setTimeout(() => {
        if (this._connected && this._targets.has(el)) this._fireFor([el]);
      }, delay);
    });
  }
  unobserve(el) { this._targets.delete(el); }
  disconnect() {
    this._connected = false;
    this._targets.clear();
    const idx = globalThis.__intersectionObservers.indexOf(this);
    if (idx >= 0) globalThis.__intersectionObservers.splice(idx, 1);
  }
  takeRecords() { return []; }
  get root() { return this._options.root || null; }
  get rootMargin() { return this._options.rootMargin || "0px 0px 0px 0px"; }
  get thresholds() {
    const t = this._options.threshold;
    if (t == null) return [0];
    return Array.isArray(t) ? t.slice() : [t];
  }
};
// When the DOM mutates (e.g. infinite scroll loads a batch of items), re-fire
// every active IntersectionObserver so libraries observing dynamic content
// see a fresh isIntersecting=true event. Uses the same per-observer fire cap
// to prevent runaway loops if the page is mutating in a tight cycle.
(function() {
  const reFire = () => {
    for (const obs of globalThis.__intersectionObservers) {
      if (!obs._connected) continue;
      const ts = [...obs._targets];
      if (ts.length) obs._fireFor(ts);
    }
  };
  // Lazy-attach a single MutationObserver on document.body once the page is
  // ready, debounced via a microtask so a flurry of mutations only triggers
  // one IO sweep.
  let pending = false;
  const wireUp = () => {
    if (!globalThis.document?.body) return;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      Promise.resolve().then(() => { pending = false; reFire(); });
    });
    try { mo.observe(globalThis.document.body, {childList: true, subtree: true}); } catch {}
  };
  if (globalThis.document?.body) wireUp();
  else Promise.resolve().then(wireUp);
})();
globalThis.IntersectionObserverEntry = class IntersectionObserverEntry {};
globalThis.PerformanceObserver = class { constructor(){} observe(){} disconnect(){} };

globalThis.DOMException = (function () {
  const NAME_TO_CODE = {
    IndexSizeError: 1, HierarchyRequestError: 3, WrongDocumentError: 4,
    InvalidCharacterError: 5, NoModificationAllowedError: 7, NotFoundError: 8,
    NotSupportedError: 9, InUseAttributeError: 10, InvalidStateError: 11,
    SyntaxError: 12, InvalidModificationError: 13, NamespaceError: 14,
    InvalidAccessError: 15, TypeMismatchError: 17, SecurityError: 18,
    NetworkError: 19, AbortError: 20, URLMismatchError: 21,
    QuotaExceededError: 22, TimeoutError: 23, InvalidNodeTypeError: 24,
    DataCloneError: 25,
  };
  class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
      this.message = String(message);
    }
    get code() { return NAME_TO_CODE[this.name] || 0; }
  }
  const CONSTS = {
    INDEX_SIZE_ERR: 1, DOMSTRING_SIZE_ERR: 2, HIERARCHY_REQUEST_ERR: 3,
    WRONG_DOCUMENT_ERR: 4, INVALID_CHARACTER_ERR: 5, NO_DATA_ALLOWED_ERR: 6,
    NO_MODIFICATION_ALLOWED_ERR: 7, NOT_FOUND_ERR: 8, NOT_SUPPORTED_ERR: 9,
    INUSE_ATTRIBUTE_ERR: 10, INVALID_STATE_ERR: 11, SYNTAX_ERR: 12,
    INVALID_MODIFICATION_ERR: 13, NAMESPACE_ERR: 14, INVALID_ACCESS_ERR: 15,
    VALIDATION_ERR: 16, TYPE_MISMATCH_ERR: 17, SECURITY_ERR: 18,
    NETWORK_ERR: 19, ABORT_ERR: 20, URL_MISMATCH_ERR: 21,
    QUOTA_EXCEEDED_ERR: 22, TIMEOUT_ERR: 23, INVALID_NODE_TYPE_ERR: 24,
    DATA_CLONE_ERR: 25,
  };
  for (const k in CONSTS) {
    Object.defineProperty(DOMException, k, { value: CONSTS[k], enumerable: true });
    Object.defineProperty(DOMException.prototype, k, { value: CONSTS[k], enumerable: true });
  }
  return DOMException;
})();
// Per the UI Events spec, only events the user agent dispatches (real or
// automation-synthesized input) are trusted; events page script builds with
// `new Event(...)` must report isTrusted === false (issue #303). Returning true
// for everything is a trivial bot-detection tell. Trusted events are tracked in
// a closure-private WeakSet so page JS can neither read nor forge the flag.
// obscura's CDP input pipeline marks its synthetic events via the
// non-enumerable __obscura_markTrusted helper.
const _trustedEvents = new WeakSet();
globalThis.__obscura_markTrusted = function(ev) { try { if (ev) _trustedEvents.add(ev); } catch (_e) {} return ev; };

// Write value/checked through the element's *prototype* accessor, skipping any
// per-instance property a framework layered on top. React (and Preact/Vue)
// install a value tracker by redefining `value`/`checked` on the element to
// record the last value they wrote; a plain `el.value = x` runs that wrapper,
// so their tracker updates in lockstep and the next input/change event looks
// unchanged, so onChange never fires (issue #324). Writing through the
// prototype setter leaves the tracker stale, so the edit is seen as a real
// user change. When no framework wrapper is present this is identical to a
// direct assignment.
globalThis.__obscura_setFieldValue = function(el, field, value) {
  try {
    let proto = Object.getPrototypeOf(el);
    let desc;
    while (proto && !((desc = Object.getOwnPropertyDescriptor(proto, field)) && desc.set)) {
      proto = Object.getPrototypeOf(proto);
    }
    if (desc && desc.set) { desc.set.call(el, value); return; }
  } catch (_e) {}
  el[field] = value;
};

// Build a FileList-like object: an array with the DOM's `item(i)` accessor.
function _makeFileList(files) {
  const list = files.slice();
  Object.defineProperty(list, "item", { value: (i) => list[i] || null, enumerable: false });
  return list;
}
function _emptyFileList() { return _makeFileList([]); }

// Populate an <input type=file>'s FileList from the CDP DOM.setFileInputFiles
// call (Puppeteer uploadFile / Playwright setInputFiles). `specs` is an array of
// { name, type, b64 } where b64 is the base64-encoded file bytes read on the
// Rust side. Real File objects (backed by the bytes) are created so page code can
// read them via FileReader or upload them via fetch/FormData, then input+change
// fire as a genuine selection would (issue #359).
globalThis.__obscura_setInputFiles = function(el, specs) {
  const files = (specs || []).map((s) => {
    let bytes;
    try {
      const bin = atob(s.b64 || "");
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_e) { bytes = new Uint8Array(0); }
    return new File([bytes], s.name || "", { type: s.type || "" });
  });
  el._files = _makeFileList(files);
  // Mark the events trusted (isTrusted === true), like the Input domain does
  // for synthesized clicks/keys. A real <input type=file> selection fires
  // trusted events; upload flows that gate their change handler on
  // event.isTrusted (common in frameworks and anti-bot code) ignore untrusted
  // ones, which would silently break the exact case this feature targets.
  try { el.dispatchEvent(globalThis.__obscura_markTrusted(new Event("input", { bubbles: true }))); } catch (_e) {}
  try { el.dispatchEvent(globalThis.__obscura_markTrusted(new Event("change", { bubbles: true }))); } catch (_e) {}
};
globalThis.Event = class Event {
  constructor(t,o={}) { this.type=t;this.bubbles=!!o.bubbles;this.cancelable=!!o.cancelable;this.composed=!!o.composed;this.defaultPrevented=false;this.target=null;this.currentTarget=null;this.eventPhase=0;this.timeStamp=Date.now();this._propagationStopped=false;this._immediatePropagationStopped=false; }
  get isTrusted() { return _trustedEvents.has(this); }
  preventDefault() { if (this.cancelable) this.defaultPrevented=true; } stopPropagation(){ this._propagationStopped=true; } stopImmediatePropagation(){ this._propagationStopped=true; this._immediatePropagationStopped=true; }
  initEvent(type,bubbles,cancelable) { if (arguments.length < 1) throw new TypeError("Failed to execute 'initEvent' on 'Event': 1 argument required, but only 0 present."); this.type=String(type);this.bubbles=!!bubbles;this.cancelable=!!cancelable;this.defaultPrevented=false;this._propagationStopped=false;this._immediatePropagationStopped=false; }
  composedPath() {
    if (!this.target) return [];
    const path = [];
    let n = this.target;
    while (n) { path.push(n); n = n.parentNode || null; }
    if (typeof window !== "undefined" && window && path[path.length - 1] !== window) path.push(window);
    return path;
  }
};
_markNative(Event);
globalThis.CustomEvent = class extends Event {
  constructor(t,o={}) { super(t,o);this.detail=o.detail; }
  // Legacy DOM Level 2 init; some libraries (Starbucks China bundle, older
  // analytics shims) still call createEvent('CustomEvent') + initCustomEvent
  // instead of new CustomEvent(...). See issue #41.
  initCustomEvent(type,bubbles,cancelable,detail) {
    this.type = type;
    this.bubbles = !!bubbles;
    this.cancelable = !!cancelable;
    this.detail = detail;
  }
};
globalThis.MouseEvent = class extends Event {
  constructor(t,o={}) { super(t,o);this.view=o.view||null;this.detail=o.detail||0;this.screenX=o.screenX||0;this.screenY=o.screenY||0;this.clientX=o.clientX||0;this.clientY=o.clientY||0;this.ctrlKey=!!o.ctrlKey;this.altKey=!!o.altKey;this.shiftKey=!!o.shiftKey;this.metaKey=!!o.metaKey;this.button=o.button||0;this.buttons=o.buttons||0;this.relatedTarget=o.relatedTarget||null; }
  // Legacy DOM Level 2 initializer. Positional signature per UI Events spec.
  initMouseEvent(type,canBubble,cancelable,view,detail,screenX,screenY,clientX,clientY,ctrlKey,altKey,shiftKey,metaKey,button,relatedTarget) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initMouseEvent' on 'MouseEvent': 1 argument required, but only 0 present.");
    this.initEvent(type,canBubble,cancelable);
    this.view=view===undefined?null:view;
    this.detail=detail||0;
    this.screenX=screenX||0;
    this.screenY=screenY||0;
    this.clientX=clientX||0;
    this.clientY=clientY||0;
    this.ctrlKey=!!ctrlKey;
    this.altKey=!!altKey;
    this.shiftKey=!!shiftKey;
    this.metaKey=!!metaKey;
    this.button=button||0;
    this.relatedTarget=relatedTarget===undefined?null:relatedTarget;
  }
};
globalThis.KeyboardEvent = class extends Event {
  constructor(t,o={}) { super(t,o);this.view=o.view||null;this.detail=o.detail||0;this.key=o.key||"";this.code=o.code||"";this.location=o.location||0;this.ctrlKey=!!o.ctrlKey;this.altKey=!!o.altKey;this.shiftKey=!!o.shiftKey;this.metaKey=!!o.metaKey;this.repeat=!!o.repeat; }
  // Legacy DOM Level 3 initializer. Positional signature per the WebKit/Gecko form.
  initKeyboardEvent(type,canBubble,cancelable,view,key,location,ctrlKey,altKey,shiftKey,metaKey) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initKeyboardEvent' on 'KeyboardEvent': 1 argument required, but only 0 present.");
    this.initEvent(type,canBubble,cancelable);
    this.view=view===undefined?null:view;
    this.key=key===undefined?"":String(key);
    this.location=location||0;
    this.ctrlKey=!!ctrlKey;
    this.altKey=!!altKey;
    this.shiftKey=!!shiftKey;
    this.metaKey=!!metaKey;
  }
};
globalThis.FocusEvent = class extends Event { constructor(t,o={}) { super(t,o);this.relatedTarget=o.relatedTarget||null; } };
globalThis.InputEvent = class extends Event { constructor(t,o={}) { super(t,o);this.data=o.data||null;this.inputType=o.inputType||""; } };
globalThis.ErrorEvent = class extends Event { constructor(t,o={}) { super(t,o);this.message=o.message||"";this.error=o.error||null; } };
globalThis.PointerEvent = class extends Event { constructor(t,o={}) { super(t,o); } };
globalThis.AnimationEvent = class extends Event {};
globalThis.TransitionEvent = class extends Event {};
globalThis.UIEvent = class extends Event {
  constructor(t,o={}) { super(t,o);this.view=o.view||null;this.detail=o.detail||0; }
  // Legacy DOM Level 2 initializer. Positional signature per UI Events spec.
  initUIEvent(type,canBubble,cancelable,view,detail) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initUIEvent' on 'UIEvent': 1 argument required, but only 0 present.");
    this.initEvent(type,canBubble,cancelable);
    this.view=view===undefined?null:view;
    this.detail=detail||0;
  }
};
globalThis.WheelEvent = class extends Event { constructor(t,o={}) { super(t,o);this.deltaX=o.deltaX||0;this.deltaY=o.deltaY||0;this.deltaZ=o.deltaZ||0;this.deltaMode=o.deltaMode||0; } };

globalThis.CompositionEvent = class extends Event {
  constructor(t,o={}) { super(t,o);this.view=o.view||null;this.detail=o.detail||0;this.data=o.data||""; }
  // Legacy DOM Level 3 initializer. Positional signature per UI Events spec.
  initCompositionEvent(type,canBubble,cancelable,view,data) {
    if (arguments.length < 1) throw new TypeError("Failed to execute 'initCompositionEvent' on 'CompositionEvent': 1 argument required, but only 0 present.");
    this.initEvent(type,canBubble,cancelable);
    this.view=view===undefined?null:view;
    this.data=data===undefined?"":String(data);
  }
};
globalThis.PopStateEvent = class extends Event {
  constructor(type, init) {
    super(type, init || {});
    // Real PopStateEvent exposes `state` from the entry being navigated to.
    // The earlier stub inherited Event but never stored state, so
    // `popstate.state` was always undefined and SPA routers reading
    // `event.state` to restore route info would mis-render.
    this.state = init && 'state' in init ? init.state : null;
  }
};
globalThis.HashChangeEvent = class extends Event {};
globalThis.MessageEvent = class extends Event { constructor(t,o={}) { super(t,o);this.data=o.data; } };
globalThis.ProgressEvent = class ProgressEvent extends Event {
  constructor(type, init) {
    super(type, init || {});
    const i = init || {};
    this.lengthComputable = !!i.lengthComputable;
    this.loaded = i.loaded != null ? Number(i.loaded) : 0;
    this.total = i.total != null ? Number(i.total) : 0;
  }
};
globalThis.ClipboardEvent = class extends Event {};
globalThis.SubmitEvent = class extends Event {};

// ToggleEvent backs the popover beforetoggle/toggle events. oldState and
// newState are "open"/"closed". These events do not bubble; beforetoggle is
// cancelable only for the closed -> open (show) transition, toggle is never
// cancelable. See HTML "popover" and html/semantics/popovers WPT.
globalThis.ToggleEvent = class ToggleEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.oldState = init.oldState !== undefined ? String(init.oldState) : "";
    this.newState = init.newState !== undefined ? String(init.newState) : "";
  }
};
_markNative(globalThis.ToggleEvent);

// AbortController / AbortSignal. AbortSignal is a real constructor with a
// prototype, so feature-detection and `AbortSignal.prototype` access work. It
// carries aborted/reason, supports throwIfAborted(), and fires "abort" to
// onabort and addEventListener listeners when the controller aborts.
(function () {
  const BRAND = Symbol("AbortSignal");
  function emit(signal, evt) {
    if (typeof signal.onabort === "function") {
      try { signal.onabort.call(signal, evt); } catch (_) {}
    }
    for (const cb of signal._listeners.slice()) {
      const fn = typeof cb === "function" ? cb : cb && cb.handleEvent;
      if (typeof fn === "function") { try { fn.call(signal, evt); } catch (_) {} }
    }
  }
  function fire(signal, reason) {
    if (signal._aborted) return;
    signal._aborted = true;
    signal._reason = reason !== undefined
      ? reason
      : new DOMException("signal is aborted without reason", "AbortError");
    const evt = typeof Event === "function" ? new Event("abort") : { type: "abort" };
    try { evt.target = signal; evt.currentTarget = signal; } catch (_) {}
    emit(signal, evt);
  }
  globalThis.AbortSignal = class AbortSignal {
    constructor(brand) {
      if (brand !== BRAND) {
        throw new TypeError("Failed to construct 'AbortSignal': Illegal constructor");
      }
      this._aborted = false;
      this._reason = undefined;
      this._listeners = [];
      this.onabort = null;
    }
    get aborted() { return this._aborted; }
    get reason() { return this._reason; }
    throwIfAborted() { if (this._aborted) throw this._reason; }
    addEventListener(type, cb) {
      if (type === "abort" && cb != null) this._listeners.push(cb);
    }
    removeEventListener(type, cb) {
      if (type !== "abort") return;
      const i = this._listeners.indexOf(cb);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    dispatchEvent(evt) {
      if (evt && evt.type === "abort") emit(this, evt);
      return true;
    }
    static abort(reason) {
      const s = new AbortSignal(BRAND);
      s._aborted = true;
      s._reason = reason !== undefined
        ? reason
        : new DOMException("signal is aborted without reason", "AbortError");
      return s;
    }
    static timeout(ms) {
      const s = new AbortSignal(BRAND);
      setTimeout(() => fire(s, new DOMException("signal timed out", "TimeoutError")), ms);
      return s;
    }
    static any(signals) {
      const s = new AbortSignal(BRAND);
      const list = Array.from(signals || []);
      for (const sig of list) {
        if (sig && sig.aborted) { s._aborted = true; s._reason = sig.reason; return s; }
      }
      for (const sig of list) {
        if (sig && typeof sig.addEventListener === "function") {
          sig.addEventListener("abort", () => fire(s, sig.reason));
        }
      }
      return s;
    }
  };
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = new globalThis.AbortSignal(BRAND); }
    abort(reason) { fire(this.signal, reason); }
  };
  _markNative(globalThis.AbortSignal);
  _markNative(globalThis.AbortController);
})();
// Normalize one Blob part to bytes. `native` newline normalization applies to
// string parts when the Blob/File `endings` option is "native".

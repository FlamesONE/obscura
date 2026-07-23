/* ===== WPT conformance shims: batch 2 ===== */

// ---- Node namespace lookup methods ----

Node.prototype.lookupNamespaceURI = function(prefix) {
  let node = this;
  if (node.nodeType === 9) node = node.documentElement;
  if (!node || node.nodeType !== 1) return null;
  const _ns_builtins = { 'xml': 'http://www.w3.org/XML/1998/namespace', 'xmlns': 'http://www.w3.org/2000/xmlns/' };
  if (prefix && _ns_builtins[prefix]) return _ns_builtins[prefix];
  while (node && node.nodeType === 1) {
    if (prefix) {
      if (node.prefix === prefix && node.namespaceURI) return node.namespaceURI;
      const nsAttr = node.getAttribute('xmlns:' + prefix);
      if (nsAttr !== null) return nsAttr || null;
    } else {
      const defaultNs = node.getAttribute('xmlns');
      if (defaultNs !== null) return defaultNs || null;
      if (node.prefix === null && node.namespaceURI) return node.namespaceURI;
    }
    node = node.parentElement;
  }
  return null;
};
_markNative(Node.prototype.lookupNamespaceURI);

Node.prototype.lookupPrefix = function(namespace) {
  namespace = namespace || null;
  let node = this;
  if (node.nodeType === 9) node = node.documentElement;
  if (!node || node.nodeType !== 1) return null;
  const _ns_builtins = { 'http://www.w3.org/XML/1998/namespace': 'xml', 'http://www.w3.org/2000/xmlns/': 'xmlns' };
  if (_ns_builtins[namespace]) return _ns_builtins[namespace];
  while (node && node.nodeType === 1) {
    if (node.namespaceURI === namespace) {
      const p = node.prefix;
      if (p) return p;
    }
    const attrs = node.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const attrName = attr.name || attr.nodeName || '';
      const attrValue = attr.value || attr.nodeValue || '';
      if (attrName === 'xmlns' && attrValue === namespace) return '';
      if (attrName.startsWith('xmlns:')) {
        const prefix = attrName.substring(6);
        if (attrValue === namespace) return prefix;
      }
    }
    node = node.parentElement;
  }
  return null;
};
_markNative(Node.prototype.lookupPrefix);

Node.prototype.isDefaultNamespace = function(namespace) {
  return this.lookupNamespaceURI(null) === (namespace || null);
};
_markNative(Node.prototype.isDefaultNamespace);


// ---- getElementsByTagNameNS on Element and Document ----
// getElementsByTagNameNS on Element and Document
if (!Element.prototype.getElementsByTagNameNS) {
  Element.prototype.getElementsByTagNameNS = function(namespaceURI, localName) {
    const all = this.querySelectorAll('*');
    const filtered = [];
    const nsMatch = namespaceURI === '*';
    const tagMatch = localName === '*';
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!el) continue;
      const elNs = el.namespaceURI;
      const elTag = el.localName;
      const nsOk = nsMatch || (elNs === (namespaceURI || null));
      const tagOk = tagMatch || (elTag === localName);
      if (nsOk && tagOk) filtered.push(el);
    }
    const result = new HTMLCollection(...filtered);
    result.item = (i) => result[i] != null ? result[i] : null;
    return result;
  };
  _markNative(Element.prototype.getElementsByTagNameNS);
}
if (!Document.prototype.getElementsByTagNameNS) {
  Document.prototype.getElementsByTagNameNS = function(namespaceURI, localName) {
    const all = this.querySelectorAll('*');
    const filtered = [];
    const nsMatch = namespaceURI === '*';
    const tagMatch = localName === '*';
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!el) continue;
      const elNs = el.namespaceURI;
      const elTag = el.localName;
      const nsOk = nsMatch || (elNs === (namespaceURI || null));
      const tagOk = tagMatch || (elTag === localName);
      if (nsOk && tagOk) filtered.push(el);
    }
    const result = new HTMLCollection(...filtered);
    result.item = (i) => result[i] != null ? result[i] : null;
    return result;
  };
  _markNative(Document.prototype.getElementsByTagNameNS);
}

// ---- Attr nodes and createAttribute ----
// Attr class: represents attribute nodes (nodeType 2)
if (!globalThis.Attr) {
  globalThis.Attr = class Attr {
    constructor(name, value = '', namespaceURI = null, prefix = null) {
      this.name = name;
      this.localName = name;
      this.value = value;
      this.namespaceURI = namespaceURI;
      this.prefix = prefix;
      this.ownerElement = null;
      this.specified = true;
    }
    get nodeName() { return this.name; }
    get nodeValue() { return this.value; }
    set nodeValue(v) { this.value = v; }
    get nodeType() { return 2; }
  };
}

// XML Name validation helper for attribute/processing instruction names
const _ns_isValidXmlName = (name) => {
  if (typeof name !== 'string' || !name.length) return false;
  return /^[A-Za-z_:][\w.\-:]*$/.test(name);
};

// Document.prototype.createAttribute: create a detached Attr node
if (!Document.prototype.createAttribute) {
  Document.prototype.createAttribute = function(localName) {
    const name = String(localName || '');
    if (!_ns_isValidXmlName(name)) {
      throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
    }
    return new Attr(name, '', null, null);
  };
  _markNative(Document.prototype.createAttribute);
}

// Document.prototype.createAttributeNS: create a namespaced Attr node
if (!Document.prototype.createAttributeNS) {
  Document.prototype.createAttributeNS = function(namespaceURI, qualifiedName) {
    const ns = namespaceURI ? String(namespaceURI) : null;
    const qn = String(qualifiedName || '');
    if (!qn.length) {
      throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
    }
    let prefix = null;
    let localName = qn;
    const colonIdx = qn.indexOf(':');
    if (colonIdx !== -1) {
      prefix = qn.substring(0, colonIdx);
      localName = qn.substring(colonIdx + 1);
      if (!_ns_isValidXmlName(prefix) || !_ns_isValidXmlName(localName)) {
        throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
      }
    } else {
      if (!_ns_isValidXmlName(localName)) {
        throw new DOMException('Invalid attribute name', 'InvalidCharacterError');
      }
    }
    return new Attr(qn, '', ns, prefix);
  };
  _markNative(Document.prototype.createAttributeNS);
}

// Element.prototype.getAttributeNode: return an Attr node or null
if (!Element.prototype.getAttributeNode) {
  Element.prototype.getAttributeNode = function(name) {
    const val = this.getAttribute(name);
    if (val === null) return null;
    const attr = new Attr(name, val, null, null);
    attr.ownerElement = this;
    return attr;
  };
  _markNative(Element.prototype.getAttributeNode);
}

// Element.prototype.getAttributeNodeNS: return a namespaced Attr node or null
if (!Element.prototype.getAttributeNodeNS) {
  Element.prototype.getAttributeNodeNS = function(namespaceURI, localName) {
    const val = this.getAttributeNS(namespaceURI, localName);
    if (val === null) return null;
    const name = String(localName || '');
    const attr = new Attr(name, val, namespaceURI ? String(namespaceURI) : null, null);
    attr.ownerElement = this;
    return attr;
  };
  _markNative(Element.prototype.getAttributeNodeNS);
}

// Element.prototype.setAttributeNode: set an Attr and return the previous one
if (!Element.prototype.setAttributeNode) {
  Element.prototype.setAttributeNode = function(attr) {
    if (!attr || typeof attr.name !== 'string') return null;
    const prevVal = this.getAttribute(attr.name);
    const prevAttr = prevVal !== null ? new Attr(attr.name, prevVal, null, null) : null;
    if (prevAttr) prevAttr.ownerElement = this;
    this.setAttribute(attr.name, attr.value);
    attr.ownerElement = this;
    return prevAttr;
  };
  _markNative(Element.prototype.setAttributeNode);
}

// Element.prototype.setAttributeNodeNS: set a namespaced Attr and return the previous one
if (!Element.prototype.setAttributeNodeNS) {
  Element.prototype.setAttributeNodeNS = function(attr) {
    if (!attr || typeof attr.name !== 'string') return null;
    const prevVal = this.getAttribute(attr.name);
    const prevAttr = prevVal !== null 
      ? new Attr(attr.name, prevVal, attr.namespaceURI || null, attr.prefix || null) 
      : null;
    if (prevAttr) prevAttr.ownerElement = this;
    this.setAttributeNS(attr.namespaceURI || null, attr.name, attr.value);
    attr.ownerElement = this;
    return prevAttr;
  };
  _markNative(Element.prototype.setAttributeNodeNS);
}

// Element.prototype.removeAttributeNode: remove and return an Attr
if (!Element.prototype.removeAttributeNode) {
  Element.prototype.removeAttributeNode = function(attr) {
    if (!attr || typeof attr.name !== 'string') return attr;
    const val = this.getAttribute(attr.name);
    if (val !== null) {
      this.removeAttribute(attr.name);
    }
    return attr;
  };
  _markNative(Element.prototype.removeAttributeNode);
}


// ---- form control validity and text selection ----

// ValidityState class for form validation state reporting
if (typeof ValidityState === 'undefined') {
  globalThis.ValidityState = class ValidityState {
    constructor() {
      this.badInput = false;
      this.customError = false;
      this.patternMismatch = false;
      this.rangeOverflow = false;
      this.rangeUnderflow = false;
      this.stepMismatch = false;
      this.tooLong = false;
      this.tooShort = false;
      this.typeMismatch = false;
      this.valueMissing = false;
      this.valid = true;
    }
  };
}

// Validity and validation message storage on elements
const _ns_validityCache = new WeakMap();
const _ns_customValidityMsg = new WeakMap();

// Element.prototype.validity - returns cached ValidityState for the element
if (!Element.prototype.validity) {
  Object.defineProperty(Element.prototype, 'validity', {
    get: function() {
      if (!_ns_validityCache.has(this)) {
        _ns_validityCache.set(this, new ValidityState());
      }
      return _ns_validityCache.get(this);
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.willValidate - whether element is subject to constraint validation
if (!Element.prototype.willValidate) {
  Object.defineProperty(Element.prototype, 'willValidate', {
    get: function() {
      return true;
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.validationMessage - custom validation message if set
if (!Element.prototype.validationMessage) {
  Object.defineProperty(Element.prototype, 'validationMessage', {
    get: function() {
      return _ns_customValidityMsg.get(this) || '';
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.checkValidity - stub returns true
if (!Element.prototype.checkValidity) {
  Element.prototype.checkValidity = function checkValidity() {
    return true;
  };
  _markNative(Element.prototype.checkValidity);
}

// Element.prototype.reportValidity - stub returns true
if (!Element.prototype.reportValidity) {
  Element.prototype.reportValidity = function reportValidity() {
    return true;
  };
  _markNative(Element.prototype.reportValidity);
}

// Element.prototype.setCustomValidity - set custom validation message
if (!Element.prototype.setCustomValidity) {
  Element.prototype.setCustomValidity = function setCustomValidity(msg) {
    const validity = this.validity;
    if (msg && msg.length > 0) {
      _ns_customValidityMsg.set(this, msg);
      validity.customError = true;
      validity.valid = false;
    } else {
      _ns_customValidityMsg.delete(this);
      validity.customError = false;
      validity.valid = true;
    }
  };
  _markNative(Element.prototype.setCustomValidity);
}

// Text selection on Element.prototype
const _ns_selectionStart = new WeakMap();
const _ns_selectionEnd = new WeakMap();
const _ns_selectionDir = new WeakMap();

// Element.prototype.selectionStart - get/set selection start position
if (!Element.prototype.selectionStart) {
  Object.defineProperty(Element.prototype, 'selectionStart', {
    get: function() {
      return _ns_selectionStart.get(this) ?? null;
    },
    set: function(v) {
      _ns_selectionStart.set(this, v == null ? null : Math.max(0, parseInt(v, 10) || 0));
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.selectionEnd - get/set selection end position
if (!Element.prototype.selectionEnd) {
  Object.defineProperty(Element.prototype, 'selectionEnd', {
    get: function() {
      return _ns_selectionEnd.get(this) ?? null;
    },
    set: function(v) {
      _ns_selectionEnd.set(this, v == null ? null : Math.max(0, parseInt(v, 10) || 0));
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.selectionDirection - get/set selection direction
if (!Element.prototype.selectionDirection) {
  Object.defineProperty(Element.prototype, 'selectionDirection', {
    get: function() {
      return _ns_selectionDir.get(this) ?? 'none';
    },
    set: function(v) {
      _ns_selectionDir.set(this, v === 'forward' || v === 'backward' ? v : 'none');
    },
    enumerable: true,
    configurable: true
  });
}

// Element.prototype.setSelectionRange - set text selection range
if (!Element.prototype.setSelectionRange) {
  Element.prototype.setSelectionRange = function setSelectionRange(start, end, direction) {
    start = Math.max(0, parseInt(start, 10) || 0);
    end = Math.max(0, parseInt(end, 10) || 0);
    direction = direction === 'forward' || direction === 'backward' ? direction : 'none';
    _ns_selectionStart.set(this, start);
    _ns_selectionEnd.set(this, end);
    _ns_selectionDir.set(this, direction);
  };
  _markNative(Element.prototype.setSelectionRange);
}

// Element.prototype.setRangeText - replace selection with text
if (!Element.prototype.setRangeText) {
  Element.prototype.setRangeText = function setRangeText(replacement, start, end, selectMode) {
    const val = this.value;
    if (!val) return;
    const strVal = String(val);
    start = start === undefined ? (this.selectionStart ?? 0) : Math.max(0, parseInt(start, 10) || 0);
    end = end === undefined ? (this.selectionEnd ?? 0) : Math.max(0, parseInt(end, 10) || 0);
    const newValue = strVal.slice(0, start) + String(replacement) + strVal.slice(end);
    this.value = newValue;
    selectMode = selectMode || 'preserve';
    if (selectMode === 'select') {
      const replLen = String(replacement).length;
      _ns_selectionStart.set(this, start);
      _ns_selectionEnd.set(this, start + replLen);
      _ns_selectionDir.set(this, 'none');
    } else if (selectMode === 'start') {
      _ns_selectionStart.set(this, start);
      _ns_selectionEnd.set(this, start);
      _ns_selectionDir.set(this, 'none');
    } else if (selectMode === 'end') {
      const replLen = String(replacement).length;
      _ns_selectionStart.set(this, start + replLen);
      _ns_selectionEnd.set(this, start + replLen);
      _ns_selectionDir.set(this, 'none');
    }
  };
  _markNative(Element.prototype.setRangeText);
}

// Element.prototype.select - select all text in the element
if (!Element.prototype.select) {
  Element.prototype.select = function select() {
    const val = this.value;
    if (val === undefined || val === null) return;
    const len = String(val).length;
    _ns_selectionStart.set(this, 0);
    _ns_selectionEnd.set(this, len);
    _ns_selectionDir.set(this, 'none');
  };
  _markNative(Element.prototype.select);
}


// ---- Response.blob() on the real fetch path ----

if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.blob) {
  Response.prototype.blob = async function() {
    const bytes = await this.arrayBuffer();
    const contentType = this.headers && typeof this.headers.get === 'function' ? this.headers.get('content-type') : '';
    return new Blob([new Uint8Array(bytes)], { type: contentType || '' });
  };
  _markNative(Response.prototype.blob);
}
if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.text) {
  Response.prototype.text = async function() {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  };
  _markNative(Response.prototype.text);
}
if (typeof Response !== 'undefined' && Response.prototype && !Response.prototype.json) {
  Response.prototype.json = async function() {
    return JSON.parse(await this.text());
  };
  _markNative(Response.prototype.json);
}
// arrayBuffer is the body primitive that blob/text/json derive from; the
// engine's Response provides it natively, so it is intentionally not shimmed
// here (a JS fallback could only recurse into itself).

// tamperedFunctions: obscura reimplements much of the DOM/Web platform in JS.
// Real Chrome reports "[native code]" from toString() for every builtin method,
// accessor, and constructor; any JS-backed member that leaks its source is a
// detection tell (pixelscan's tamperedFunctions check flags e.g.
// Element.prototype.nodeType, whose getter returned "get nodeType() {...}").
// Individual _markNative calls throughout this file cover methods but miss the
// property accessors and several constructors. Sweep every builtin constructor
// reachable from the global object and mark its prototype members (methods and
// accessors) plus the constructor itself native. This runs once at snapshot
// build time, so it costs nothing per page, and genuinely-native V8 builtins
// already report native, so only the JS-backed members are affected.
(function _markBuiltinsNative() {
  var seen = new Set();
  function walk(ctor) {
    if (typeof ctor !== 'function') { return; }
    _markNative(ctor);
    var proto = ctor.prototype;
    if (!proto || seen.has(proto)) { return; }
    seen.add(proto);
    var keys = Object.getOwnPropertyNames(proto);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var d;
      try { d = Object.getOwnPropertyDescriptor(proto, key); } catch (e) { continue; }
      if (!d) { continue; }
      if (typeof d.value === 'function') { _markNative(d.value); }
      if (typeof d.get === 'function') { _markNativeAs(d.get, 'function get ' + key + '() { [native code] }'); }
      if (typeof d.set === 'function') { _markNativeAs(d.set, 'function set ' + key + '() { [native code] }'); }
    }
  }
  var names = Object.getOwnPropertyNames(globalThis);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!/^[A-Z]/.test(name)) { continue; }
    var val;
    try { val = globalThis[name]; } catch (e) { continue; }
    if (typeof val === 'function') { walk(val); }
  }
})();

// _markBuiltinsNative only sweeps Capitalized constructors. These lowercase
// global functions are JS-shimmed above (fetch/timers/getComputedStyle) and
// would still leak their JS source through Function.prototype.toString — the
// exact surface Cloudflare's challenge JS fingerprints. Mark them native too.
[
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'getComputedStyle',
].forEach(function(name) {
  var v = globalThis[name];
  if (typeof v === 'function') { _markNative(v); }
});

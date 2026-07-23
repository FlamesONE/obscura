class Element extends Node {
  constructor(nid) {
    super(nid);
    this._style = _styleProxy(new CSSStyleDeclaration());
  }
  // Element wrappers always back a nodeType-1 node (_wrap/_wrapEl only build an
  // Element for element nodes, and node ids are never freed-and-reused), so this
  // is constant. Overrides Node's dynamic getter to drop one op per nodeType read.
  get nodeType() { return 1; }
  get tagName() { return _domParse("tag_name", this._nid) || ""; }
  get localName() {
    // tagName is an op call and the tag never changes, so cache the lowercased
    // localName. This keeps the new <a>/<area> href getters (which read
    // localName) and every other localName consumer off the op path.
    if (this._lname !== undefined) return this._lname;
    const ln = (this.tagName || "").toLowerCase();
    if (ln) this._lname = ln;
    return ln;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() {
    // SVG elements reflect class as an SVGAnimatedString (.baseVal/.animVal),
    // not a plain string. Anti-fraud sensors read el.className.animVal.
    if (this.namespaceURI === "http://www.w3.org/2000/svg") {
      if (!this._svgClassName) this._svgClassName = new SVGAnimatedString(this, "class");
      return this._svgClassName;
    }
    return this.getAttribute("class") || "";
  }
  set className(v) { this.setAttribute("class", v); }
  get namespaceURI() {
    // createElementNS records the requested namespace on _ns; an empty string
    // maps to the null namespace per spec. Elements made via createElement (or
    // parsed) have no _ns: default to XHTML, except <svg> which is SVG.
    if (this._ns !== undefined) return this._ns === "" ? null : this._ns;
    if (this.localName === "svg") return "http://www.w3.org/2000/svg";
    return "http://www.w3.org/1999/xhtml";
  }
  get innerHTML() { return _domParse("inner_html", this._nid) ?? ""; }
  set innerHTML(v) {
    if (this.localName === 'template') {
      this.content.innerHTML = v;
      return;
    }
    // Capture the children that are about to be replaced so we can deliver
    // them as `removedNodes` in the MutationObserver record. Without this,
    // libraries that mutate via `innerHTML =` (jQuery's `.html(s)`, React
    // `dangerouslySetInnerHTML`, vue-style content swaps) silently bypass
    // every MutationObserver subscriber and downstream hydration / polling
    // logic stalls.
    let oldChildren = [];
    let newChildren = [];
    if (globalThis.__mutationObservers?.length) {
      oldChildren = _domParse("child_nodes", this._nid) || [];
    }
    _dom("set_inner_html", this._nid, String(v ?? ""));
    if (globalThis.__mutationObservers?.length) {
      newChildren = _domParse("child_nodes", this._nid) || [];
      globalThis.__notifyMutation('childList', this._nid, newChildren, oldChildren);
    }
  }
  get outerHTML() { return _domParse("outer_html", this._nid) ?? ""; }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get children() {
    const ids = _domParse("element_children", this._nid) || [];
    return HTMLCollection._from(ids.map(_wrapEl).filter(Boolean));
  }
  get content() {
    // <template>.content is a DocumentFragment; <meta>.content reflects
    // the content attribute (read/write per spec). Next.js' next/head
    // iterates <meta> tags and sets .content during hydration, which
    // threw with the previous getter-only stub and put React into an
    // infinite retry loop (issue #210).
    const tag = this.localName;
    if (tag === 'template') {
      if (!this._templateContent) this._templateContent = document.createDocumentFragment();
      return this._templateContent;
    }
    if (tag === 'meta') return this.getAttribute('content') || '';
    return undefined;
  }
  set content(v) {
    if (this.localName === 'meta') {
      this.setAttribute('content', v == null ? '' : String(v));
    }
  }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const ch = this.children; return ch[ch.length-1] || null; }
  get nextElementSibling() { let s = this.nextSibling; while(s && s.nodeType !== 1) s = s.nextSibling; return s; }
  get previousElementSibling() { let s = this.previousSibling; while(s && s.nodeType !== 1) s = s.previousSibling; return s; }
  get classList() {
    if (!this._classList) this._classList = new DOMTokenList(this, "class");
    return this._classList;
  }
  get relList() {
    const ns = this.namespaceURI, ln = this.localName;
    const ok = (ns === "http://www.w3.org/2000/svg" && ln === "a") ||
               (ns === "http://www.w3.org/1999/xhtml" && (ln === "a" || ln === "area" || ln === "link"));
    if (!ok) return undefined;
    // relList has supported tokens, so relList.supports(x) returns a boolean
    // rather than throwing. Vite's modulepreload polyfill runs
    // link.relList.supports('modulepreload') at the top of every bundle; a
    // throw there aborts the whole module and the SPA renders blank.
    if (!this._relList) this._relList = new DOMTokenList(this, "rel", ["alternate","dns-prefetch","icon","manifest","modulepreload","next","pingback","preconnect","prefetch","preload","prev","search","stylesheet"]);
    return this._relList;
  }
  get sandbox() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml" || this.localName !== "iframe") return undefined;
    if (!this._sandboxList) this._sandboxList = new DOMTokenList(this, "sandbox", ["allow-downloads","allow-forms","allow-modals","allow-orientation-lock","allow-pointer-lock","allow-popups","allow-popups-to-escape-sandbox","allow-presentation","allow-same-origin","allow-scripts","allow-top-navigation","allow-top-navigation-by-user-activation","allow-top-navigation-to-custom-protocols"]);
    return this._sandboxList;
  }
  get sizes() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml" || this.localName !== "link") return undefined;
    if (!this._sizesList) this._sizesList = new DOMTokenList(this, "sizes");
    return this._sizesList;
  }
  get htmlFor() {
    if (this.namespaceURI !== "http://www.w3.org/1999/xhtml") return undefined;
    const ln = this.localName;
    if (ln === "output") {
      if (!this._htmlForList) this._htmlForList = new DOMTokenList(this, "for");
      return this._htmlForList;
    }
    if (ln === "label") return this.getAttribute("for") || "";
    return undefined;
  }
  set htmlFor(v) {
    if (this.namespaceURI === "http://www.w3.org/1999/xhtml" && this.localName === "label") {
      this.setAttribute("for", String(v));
    }
  }
  get style() { return this._style; }
  set style(v) { if (typeof v === "string") this._style.cssText = v; }
  getAttribute(n) {
    // Fast path: HTML attributes are stored lowercase, so a direct hit needs no
    // case folding. Only on a miss do we lowercase (gated) and retry, so the hot
    // case (reading an existing lowercase attribute) pays zero scan.
    let v = _domParse("get_attribute", this._nid, n);
    if (v === null) { const ln = _htmlAttrName(this, n); if (ln !== n) v = _domParse("get_attribute", this._nid, ln); }
    return v;
  }
  setAttribute(n, v) {
    n = _htmlAttrName(this, n);
    const popoverPrev = (n === "popover") ? this.popover : undefined;
    _dom("set_attribute", this._nid, n + "\0" + String(v));
    if (popoverPrev !== undefined) this._popoverTypeMaybeChanged(popoverPrev);
    if (globalThis.__mutationObservers?.length) globalThis.__notifyMutation('attributes', this._nid, [], [], n);
  }
  setAttributeNS(ns, n, v) { _dom("set_attribute", this._nid, String(n) + "\0" + String(v)); } // exact name, no HTML folding
  removeAttribute(n) { n = _htmlAttrName(this, n); const popoverPrev = (n === "popover") ? this.popover : undefined; _dom("remove_attribute", this._nid, n); if (popoverPrev !== undefined) this._popoverTypeMaybeChanged(popoverPrev); }
  removeAttributeNS(ns, n) { _dom("remove_attribute", this._nid, String(n)); }
  hasAttribute(n) { return this.getAttribute(n) !== null; }
  hasAttributes() { return true; } // Simplified
  getAttributeNames() { return _domParse("attribute_names", this._nid) || []; }
  get attributes() {
    const el = this;
    const names = _domParse("attribute_names", el._nid) || [];
    const list = names.map((name) => {
      const v = el.getAttribute(name) ?? "";
      return {
        name,
        localName: name,
        value: v,
        namespaceURI: null,
        prefix: null,
        specified: true,
        ownerElement: el,
        nodeName: name,
        nodeValue: v,
        nodeType: 2,
      };
    });
    list.length = names.length;
    list.getNamedItem = (n) => names.includes(n) ? list[names.indexOf(n)] : null;
    list.setNamedItem = (a) => { if (a && a.name) el.setAttribute(a.name, a.value); return a; };
    list.removeNamedItem = (n) => { const a = list.getNamedItem(n); if (a) el.removeAttribute(n); return a; };
    list.item = (i) => list[i] || null;
    for (let i = 0; i < names.length; i++) {
      Object.defineProperty(list, names[i], { value: list[i], configurable: true, enumerable: false });
    }
    return list;
  }
  getAttributeNS(ns, n) { return _domParse("get_attribute", this._nid, String(n)); }
  querySelector(s) { return _wrapEl(+_dom("query_selector_scoped", this._nid, s)); }
  querySelectorAll(s) {
    const ids = _domParse("query_selector_all_scoped", this._nid, s) || [];
    return _nodeList(ids.map(_wrapEl).filter(Boolean));
  }
  getElementsByTagName(t) { return HTMLCollection._from(this.querySelectorAll(t)); }
  getElementsByClassName(c) { return _getElementsByClassName(this, c); }
  matches(s) {
    // :popover-open is a JS-observable popover state, not understood by the
    // native selector engine. Handle it here (and strip it from compound
    // selectors so the rest can still be matched natively).
    if (typeof s === "string" && s.indexOf(":popover-open") !== -1) {
      if (this._popoverState !== "showing") return false;
      const rest = s.replace(/:popover-open/g, "").trim();
      if (rest === "") return true;
      return this.matches(rest);
    }
    // :modal is a JS-observable dialog state (a dialog opened via showModal()),
    // not understood by the native selector engine; handle it like :popover-open.
    if (typeof s === "string" && s.indexOf(":modal") !== -1) {
      if (this._dialogModal !== true) return false;
      const rest = s.replace(/:modal/g, "").trim();
      if (rest === "") return true;
      return this.matches(rest);
    }
    const parent = this.parentNode;
    if (!parent || !parent.querySelectorAll) return false;
    const matches = parent.querySelectorAll(s);
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]._nid === this._nid) return true;
    }
    return false;
  }
  closest(s) {
    let el = this;
    while (el) {
      if (el.nodeType === 1 && el.matches && el.matches(s)) return el;
      el = el.parentNode;
    }
    return null;
  }
  insertAdjacentHTML(position, html) {
    const parent = this.parentNode;
    switch (position) {
      case 'beforebegin':
        if (parent) { const tmp = document.createElement('div'); tmp.innerHTML = html; const children = tmp.childNodes; for (let i = 0; i < children.length; i++) parent.insertBefore(children[i], this); }
        break;
      case 'afterbegin':
        { const tmp = document.createElement('div'); tmp.innerHTML = html; const children = tmp.childNodes; const first = this.firstChild; for (let i = children.length - 1; i >= 0; i--) this.insertBefore(children[i], first); }
        break;
      case 'beforeend':
        { const tmp = document.createElement('div'); tmp.innerHTML = html; const children = tmp.childNodes; for (let i = 0; i < children.length; i++) this.appendChild(children[i]); }
        break;
      case 'afterend':
        if (parent) { const tmp = document.createElement('div'); tmp.innerHTML = html; const children = tmp.childNodes; const next = this.nextSibling; for (let i = 0; i < children.length; i++) parent.insertBefore(children[i], next); }
        break;
    }
  }
  // Like insertAdjacentHTML but inserts a Text node instead of parsing markup,
  // so the content stays literal.
  insertAdjacentText(position, text) {
    const parent = this.parentNode;
    const node = document.createTextNode(String(text));
    switch (String(position).toLowerCase()) {
      case 'beforebegin':
        if (parent) parent.insertBefore(node, this);
        break;
      case 'afterbegin':
        this.insertBefore(node, this.firstChild);
        break;
      case 'beforeend':
        this.appendChild(node);
        break;
      case 'afterend':
        if (parent) parent.insertBefore(node, this.nextSibling);
        break;
    }
  }
  // Returns the inserted element, or null for beforebegin/afterend when this
  // element has no parent.
  insertAdjacentElement(position, element) {
    const parent = this.parentNode;
    switch (String(position).toLowerCase()) {
      case 'beforebegin':
        if (!parent) return null;
        parent.insertBefore(element, this);
        return element;
      case 'afterbegin':
        this.insertBefore(element, this.firstChild);
        return element;
      case 'beforeend':
        this.appendChild(element);
        return element;
      case 'afterend':
        if (!parent) return null;
        parent.insertBefore(element, this.nextSibling);
        return element;
    }
    return null;
  }
  addEventListener(type, handler, opts) {
    const key = this._nid;
    if (!_eventRegistry[key]) _eventRegistry[key] = {};
    if (!_eventRegistry[key][type]) _eventRegistry[key][type] = [];
    _eventRegistry[key][type].push(handler);
  }
  removeEventListener(type, handler) {
    const key = this._nid;
    if (_eventRegistry[key] && _eventRegistry[key][type]) {
      _eventRegistry[key][type] = _eventRegistry[key][type].filter(h => h !== handler);
    }
  }
  dispatchEvent(event) {
    if (!event) return true;
    if (!event.target) event.target = this;
    event.currentTarget = this;
    // Spec: inline `onclick="..."` content attributes are event handlers
    // for the matching event type. Fire them alongside any
    // addEventListener handlers. Also honor the IDL property
    // `el.onclick = fn` if set. Without this, b.click() never invokes
    // the inline handler and forms with onsubmit / buttons with onclick
    // are silently dead.
    const handlerName = 'on' + event.type;
    const inlineFn = this[handlerName] || this._resolveInlineHandler(handlerName);
    if (typeof inlineFn === 'function') {
      try {
        const ret = inlineFn.call(this, event);
        if (ret === false) event.preventDefault();
      } catch(e) { console.error(e); }
    }
    const handlers = (_eventRegistry[this._nid] || {})[event.type] || [];
    for (const h of handlers) {
      try { h.call(this, event); } catch(e) { console.error(e); }
      if (event._immediatePropagationStopped) break;
    }
    if (event.bubbles && !event._propagationStopped && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }
  _resolveInlineHandler(name) {
    // name = 'onclick' / 'onsubmit' / etc. Compile the content attribute
    // as a function body on first read and cache it on the instance.
    const cache = this.__inlineHandlerCache || (this.__inlineHandlerCache = {});
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    const src = this.getAttribute && this.getAttribute(name);
    if (!src) { cache[name] = null; return null; }
    try {
      cache[name] = new Function('event', src);
    } catch (e) {
      cache[name] = null;
    }
    return cache[name];
  }
  click() {
    const cancelled = !this.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
    if (!cancelled) {
      const link = this.tagName === 'A' ? this : (this.closest ? this.closest('a[href]') : null);
      if (link) {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          location.assign(href);
          return;
        }
      }
      // Same predicate requestSubmit validates against, so an internal click
      // can never hand it a submitter it would reject. Also matches the CDP
      // click path in input.rs, which already treats <input type=image> as a
      // submit button.
      if (_isSubmitButton(this)) {
        const form = this.closest ? this.closest('form') : null;
        // A real submit-button click fires the cancelable submit event, so use
        // requestSubmit() (not the plain submit() method, which now bypasses it).
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit(this);
        } else if (form && typeof form.submit === 'function') {
          form.submit(this);
        }
      }
    }
  }
  focus() { globalThis.__obscura_focused = this; globalThis.__obscura_click_target = this; }
  blur() { if (globalThis.__obscura_focused === this) globalThis.__obscura_focused = null; }

  // --- Popover API (HTML "popover") ---------------------------------------
  // Read the popover content attribute case-insensitively. The HTML parser
  // lowercases attribute names, but runtime setAttribute("PoPoVeR", ...)
  // preserves case, and the IDL reflection matches the name ASCII-case-
  // insensitively. Returns the raw stored string, or null if absent.
  _popoverAttrValue() {
    const v = this.getAttribute("popover");
    if (v !== null) return v;
    const names = _domParse("attribute_names", this._nid) || [];
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === "popover") return this.getAttribute(names[i]);
    }
    return null;
  }
  // The reflected (effective) popover type: null (No Popover), "auto",
  // "hint", or "manual". Empty string maps to "auto"; any non-keyword value
  // (invalid) maps to "manual".
  get popover() {
    const raw = this._popoverAttrValue();
    if (raw === null) return null;
    const v = String(raw).toLowerCase();
    if (v === "auto" || v === "hint" || v === "manual") return v;
    if (v === "") return "auto";
    return "manual";
  }
  set popover(value) {
    if (value === null || value === undefined) { this._popoverRemoveAttr(); return; }
    this.setAttribute("popover", String(value));
  }
  _popoverRemoveAttr() {
    if (this.getAttribute("popover") !== null) { this.removeAttribute("popover"); return; }
    const names = _domParse("attribute_names", this._nid) || [];
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === "popover") { this.removeAttribute(names[i]); return; }
    }
  }
  // "check popover validity". expectedToBeShowing is true for hide, false for
  // show. Throws NotSupportedError when there is no valid popover type, and
  // InvalidStateError when the element is not connected; returns false (no
  // throw) when the current state does not match expectedToBeShowing.
  _checkPopoverValidity(expectedToBeShowing) {
    if (this.popover === null) throw new DOMException("Not supported on elements that don't have a valid value for the popover attribute", "NotSupportedError");
    const showing = this._popoverState === "showing";
    if ((expectedToBeShowing && !showing) || (!expectedToBeShowing && showing)) return false;
    if (!this.isConnected) throw new DOMException("Invalid on popover elements which aren't connected", "InvalidStateError");
    return true;
  }
  showPopover() {
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/false)) return;
    const beforeEvent = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(beforeEvent)) return;
    // The beforetoggle handler may have changed our type or shown us; re-check.
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/false)) return;
    this._popoverState = "showing";
    const target = this;
    setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  hidePopover() {
    if (!this._checkPopoverValidity(/*expectedToBeShowing*/true)) return;
    this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    this._popoverState = "hidden";
    const target = this;
    setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
  }
  togglePopover(force) {
    let options = force;
    if (options && typeof options === "object") force = options.force;
    const showing = this._popoverState === "showing";
    if (showing && (force === undefined || force === null || force === false)) {
      this.hidePopover();
    } else if (force === undefined || force === null || force === true) {
      this.showPopover();
    }
    return this._popoverState === "showing";
  }
  // Called from setAttribute/removeAttribute/IDL setter when the popover
  // attribute may have changed. If the effective type changed while showing,
  // hide the popover (firing the hide events) per the HTML spec.
  _popoverTypeMaybeChanged(prevType) {
    const newType = this.popover;
    if (this._popoverState === "showing" && prevType !== newType) {
      // Hide directly. Do not call hidePopover(): it re-validates against the
      // popover attribute, which may now be removed (No Popover), and would
      // throw NotSupportedError. This mirrors the spec hide with throw=false.
      this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
      this._popoverState = "hidden";
      const target = this;
      setTimeout(() => { try { target.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
    }
  }
  // HTMLDialogElement members (live on Element.prototype like popover/input;
  // meaningful only when localName === 'dialog'). Modal top-layer/focus/render
  // is layout (out of scope); the open state, returnValue, and beforetoggle/
  // toggle/close/cancel events are JS-observable and implemented here.
  get open() { return this.hasAttribute('open'); }
  set open(v) { if (v) { if (!this.hasAttribute('open')) this.setAttribute('open', ''); } else if (this.hasAttribute('open')) { this.removeAttribute('open'); this._dialogModal = false; } }
  get returnValue() { return this._returnValue != null ? this._returnValue : ''; }
  set returnValue(v) { this._returnValue = String(v); }
  get oncancel() { return this._oncancel || null; }
  set oncancel(f) { this._oncancel = typeof f === 'function' ? f : null; }
  get onclose() { return this._onclose || null; }
  set onclose(f) { this._onclose = typeof f === 'function' ? f : null; }
  get closedBy() { const v = (this.getAttribute('closedby') || '').toLowerCase(); return (v === 'any' || v === 'closerequest' || v === 'none') ? v : 'auto'; }
  set closedBy(v) { this.setAttribute('closedby', String(v)); }
  show() {
    if (this.hasAttribute('open')) { if (this._dialogModal) throw new DOMException("The dialog is already open as a modal dialog.", "InvalidStateError"); return; }
    const before = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(before)) return;
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', ''); this._dialogModal = false;
    const self = this; setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  showModal() {
    if (this.hasAttribute('open')) throw new DOMException("The dialog is already open.", "InvalidStateError");
    if (!this.isConnected) throw new DOMException("The dialog is not connected to a document.", "InvalidStateError");
    const before = new ToggleEvent("beforetoggle", { cancelable: true, oldState: "closed", newState: "open" });
    if (!this.dispatchEvent(before)) return;
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', ''); this._dialogModal = true;
    const self = this; setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "closed", newState: "open" })); } catch (e) {} }, 0);
  }
  _dialogClose(result, fireClose) {
    if (!this.hasAttribute('open')) return;
    this.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    this.removeAttribute('open'); this._dialogModal = false;
    if (result !== undefined) this._returnValue = String(result);
    const self = this;
    setTimeout(() => { try { self.dispatchEvent(new ToggleEvent("toggle", { oldState: "open", newState: "closed" })); } catch (e) {} }, 0);
    if (fireClose) setTimeout(() => { try { self.dispatchEvent(new Event('close', { bubbles: false, cancelable: false })); } catch (e) {} }, 0);
  }
  close(result) { this._dialogClose(result, true); }
  requestClose(result) {
    if (!this.hasAttribute('open')) return;
    if (this._dialogCancelFiring) return; // no re-entrant cancel
    this._dialogCancelFiring = true;
    let canceled = false;
    try { const ev = new Event('cancel', { bubbles: false, cancelable: true }); this.dispatchEvent(ev); canceled = ev.defaultPrevented; }
    finally { this._dialogCancelFiring = false; }
    if (canceled) return;
    this._dialogClose(result, true);
  }
  attachInternals() {
    const reg = (typeof customElements !== 'undefined' && customElements._registry) ? customElements._registry : null;
    if (!reg || !reg.get(this.localName)) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to non-custom elements.", "NotSupportedError");
    if (this.getAttribute('is')) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to a customized built-in element.", "NotSupportedError");
    if (this._internalsAttached) throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the specified element was already attached.", "NotSupportedError");
    this._internalsAttached = true;
    return new ElementInternals(this);
  }
  get value() {
    const tag = this.localName;
    if (tag === 'select') {
      // Selected option wins; otherwise first option (HTML default).
      const opts = this.querySelectorAll('option');
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].selected) {
          return opts[i].getAttribute('value') !== null ? opts[i].getAttribute('value') : opts[i].textContent;
        }
      }
      if (opts.length) return opts[0].getAttribute('value') !== null ? opts[0].getAttribute('value') : opts[0].textContent;
      return '';
    }
    if (_formValues[this._nid] !== undefined) return _formValues[this._nid];
    if (tag === 'textarea') return this.textContent;
    if (tag === 'option') {
      const attr = this.getAttribute('value');
      return attr !== null ? attr : this.textContent;
    }
    if (tag === 'input') {
      const itype = (this.getAttribute('type') || '').toLowerCase();
      if (itype === 'checkbox' || itype === 'radio') {
        // A checkbox/radio with no value attribute defaults to "on" in a real
        // browser, not the empty string.
        const attr = this.getAttribute('value');
        return attr !== null ? attr : 'on';
      }
      if (itype === 'file') {
        // Chrome exposes a file input's value as C:\fakepath\<first filename>.
        return (this._files && this._files.length) ? ('C:\\fakepath\\' + this._files[0].name) : '';
      }
    }
    return this.getAttribute("value") || "";
  }
  // FileList for <input type=file>, populated by DOM.setFileInputFiles (Puppeteer
  // uploadFile / Playwright setInputFiles). null for non-file inputs, matching
  // the DOM. See __obscura_setInputFiles (issue #359).
  get files() {
    if (this.localName !== 'input') return undefined;
    if ((this.getAttribute('type') || '').toLowerCase() !== 'file') return null;
    return this._files || _emptyFileList();
  }
  set value(v) {
    const tag = this.localName;
    if (tag === 'select') {
      // Set selected on matching option, clear on others. Puppeteer's
      // page.select(selector, value) round-trips through this setter.
      const wanted = String(v);
      const opts = this.querySelectorAll('option');
      let matched = false;
      for (let i = 0; i < opts.length; i++) {
        const attrV = opts[i].getAttribute('value');
        const optVal = attrV !== null ? attrV : opts[i].textContent;
        if (optVal === wanted) { opts[i].selected = true; matched = true; }
        else { opts[i].selected = false; }
      }
      if (matched) try { this.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      return;
    }
    _formValues[this._nid] = String(v);
    if (tag === 'textarea') {
      this.textContent = String(v);
    }
  }
  get min() { return this.getAttribute('min') || ''; }
  set min(v) { this.setAttribute('min', v); }
  get max() { return this.getAttribute('max') || ''; }
  set max(v) { this.setAttribute('max', v); }
  get step() { return this.getAttribute('step') || ''; }
  set step(v) { this.setAttribute('step', v); }
  _inputType() { return this.localName === 'input' ? (this.getAttribute('type') || 'text').toLowerCase() : ''; }
  get valueAsNumber() {
    const t = this._inputType();
    if (!_INPUT_NUM_TYPES[t]) return NaN;
    if (t === 'range') {
      let minN = _inputParseNumber('range', this.getAttribute('min')); if (isNaN(minN)) minN = 0;
      let maxN = _inputParseNumber('range', this.getAttribute('max')); if (isNaN(maxN)) maxN = 100;
      if (maxN < minN) maxN = minN;
      const v = _inputParseNumber('range', this.value);
      let n = isNaN(v) ? (minN + (maxN - minN) / 2) : v;
      if (n < minN) n = minN; if (n > maxN) n = maxN;
      return n;
    }
    return _inputParseNumber(t, this.value);
  }
  set valueAsNumber(n) {
    const t = this._inputType();
    if (!_INPUT_NUM_TYPES[t]) throw new DOMException("Failed to set the 'valueAsNumber' property on 'HTMLInputElement': This input element does not support Number values.", 'InvalidStateError');
    n = Number(n);
    if (isNaN(n)) { this.value = ''; return; }
    if (!isFinite(n)) throw new TypeError("Failed to set the 'valueAsNumber' property on 'HTMLInputElement': The value provided is infinite.");
    this.value = _inputFormatNumber(t, n);
  }
  get valueAsDate() {
    const t = this._inputType();
    if (!_INPUT_DATE_TYPES[t]) return null;
    const n = _inputParseNumber(t, this.value);
    if (isNaN(n)) return null;
    if (t === 'month') { const y = 1970 + Math.floor(n / 12); const mo = ((n % 12) + 12) % 12; return new Date(Date.UTC(y, mo, 1)); }
    return new Date(n);
  }
  set valueAsDate(d) {
    const t = this._inputType();
    if (!_INPUT_DATE_TYPES[t]) throw new DOMException("Failed to set the 'valueAsDate' property on 'HTMLInputElement': This input element does not support Date values.", 'InvalidStateError');
    if (d === null) { this.value = ''; return; }
    if (!(d instanceof Date)) throw new TypeError("Failed to set the 'valueAsDate' property on 'HTMLInputElement': The provided value is not a Date.");
    const ms = d.getTime();
    if (isNaN(ms)) { this.value = ''; return; }
    if (t === 'month') { this.value = _inputFormatNumber('month', (d.getUTCFullYear() - 1970) * 12 + d.getUTCMonth()); return; }
    this.value = _inputFormatNumber(t, ms);
  }
  stepUp(n) { this._stepBy(n === undefined ? 1 : (n | 0)); }
  stepDown(n) { this._stepBy(-(n === undefined ? 1 : (n | 0))); }
  _stepBy(delta) {
    const t = this._inputType();
    const stepAttr = this.getAttribute('step');
    if (!_INPUT_STEP_SCALE[t] || (stepAttr && stepAttr.trim().toLowerCase() === 'any')) {
      throw new DOMException("Failed to execute 'stepUp' on 'HTMLInputElement': This form element does not have allowed value steps.", 'InvalidStateError');
    }
    const scale = _INPUT_STEP_SCALE[t];
    let stepN = _INPUT_STEP_DEFAULT[t];
    if (stepAttr) { const s = Number(stepAttr); if (isFinite(s) && s > 0) stepN = s; }
    const allowed = stepN * scale;
    const minN = _inputParseNumber(t, this.getAttribute('min'));
    const maxN = _inputParseNumber(t, this.getAttribute('max'));
    const stepBase = isNaN(minN) ? 0 : minN;
    let value = this.valueAsNumber;
    if (isNaN(value)) value = isNaN(minN) ? 0 : minN;
    value += delta * allowed;
    value = stepBase + Math.round((value - stepBase) / allowed) * allowed;
    const effMin = (t === 'range' && isNaN(minN)) ? 0 : minN;
    const effMax = (t === 'range' && isNaN(maxN)) ? 100 : maxN;
    if (!isNaN(effMin) && value < effMin) value = effMin;
    if (!isNaN(effMax) && value > effMax) value = effMax;
    this.value = _inputFormatNumber(t, value);
  }
  get checked() {
    if (_formChecked[this._nid] !== undefined) return _formChecked[this._nid];
    return this.hasAttribute("checked");
  }
  set checked(v) { _formChecked[this._nid] = !!v; }
  get selected() {
    if (this._selected !== undefined) return this._selected;
    return this.hasAttribute("selected");
  }
  set selected(v) { this._selected = !!v; }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get type() { return this.getAttribute("type") || (this.localName === "input" ? "text" : ""); }
  set type(v) { this.setAttribute("type", v); }
  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }
  get placeholder() { return this.getAttribute("placeholder") || ""; }
  set placeholder(v) { this.setAttribute("placeholder", v); }
  // For <a>/<area>, href returns the resolved absolute URL (the spec behavior,
  // and what scrapers want). It uses op_url_resolve, which returns just the
  // resolved string, rather than the full-component op the decomposition
  // members use. Other elements reflect the raw attribute.
  get href() {
    const ln = this.localName;
    // SVG href-bearing elements reflect href as an SVGAnimatedString (with the
    // legacy xlink:href as a fallback), not a resolved URL string. Checked
    // before the HTML <a> path because an SVG <a> also has localName 'a'.
    if (this.namespaceURI === "http://www.w3.org/2000/svg" &&
        (ln === 'a' || ln === 'image' || ln === 'use' || ln === 'script' ||
         ln === 'pattern' || ln === 'filter' || ln === 'textPath' || ln === 'mpath' ||
         ln === 'linearGradient' || ln === 'radialGradient' || ln === 'feImage' || ln === 'tref')) {
      if (!this._svgHref) this._svgHref = new SVGAnimatedString(this, "href", "xlink:href");
      return this._svgHref;
    }
    if (ln === 'a' || ln === 'area') {
      const raw = this.getAttribute('href');
      if (raw === null) return '';
      // Legacy-charset document: href must reflect the encoding-override query.
      if (!_docIsUtf8()) { const u = _elemHrefURL(this); return u ? u.href : raw; }
      const r = _urlResolveOp(raw, _anchorBase());
      return r !== null ? r : raw;
    }
    return this.getAttribute("href") || "";
  }
  set href(v) { this.setAttribute("href", v); }
  // HTMLHyperlinkElementUtils URL-decomposition members, live on <a>/<area>.
  get protocol() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.protocol : ''; }
  set protocol(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'protocol', v); }
  get username() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.username : ''; }
  set username(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'username', v); }
  get password() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.password : ''; }
  set password(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'password', v); }
  get host() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.host : ''; }
  set host(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'host', v); }
  get hostname() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.hostname : ''; }
  set hostname(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'hostname', v); }
  get port() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.port : ''; }
  set port(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'port', v); }
  get pathname() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.pathname : ''; }
  set pathname(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'pathname', v); }
  get search() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.search : ''; }
  set search(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'search', v); }
  get hash() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.hash : ''; }
  set hash(v) { if (this.localName === 'a' || this.localName === 'area') _setElemHrefPart(this, 'hash', v); }
  get origin() { const u = (this.localName === 'a' || this.localName === 'area') ? _elemHrefURL(this) : null; return u ? u.origin : ''; }
  get src() {
    // IDL reflection: HTMLScriptElement/HTMLImageElement/etc. `.src` returns the
    // resolved absolute URL, not the literal attribute. Loaders that compute their
    // base via `new URL(document.currentScript.src).origin` break on a relative
    // value (issue #255). getAttribute("src") still returns the literal.
    const v = this.getAttribute("src");
    if (!v) return "";
    try { return new URL(v, globalThis.location?.href || "about:blank").href; }
    catch (e) { return v; }
  }
  set src(v) {
    this.setAttribute("src", v);
    if (this.localName === 'iframe' && v && v !== 'about:blank') {
      __registerDynamicIframe(this);
      this._loadIframeSrc(v);
    } else if (this.localName === 'img' && v && !Object.getOwnPropertyDescriptor(this, 'src')) {
      // No real image decoder: emulate a successful decode so `<img>` elements
      // created via document.createElement('img') (or parsed markup) fire load —
      // `new Image()` already does via its own per-instance `src` override, so
      // the own-descriptor guard above skips those to avoid a double load event.
      // Fingerprint/analytics code that sets an <img>.src and awaits
      // load/onload (e.g. iphey/MixVisit) would otherwise hang forever.
      const el = this;
      el.complete = false;
      setTimeout(function () {
        el.complete = true;
        try { el.dispatchEvent(new Event('load')); } catch (e) {}
      }, 0);
    }
  }
  _loadIframeSrc(url) {
    let fullUrl = url;
    if (!url.includes('://')) {
      try { fullUrl = new URL(url, _domParse("document_url") || "about:blank").href; } catch(e) {}
    }
    const el = this;
    // Fire load via dispatchEvent, not a direct el.onload() call: dispatchEvent
    // invokes BOTH the onload IDL attribute handler AND every
    // addEventListener('load') listener (the standard idiom, used by e.g. the
    // Prismic toolbar's iframe-client handshake that iphey embeds). The old
    // direct-call path only ran the onload property, so code awaiting the iframe
    // load via addEventListener hung forever.
    const _fireLoad = () => { try { el.dispatchEvent(new Event('load')); } catch (e) {} };
    fetch(fullUrl, {mode: 'no-cors'}).then(async resp => {
      if (resp.ok || resp.type === 'opaque') {
        const html = await resp.text();
        el._iframeDoc = new _IframeDocument(html, fullUrl, el);
        el._iframeWin = new _IframeWindow(el._iframeDoc, fullUrl);
      } else {
        el._iframeDoc = new _IframeDocument('<!DOCTYPE html><html><head></head><body></body></html>', fullUrl, el);
        el._iframeWin = new _IframeWindow(el._iframeDoc, fullUrl);
      }
      _fireLoad();
    }).catch(() => {
      el._iframeDoc = new _IframeDocument('<!DOCTYPE html><html><head></head><body></body></html>', fullUrl, el);
      el._iframeWin = new _IframeWindow(el._iframeDoc, fullUrl);
      _fireLoad();
    });
  }
  get contentDocument() {
    if (this.localName !== 'iframe') return undefined;
    const frameId = this.__obscuraFrameId || this.getAttribute('data-obscura-frame-id');
    if (frameId) {
      try {
        const meta = _frameMeta(frameId);
        if (meta && meta.sameOrigin === false) return null;
        const html = _frameHtml(frameId);
        if (html) {
          this._iframeDoc = new _IframeDocument(html, meta?.url || this.src || 'about:blank', this);
          this._iframeWin = new _IframeWindow(this._iframeDoc, meta?.url || this.src || 'about:blank');
          this._iframeWin.frameElement = this;
          this._iframeWin.parent = globalThis;
          this._iframeWin.top = globalThis.top || globalThis;
          return this._iframeDoc;
        }
      } catch (e) {}
    }
    if (this._iframeDoc) {
      const pageOrigin = (function(){ try { return new URL(_domParse("document_url")).origin; } catch(e) { return ''; } })();
      const iframeOrigin = (function(url){ try { return new URL(url).origin; } catch(e) { return ''; } })(this.src);
      if (pageOrigin === iframeOrigin || this.src === '' || this.src === 'about:blank' || !this.src.includes('://')) {
        return this._iframeDoc;
      }
      return null;
    }
    if (!this._iframeDoc) {
      this._iframeDoc = new _IframeDocument('<!DOCTYPE html><html><head></head><body></body></html>', 'about:blank', this);
      this._iframeWin = new _IframeWindow(this._iframeDoc, 'about:blank');
    }
    return this._iframeDoc;
  }
  get contentWindow() {
    if (this.localName !== 'iframe') return undefined;
    const frameId = this.__obscuraFrameId || this.getAttribute('data-obscura-frame-id');
    if (frameId) {
      try {
        const meta = _frameMeta(frameId);
        if (meta && meta.sameOrigin === false) {
          if (!this._iframeWin) {
            this._iframeDoc = null;
            this._iframeWin = new _IframeWindow({ body: null }, meta?.url || this.src || 'about:blank');
            this._iframeWin.frameElement = this;
            this._iframeWin.parent = globalThis;
            this._iframeWin.top = globalThis.top || globalThis;
          }
          return this._iframeWin;
        }
      } catch (e) {}
    }
    if (!this._iframeWin) {
      if (this.parentNode === null) return null;
      this.contentDocument;
    }
    return this._iframeWin;
  }
  get action() {
    const action = this.getAttribute("action") || _domParse("document_url") || "";
    try { return new URL(action, _domParse("document_url") || "about:blank").href; } catch(e) { return action; }
  }
  set action(v) { this.setAttribute("action", v); }
  get method() { return this.getAttribute("method") || "get"; }
  set method(v) { this.setAttribute("method", v); }
  get form() {
    let p = this.parentNode;
    while (p && p.localName !== 'form') p = p.parentNode;
    return p;
  }
  get options() {
    if (this.localName !== 'select') return [];
    return HTMLCollection._from(this.querySelectorAll('option'));
  }
  get selectedIndex() {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].selected || opts[i].hasAttribute('selected')) return i;
    }
    return -1;
  }
  set selectedIndex(v) {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) {
      opts[i]._selected = (i === v);
    }
  }
  // Per the HTML spec, the submit() METHOD submits the form WITHOUT firing a
  // cancelable `submit` event — a page's submit listener cannot veto it. Only
  // requestSubmit() and user-initiated submits fire the cancelable event.
  // Conflating the two broke sites whose submit listener preventDefault()s the
  // native submit and then calls form.submit() from a callback (e.g. an
  // invisible-reCAPTCHA data-callback) to actually send the form.
  submit(submitter) {
    this._navigateSubmit(submitter);
  }
  requestSubmit(submitter) {
    // Per spec, a given submitter must be a submit button owned by this form;
    // both checks run before the submit event fires. A missing/null submitter
    // means "submit from the form itself".
    if (submitter !== undefined && submitter !== null) {
      if (!_isSubmitButton(submitter)) {
        throw new TypeError(
          "Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not a submit button."
        );
      }
      if (submitter.form !== this) {
        throw new DOMException(
          "Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not owned by this form element.",
          'NotFoundError'
        );
      }
    }
    const cancelled = !this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (cancelled) return;
    this._navigateSubmit(submitter);
  }
  _navigateSubmit(submitter) {
    const pairs = [];
    const fields = this.querySelectorAll('input, select, textarea');
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const name = f.getAttribute('name');
      if (!name) continue;
      if (f.getAttribute('disabled') !== null) continue;
      const tag = f.localName;
      const type = (f.getAttribute('type') || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !f.checked) continue;
      if (type === 'file' || type === 'reset') continue;
      if (type === 'button') continue;
      if (type === 'submit' || tag === 'button') {
        if (submitter && f !== submitter) continue;
        if (!submitter) continue; // default submit: don't include submit button value
      }

      let val;
      if (tag === 'select') {
        const opt = f.querySelector('option[selected]') || f.querySelector('option');
        val = opt ? (opt.getAttribute('value') !== null ? opt.getAttribute('value') : opt.textContent) : '';
      } else if (tag === 'textarea') {
        val = f.value || f.textContent || '';
      } else {
        val = f.value !== undefined ? f.value : (f.getAttribute('value') || '');
      }
      const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/!/g, '%21');
      pairs.push(enc(name) + '=' + enc(val));
    }

    const action = this.getAttribute('action') || '';
    const method = (this.getAttribute('method') || 'GET').toUpperCase();
    const baseUrl = globalThis.location?.href || 'about:blank';
    let targetUrl;
    try { targetUrl = new URL(action, baseUrl).href; } catch(e) { targetUrl = action; }

    const encoded = pairs.join('&');
    if (method === 'POST') {
      __obscura_core.ops.op_navigate(targetUrl, 'POST', encoded);
    } else {
      const sep = targetUrl.includes('?') ? '&' : '?';
      __obscura_core.ops.op_navigate(targetUrl + (encoded ? sep + encoded : ''), 'GET', '');
    }
  }
  reset() {
    this.dispatchEvent(new Event('reset', { bubbles: true }));
  }
  get dataset() {
    if (this._dataset) return this._dataset;
    const el = this;
    const attrFor = (k) => "data-" + _cssCamelToKebab(k);
    // camelCase the part after the `data-` prefix, e.g. data-foo-bar -> fooBar.
    const dataKeys = () => el.getAttributeNames()
      .filter((n) => n.startsWith("data-"))
      .map((n) => _cssKebabToCamel(n.slice(5)));
    this._dataset = new Proxy({}, {
      get(_, k) { if (typeof k !== "string") return undefined; return el.hasAttribute(attrFor(k)) ? el.getAttribute(attrFor(k)) : undefined; },
      set(_, k, v) { el.setAttribute(attrFor(k), String(v)); return true; },
      has(_, k) { return typeof k === "string" && el.hasAttribute(attrFor(k)); },
      deleteProperty(_, k) { if (typeof k === "string") el.removeAttribute(attrFor(k)); return true; },
      ownKeys() { return dataKeys(); },
      getOwnPropertyDescriptor(_, k) {
        if (typeof k === "string" && el.hasAttribute(attrFor(k))) {
          return { value: el.getAttribute(attrFor(k)), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
    return this._dataset;
  }
  get offsetWidth() {
    if (this._isViewportRoot()) return globalThis.innerWidth || 1280;
    return Math.round(_elemBox(this).w);
  }
  get offsetHeight() {
    if (this._isViewportRoot()) return globalThis.innerHeight || 720;
    return Math.round(_elemBox(this).h);
  }
  get offsetTop() { return 0; } get offsetLeft() { return 0; }
  // documentElement / body / window expose VIEWPORT geometry, not their own content box.
  // Puppeteer's #clickableBox clips boxes to document.documentElement.clientWidth/Height;
  // returning 100x20 there made every element appear off-screen and broke .click().
  get clientWidth() { return this._isViewportRoot() ? (globalThis.innerWidth || 1280) : 100; }
  get clientHeight() { return this._isViewportRoot() ? (globalThis.innerHeight || 720) : 20; }
  get scrollWidth() { return this._isViewportRoot() ? (globalThis.innerWidth || 1280) : 100; }
  get scrollHeight() { return this._isViewportRoot() ? (globalThis.innerHeight || 720) : 20; }
  _isViewportRoot() {
    const t = this.tagName;
    return t === 'HTML' || t === 'BODY';
  }
  // No layout engine, so there is no real overflow to scroll. We still track a
  // scroll offset so scrollTop/scrollLeft round-trip and the scroll methods
  // below can report a position, which is what infinite-scroll code reads back.
  get scrollTop() { return this._scrollTop || 0; }
  set scrollTop(v) { v = +v; this._scrollTop = Number.isFinite(v) && v > 0 ? v : 0; }
  get scrollLeft() { return this._scrollLeft || 0; }
  set scrollLeft(v) { v = +v; this._scrollLeft = Number.isFinite(v) && v > 0 ? v : 0; }
  getBoundingClientRect() {
    globalThis.__obscura_click_target = this;
    // documentElement and body span the full viewport. Without this every
    // hit test against them clips down to a 100x20 synthetic cell and
    // Document.elementFromPoint can never recurse into their children.
    if (this._isViewportRoot()) {
      const vw = globalThis.innerWidth || 1280;
      const vh = globalThis.innerHeight || 720;
      return {
        x: 0, y: 0, width: vw, height: vh,
        top: 0, right: vw, bottom: vh, left: 0,
        toJSON() { return this; },
      };
    }
    // No layout engine, but Playwright's actionability polling needs each
    // element to occupy a stable, distinct rect so hit-testing can pick the
    // right one (issue #45). Synthesize a deterministic position from the
    // node id: every nid maps to a unique cell in a 12-column grid, sized
    // to fit a 1280x720 viewport. Stable across reads, different per node.
    const VW = 1280, VH = 720, COLS = 12, CW = 100, CH = 20, GX = 110, GY = 30;
    const rowsPerScreen = Math.max(1, Math.floor((VH - 10) / GY));
    const cell = this._nid | 0;
    const col = ((cell * 7) | 0) % COLS;
    const row = (((cell * 13) | 0) >> 0) % rowsPerScreen;
    const x = 10 + col * GX;
    const y = 10 + row * GY;
    // Font-probe elements measure per family (Fonts detection); everything
    // else gets a deterministic sub-pixel box (Client Rects / element-geometry
    // fingerprint) instead of a flat round 100x20. Both via _elemBox.
    const box = _elemBox(this);
    const w = box.w, h = box.h;
    return {
      x, y, width: w, height: h,
      top: y, right: x + w, bottom: y + h, left: x,
      toJSON() { return this; },
    };
  }
  getClientRects() { return new DOMRectList([this.getBoundingClientRect()]); }
  // No layout engine: a stub that always returns true unblocks Playwright's
  // actionability polling. With a real layout we'd check display, visibility,
  // opacity and rect dimensions per spec.
  checkVisibility(opts) { return true; }
  // ARIA reflection properties. Without an accessibility tree we expose the
  // raw aria-* attributes so Playwright's getByRole / getByLabel locators can
  // at least find elements that author them explicitly.
  get role() { return this.getAttribute('role'); }
  set role(v) { if (v == null) this.removeAttribute('role'); else this.setAttribute('role', String(v)); }
  get ariaLabel() { return this.getAttribute('aria-label'); }
  set ariaLabel(v) { if (v == null) this.removeAttribute('aria-label'); else this.setAttribute('aria-label', String(v)); }
  get ariaRoleDescription() { return this.getAttribute('aria-roledescription'); }
  set ariaRoleDescription(v) { if (v == null) this.removeAttribute('aria-roledescription'); else this.setAttribute('aria-roledescription', String(v)); }
  get ariaChecked() { return this.getAttribute('aria-checked'); }
  set ariaChecked(v) { if (v == null) this.removeAttribute('aria-checked'); else this.setAttribute('aria-checked', String(v)); }
  get ariaDisabled() { return this.getAttribute('aria-disabled'); }
  set ariaDisabled(v) { if (v == null) this.removeAttribute('aria-disabled'); else this.setAttribute('aria-disabled', String(v)); }
  get ariaExpanded() { return this.getAttribute('aria-expanded'); }
  set ariaExpanded(v) { if (v == null) this.removeAttribute('aria-expanded'); else this.setAttribute('aria-expanded', String(v)); }
  get ariaHidden() { return this.getAttribute('aria-hidden'); }
  set ariaHidden(v) { if (v == null) this.removeAttribute('aria-hidden'); else this.setAttribute('aria-hidden', String(v)); }
  get ariaSelected() { return this.getAttribute('aria-selected'); }
  set ariaSelected(v) { if (v == null) this.removeAttribute('aria-selected'); else this.setAttribute('aria-selected', String(v)); }
  scrollIntoView() { globalThis.__obscura_click_target = this; }
  // scrollTo/scrollBy/scroll accept either (x, y) or a ScrollToOptions object.
  // Without layout the offset cannot be clamped to a real max, but updating it
  // and firing a scroll event lets scroll-driven lazy loaders advance instead
  // of throwing "scrollBy is not a function".
  scrollTo(x, y) {
    let left, top;
    if (x !== null && typeof x === 'object') { left = x.left; top = x.top; }
    else { left = x; top = y; }
    if (left !== undefined) this.scrollLeft = +left || 0;
    if (top !== undefined) this.scrollTop = +top || 0;
    this._fireScroll();
  }
  scroll(x, y) { this.scrollTo(x, y); }
  scrollBy(x, y) {
    let dl, dt;
    if (x !== null && typeof x === 'object') { dl = x.left; dt = x.top; }
    else { dl = x; dt = y; }
    this.scrollLeft = (this.scrollLeft || 0) + (+dl || 0);
    this.scrollTop = (this.scrollTop || 0) + (+dt || 0);
    this._fireScroll();
  }
  _fireScroll() {
    const self = this;
    setTimeout(() => { try { self.dispatchEvent(new Event('scroll', { bubbles: false })); } catch (e) {} }, 0);
  }
  animate(keyframes, options) {
    const duration = typeof options === 'number' ? options : (options?.duration || 0);
    return {
      finished: Promise.resolve(), currentTime: 0, playState: 'finished',
      effect: { getComputedTiming() { return { duration }; } },
      cancel(){}, finish(){}, play(){}, pause(){}, reverse(){},
      addEventListener(){}, removeEventListener(){},
      onfinish: null, oncancel: null,
    };
  }
  getAnimations() { return []; }
  get isConnected() {
    var node = this;
    while (node) {
      if (node.nodeType === 9) return true;
      node = node.parentNode;
    }
    return false;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  append(...nodes) { for (const n of _convertNodes(nodes)) this.appendChild(n); }
  prepend(...nodes) {
    const ref = this.firstChild;
    for (const n of _convertNodes(nodes)) {
      if (ref) this.insertBefore(n, ref); else this.appendChild(n);
    }
  }
  replaceChildren(...nodes) {
    const converted = _convertNodes(nodes);
    let c;
    while ((c = this.firstChild)) this.removeChild(c);
    for (const n of converted) this.appendChild(n);
  }
}

// WHATWG "convert nodes into a node": a Node argument passes through, anything
// else is stringified into a Text node, so e.g. append(null) inserts the text
// "null" and append(undefined) inserts "undefined" per the (Node or DOMString)
// union, rather than throwing.
function _convertNodes(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n && typeof n._nid === "number") out.push(n);
    else out.push(document.createTextNode(String(n)));
  }
  return out;
}

// ---- Reflected IDL attributes (WHATWG) ---------------------------------------
// Installed ONCE on Element.prototype as shared getter/setter pairs. This is
// data-driven so there is no per-element defineProperty: element creation and
// the querySelector/mutation hot paths are unaffected (each access is a normal
// prototype getter that reads the backing attribute). Covers the global content
// attributes reflected on every element plus the ARIAMixin (aria-* + ariaXxx).
(function installElementReflectors() {
  const P = Element.prototype;
  const def = (name, get, set) => {
    if (Object.prototype.hasOwnProperty.call(P, name)) return; // never clobber an existing member
    Object.defineProperty(P, name, { get, set, enumerable: true, configurable: true });
  };
  // WHATWG "rules for parsing integers"; returns a JS number or null on failure.
  const parseIntAttr = (s) => {
    if (s === null || s === undefined) return null;
    const m = /^[ \t\n\f\r]*([+-]?[0-9]+)/.exec(String(s));
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };
  // IDL `long` conversion (ToInt32): finite, truncated, wrapped to 32-bit signed.
  const toLong = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    n = Math.trunc(n) % 4294967296;
    if (n >= 2147483648) n -= 4294967296;
    else if (n < -2147483648) n += 4294967296;
    return n;
  };
  // DOMString reflect: get -> attribute or ""; set -> setAttribute(String(v)).
  const reflectStr = (name, attr) => def(name,
    function () { const v = this.getAttribute(attr); return v === null ? "" : v; },
    function (v) { this.setAttribute(attr, String(v)); });
  // boolean reflect: get -> hasAttribute; set -> truthy ? add("") : remove.
  const reflectBool = (name, attr) => def(name,
    function () { return this.hasAttribute(attr); },
    function (v) { if (v) this.setAttribute(attr, ""); else this.removeAttribute(attr); });
  // long reflect: get -> parse else default (static value or per-element fn);
  // set -> setAttribute(String(ToInt32(v))).
  const reflectLong = (name, attr, dflt) => def(name,
    function () {
      const r = parseIntAttr(this.getAttribute(attr));
      if (r !== null && r >= -2147483648 && r <= 2147483647) return r;
      return typeof dflt === "function" ? dflt.call(this) : dflt;
    },
    function (v) { this.setAttribute(attr, String(toLong(v))); });
  // enumerated reflect: get -> canonical (lowercased) keyword, else missing/
  // invalid default; set -> setAttribute(String(v)) (canonicalization on get).
  const reflectEnum = (name, attr, keywords, missingDefault, invalidDefault) => def(name,
    function () {
      const v = this.getAttribute(attr);
      if (v === null) return missingDefault;
      const lc = String(v).toLowerCase();
      return keywords.indexOf(lc) !== -1 ? lc : invalidDefault;
    },
    function (v) { this.setAttribute(attr, String(v)); });
  // nullable DOMString reflect (ARIA): get -> attribute or null; set -> null/
  // undefined removes, else setAttribute(String(v)).
  const reflectNullable = (name, attr) => def(name,
    function () { return this.getAttribute(attr); },
    function (v) { if (v === null || v === undefined) this.removeAttribute(attr); else this.setAttribute(attr, String(v)); });

  // Global content attributes reflected on every element (HTML "global attributes").
  reflectStr("title", "title");
  reflectStr("lang", "lang");
  reflectStr("accessKey", "accesskey");
  reflectStr("slot", "slot");
  reflectEnum("dir", "dir", ["ltr", "rtl", "auto"], "", "");
  reflectBool("autofocus", "autofocus");
  reflectBool("hidden", "hidden");
  // tabIndex default is element-dependent (0 for natively-focusable, else -1);
  // reflection.js does not assert it, but match the common case anyway.
  reflectLong("tabIndex", "tabindex", function () {
    const ln = this.localName;
    if (ln === "a" || ln === "area" || ln === "link") return this.hasAttribute("href") ? 0 : -1;
    return (ln === "button" || ln === "input" || ln === "select" || ln === "textarea" || ln === "iframe") ? 0 : -1;
  });

  // ARIAMixin: aria-* content attributes reflected as nullable DOMString IDL
  // properties (ariaAtomic <-> aria-atomic, ...).
  const ARIA = {
    ariaAtomic: "aria-atomic", ariaAutoComplete: "aria-autocomplete", ariaBrailleLabel: "aria-braillelabel",
    ariaBrailleRoleDescription: "aria-brailleroledescription", ariaBusy: "aria-busy", ariaChecked: "aria-checked",
    ariaColCount: "aria-colcount", ariaColIndex: "aria-colindex", ariaColIndexText: "aria-colindextext",
    ariaColSpan: "aria-colspan", ariaCurrent: "aria-current", ariaDescription: "aria-description",
    ariaDisabled: "aria-disabled", ariaExpanded: "aria-expanded", ariaHasPopup: "aria-haspopup",
    ariaHidden: "aria-hidden", ariaInvalid: "aria-invalid", ariaKeyShortcuts: "aria-keyshortcuts",
    ariaLabel: "aria-label", ariaLevel: "aria-level", ariaLive: "aria-live", ariaModal: "aria-modal",
    ariaMultiLine: "aria-multiline", ariaMultiSelectable: "aria-multiselectable", ariaOrientation: "aria-orientation",
    ariaPlaceholder: "aria-placeholder", ariaPosInSet: "aria-posinset", ariaPressed: "aria-pressed",
    ariaReadOnly: "aria-readonly", ariaRelevant: "aria-relevant", ariaRequired: "aria-required",
    ariaRoleDescription: "aria-roledescription", ariaRowCount: "aria-rowcount", ariaRowIndex: "aria-rowindex",
    ariaRowIndexText: "aria-rowindextext", ariaRowSpan: "aria-rowspan", ariaSelected: "aria-selected",
    ariaSetSize: "aria-setsize", ariaSort: "aria-sort", ariaValueMax: "aria-valuemax",
    ariaValueMin: "aria-valuemin", ariaValueNow: "aria-valuenow", ariaValueText: "aria-valuetext",
  };
  for (const prop in ARIA) reflectNullable(prop, ARIA[prop]);
})();

function _parseXPathPredicate(part) {
  part = String(part || "").trim();
  let m = part.match(/^@([A-Za-z_][\w:.-]*)(?:\s*=\s*(["'])(.*?)\2)?$/);
  if (m) return { kind: "attr", name: m[1], value: m[3] };
  m = part.match(/^contains\(\s*@([A-Za-z_][\w:.-]*)\s*,\s*(["'])(.*?)\2\s*\)$/);
  if (m) return { kind: "contains", name: m[1], value: m[3] };
  m = part.match(/^starts-with\(\s*@([A-Za-z_][\w:.-]*)\s*,\s*(["'])(.*?)\2\s*\)$/);
  if (m) return { kind: "startsWith", name: m[1], value: m[3] };
  return null;
}

function _xpathPredicateParts(body) {
  const out = [];
  let quote = null, start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (body.slice(i, i + 5).toLowerCase() === " and " || body.slice(i, i + 4).toLowerCase() === "and ") {
      const before = body.slice(start, i).trim();
      if (before) out.push(before);
      i += body[i] === " " ? 4 : 3;
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last) out.push(last);
  return out.length ? out : [body];
}

function _xpathFindNodes(expression, contextNode) {
  expression = String(expression || "").trim();
  contextNode = contextNode || document;
  const m = expression.match(/^(?:\.?\/\/)([A-Za-z*][\w:.-]*|\*)?((?:\[[^\]]+\])*)$/);
  if (!m) return [];
  const tag = !m[1] || m[1] === "*" ? "*" : m[1];
  const predicates = [];
  const predText = m[2] || "";
  for (const match of predText.matchAll(/\[([^\]]+)\]/g)) {
    for (const part of _xpathPredicateParts(match[1])) {
      const pred = _parseXPathPredicate(part);
      if (pred) predicates.push(pred);
    }
  }
  const source = typeof contextNode.querySelectorAll === "function"
    ? contextNode.querySelectorAll(tag)
    : [];
  return Array.prototype.filter.call(source, (node) => {
    for (const pred of predicates) {
      const value = node.getAttribute?.(pred.name);
      if (pred.kind === "attr") {
        if (value === null) return false;
        if (pred.value !== undefined && value !== pred.value) return false;
      } else if (pred.kind === "contains") {
        if (value === null || !String(value).includes(pred.value)) return false;
      } else if (pred.kind === "startsWith") {
        if (value === null || !String(value).startsWith(pred.value)) return false;
      }
    }
    return true;
  });
}

function _makeXPathResult(type, nodes) {
  nodes = Array.from(nodes || []);
  const requested = type || XPathResult.ANY_TYPE;
  const resultType = requested === XPathResult.ANY_TYPE
    ? XPathResult.UNORDERED_NODE_ITERATOR_TYPE
    : requested;
  let iter = 0;
  return {
    resultType,
    singleNodeValue: nodes[0] || null,
    snapshotLength: nodes.length,
    snapshotItem(i) { return nodes[i] || null; },
    iterateNext() { return nodes[iter++] || null; },
    invalidIteratorState: false,
    numberValue: nodes.length,
    stringValue: nodes[0]?.textContent || "",
    booleanValue: nodes.length > 0,
  };
}


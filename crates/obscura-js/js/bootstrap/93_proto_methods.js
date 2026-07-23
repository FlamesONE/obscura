// Missing prototype METHODS real Chrome exposes on Navigator / Document /
// Element. Cloudflare's challenge VM binds many of these off the prototypes;
// a missing one resolves to undefined and later crashes the VM ("X is not a
// function"). Native-masked, guarded, sensible no-op/spec-shaped returns.
(function () {
  const _add = (proto, name, impl) => {
    try {
      if (!proto || typeof proto[name] === 'function' || Object.prototype.hasOwnProperty.call(proto, name)) return;
      try { Object.defineProperty(impl, 'name', { value: name, configurable: true }); } catch (e) {}
      try { if (typeof _markNativeAs === 'function') _markNativeAs(impl, 'function ' + name + '() { [native code] }'); } catch (e) {}
      Object.defineProperty(proto, name, { value: impl, writable: true, configurable: true, enumerable: true });
    } catch (e) {}
  };
  const _rejNA = () => Promise.reject(new (globalThis.DOMException || Error)('Not allowed', 'NotAllowedError'));
  const NavP = globalThis.Navigator && globalThis.Navigator.prototype;
  const DocP = globalThis.Document && globalThis.Document.prototype;
  const ElP = globalThis.Element && globalThis.Element.prototype;

  if (NavP) {
    _add(NavP, 'vibrate', function vibrate() { return true; });
    _add(NavP, 'getUserMedia', function getUserMedia(c, ok, err) { if (typeof err === 'function') err(new (globalThis.DOMException || Error)('Not allowed', 'NotAllowedError')); });
    _add(NavP, 'webkitGetUserMedia', NavP.getUserMedia);
    _add(NavP, 'requestMIDIAccess', function requestMIDIAccess() { return _rejNA(); });
    _add(NavP, 'requestMediaKeySystemAccess', function requestMediaKeySystemAccess() { return _rejNA(); });
    _add(NavP, 'registerProtocolHandler', function registerProtocolHandler() {});
    _add(NavP, 'unregisterProtocolHandler', function unregisterProtocolHandler() {});
    _add(NavP, 'getInstalledRelatedApps', function getInstalledRelatedApps() { return Promise.resolve([]); });
    _add(NavP, 'setAppBadge', function setAppBadge() { return Promise.resolve(); });
    _add(NavP, 'clearAppBadge', function clearAppBadge() { return Promise.resolve(); });
    for (const n of ['adAuctionComponents','canLoadAdAuctionFencedFrame','clearOriginJoinedAdInterestGroups','createAuctionNonce','deprecatedReplaceInURN','deprecatedURNToURL','getInterestGroupAdAuctionData','joinAdInterestGroup','leaveAdInterestGroup','runAdAuction','updateAdInterestGroups']) {
      _add(NavP, n, function () { return undefined; });
    }
  }
  if (DocP) {
    _add(DocP, 'exitFullscreen', function exitFullscreen() { return Promise.resolve(); });
    _add(DocP, 'webkitExitFullscreen', function webkitExitFullscreen() {});
    _add(DocP, 'webkitCancelFullScreen', function webkitCancelFullScreen() {});
    _add(DocP, 'exitPictureInPicture', function exitPictureInPicture() { return Promise.resolve(); });
    _add(DocP, 'exitPointerLock', function exitPointerLock() {});
    _add(DocP, 'getAnimations', function getAnimations() { return []; });
    _add(DocP, 'hasStorageAccess', function hasStorageAccess() { return Promise.resolve(false); });
    _add(DocP, 'requestStorageAccess', function requestStorageAccess() { return _rejNA(); });
    _add(DocP, 'requestStorageAccessFor', function requestStorageAccessFor() { return _rejNA(); });
    _add(DocP, 'hasUnpartitionedCookieAccess', function hasUnpartitionedCookieAccess() { return Promise.resolve(false); });
    _add(DocP, 'hasPrivateToken', function hasPrivateToken() { return Promise.resolve(false); });
    _add(DocP, 'hasRedemptionRecord', function hasRedemptionRecord() { return Promise.resolve(false); });
    _add(DocP, 'caretPositionFromPoint', function caretPositionFromPoint() { return null; });
    _add(DocP, 'caretRangeFromPoint', function caretRangeFromPoint() { return null; });
    _add(DocP, 'startViewTransition', function startViewTransition(cb) { try { if (typeof cb === 'function') cb(); } catch (e) {} return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition() {} }; });
    _add(DocP, 'createExpression', function createExpression() { return { evaluate() { return null; } }; });
    _add(DocP, 'createNSResolver', function createNSResolver(n) { return n; });
    _add(DocP, 'captureEvents', function captureEvents() {});
    _add(DocP, 'releaseEvents', function releaseEvents() {});
    _add(DocP, 'queryCommandEnabled', function queryCommandEnabled() { return false; });
    _add(DocP, 'queryCommandIndeterm', function queryCommandIndeterm() { return false; });
    _add(DocP, 'queryCommandState', function queryCommandState() { return false; });
    _add(DocP, 'queryCommandSupported', function queryCommandSupported() { return false; });
    _add(DocP, 'queryCommandValue', function queryCommandValue() { return ''; });
    _add(DocP, 'browsingTopics', function browsingTopics() { return Promise.resolve([]); });
    _add(DocP, 'ariaNotify', function ariaNotify() {});
  }
  if (ElP) {
    _add(ElP, 'requestFullscreen', function requestFullscreen() { return Promise.resolve(); });
    _add(ElP, 'webkitRequestFullscreen', function webkitRequestFullscreen() {});
    _add(ElP, 'webkitRequestFullScreen', function webkitRequestFullScreen() {});
    _add(ElP, 'requestPointerLock', function requestPointerLock() { return undefined; });
    _add(ElP, 'setPointerCapture', function setPointerCapture() {});
    _add(ElP, 'releasePointerCapture', function releasePointerCapture() {});
    _add(ElP, 'hasPointerCapture', function hasPointerCapture() { return false; });
    _add(ElP, 'scrollIntoViewIfNeeded', function scrollIntoViewIfNeeded() {});
    _add(ElP, 'computedStyleMap', function computedStyleMap() { return { get() { return undefined; }, has() { return false; }, size: 0, forEach() {}, keys() { return [][Symbol.iterator](); } }; });
    _add(ElP, 'webkitMatchesSelector', function webkitMatchesSelector(s) { try { return this.matches(s); } catch (e) { return false; } });
    _add(ElP, 'requestPointerLock', function requestPointerLock() {});
    _add(ElP, 'ariaNotify', function ariaNotify() {});
    _add(ElP, 'setHTML', function setHTML(s) { try { this.innerHTML = String(s); } catch (e) {} });
    _add(ElP, 'hasAttributeNS', function hasAttributeNS(ns, n) { try { return this.hasAttribute(n); } catch (e) { return false; } });
  }
})();

// Missing navigator instance PROPERTIES (objects, not functions — earlier method
// diffs missed them) that real Chrome exposes and CF probes: userActivation,
// bluetooth/usb/hid/serial, presentation, xr, ink, windowControlsOverlay,
// scheduling. Added to the navigator instance, guarded.
(function () {
  try {
    const N = globalThis.navigator;
    if (!N) return;
    const _p = (k, v) => { try { if (typeof N[k] === 'undefined') Object.defineProperty(N, k, { value: v, writable: false, configurable: true, enumerable: true }); } catch (e) {} };
    const _rejNA = () => Promise.reject(new (globalThis.DOMException || Error)('Not allowed', 'NotAllowedError'));
    _p('userActivation', { get hasBeenActive() { return true; }, get isActive() { return false; } });
    _p('bluetooth', { getAvailability() { return Promise.resolve(false); }, getDevices() { return Promise.resolve([]); }, requestDevice() { return _rejNA(); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('usb', { getDevices() { return Promise.resolve([]); }, requestDevice() { return _rejNA(); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('hid', { getDevices() { return Promise.resolve([]); }, requestDevice() { return _rejNA(); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('serial', { getPorts() { return Promise.resolve([]); }, requestPort() { return _rejNA(); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('presentation', { get defaultRequest() { return null; }, set defaultRequest(v) {}, get receiver() { return null; } });
    _p('xr', { isSessionSupported() { return Promise.resolve(false); }, requestSession() { return _rejNA(); }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('ink', { requestPresenter() { return Promise.resolve(null); } });
    _p('windowControlsOverlay', { get visible() { return false; }, getTitlebarAreaRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    _p('scheduling', { isInputPending() { return false; } });
  } catch (e) {}
})();

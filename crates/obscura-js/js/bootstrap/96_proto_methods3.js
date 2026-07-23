// Auto-generated (batch 3): fill remaining missing methods on interface
// prototypes obscura has but under-populated (SVGSVGElement, RTCPeerConnection,
// DOMMatrix, HTMLTableElement, FormData, Request/Response, etc.), diffed vs real
// Chrome. Guarded + native-masked. Cloudflare's VM binds these off prototypes.
(function(){
  const _m=(proto,name,body)=>{try{if(!proto||typeof proto[name]==='function'||Object.prototype.hasOwnProperty.call(proto,name))return;try{Object.defineProperty(body,'name',{value:name,configurable:true});}catch(e){}try{if(typeof _markNativeAs==='function')_markNativeAs(body,'function '+name+'() { [native code] }');}catch(e){}Object.defineProperty(proto,name,{value:body,writable:true,configurable:true,enumerable:true});}catch(e){}};
  try { const P=globalThis.Map&&globalThis.Map.prototype; if(P){
    _m(P,'getOrInsert',function getOrInsert(){return null;});
    _m(P,'getOrInsertComputed',function getOrInsertComputed(){return null;});
  } } catch(e){}
  try { const P=globalThis.WeakMap&&globalThis.WeakMap.prototype; if(P){
    _m(P,'getOrInsert',function getOrInsert(){return null;});
    _m(P,'getOrInsertComputed',function getOrInsertComputed(){return null;});
  } } catch(e){}
  try { const P=globalThis.Image&&globalThis.Image.prototype; if(P){
    _m(P,'decode',function decode(){return Promise.resolve();});
  } } catch(e){}
  try { const P=globalThis.XMLHttpRequest&&globalThis.XMLHttpRequest.prototype; if(P){
    _m(P,'setAttributionReporting',function setAttributionReporting(){return undefined;});
    _m(P,'setPrivateToken',function setPrivateToken(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.ShadowRoot&&globalThis.ShadowRoot.prototype; if(P){
    _m(P,'getAnimations',function getAnimations(){return [];});
    _m(P,'getHTML',function getHTML(){return null;});
    _m(P,'getSelection',function getSelection(){return null;});
    _m(P,'setHTMLUnsafe',function setHTMLUnsafe(){return undefined;});
    _m(P,'setHTML',function setHTML(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.Selection&&globalThis.Selection.prototype; if(P){
    _m(P,'getComposedRanges',function getComposedRanges(){return [];});
  } } catch(e){}
  try { const P=globalThis.SVGSVGElement&&globalThis.SVGSVGElement.prototype; if(P){
    _m(P,'animationsPaused',function animationsPaused(){return undefined;});
    _m(P,'checkEnclosure',function checkEnclosure(){return false;});
    _m(P,'checkIntersection',function checkIntersection(){return false;});
    _m(P,'createSVGAngle',function createSVGAngle(){return ({});});
    _m(P,'createSVGLength',function createSVGLength(){return ({});});
    _m(P,'createSVGMatrix',function createSVGMatrix(){return ({});});
    _m(P,'createSVGNumber',function createSVGNumber(){return ({});});
    _m(P,'createSVGPoint',function createSVGPoint(){return ({});});
    _m(P,'createSVGRect',function createSVGRect(){return ({});});
    _m(P,'createSVGTransform',function createSVGTransform(){return ({});});
    _m(P,'createSVGTransformFromMatrix',function createSVGTransformFromMatrix(){return ({});});
    _m(P,'deselectAll',function deselectAll(){return undefined;});
    _m(P,'forceRedraw',function forceRedraw(){return undefined;});
    _m(P,'getCurrentTime',function getCurrentTime(){return null;});
    _m(P,'getElementById',function getElementById(){return null;});
    _m(P,'getEnclosureList',function getEnclosureList(){return [];});
    _m(P,'getIntersectionList',function getIntersectionList(){return [];});
    _m(P,'pauseAnimations',function pauseAnimations(){return undefined;});
    _m(P,'setCurrentTime',function setCurrentTime(){return undefined;});
    _m(P,'suspendRedraw',function suspendRedraw(){return undefined;});
    _m(P,'unpauseAnimations',function unpauseAnimations(){return undefined;});
    _m(P,'unsuspendRedraw',function unsuspendRedraw(){return undefined;});
    _m(P,'unsuspendRedrawAll',function unsuspendRedrawAll(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.Response&&globalThis.Response.prototype; if(P){
    _m(P,'formData',function formData(){return Promise.resolve();});
    _m(P,'bytes',function bytes(){return Promise.resolve();});
  } } catch(e){}
  try { const P=globalThis.Request&&globalThis.Request.prototype; if(P){
    _m(P,'formData',function formData(){return Promise.resolve();});
    _m(P,'bytes',function bytes(){return Promise.resolve();});
  } } catch(e){}
  try { const P=globalThis.ReadableStream&&globalThis.ReadableStream.prototype; if(P){
    _m(P,'values',function values(){return [][Symbol.iterator]();});
  } } catch(e){}
  try { const P=globalThis.RTCPeerConnection&&globalThis.RTCPeerConnection.prototype; if(P){
    _m(P,'addStream',function addStream(){return undefined;});
    _m(P,'addTrack',function addTrack(){return undefined;});
    _m(P,'addTransceiver',function addTransceiver(){return undefined;});
    _m(P,'createDTMFSender',function createDTMFSender(){return ({});});
    _m(P,'getConfiguration',function getConfiguration(){return null;});
    _m(P,'getLocalStreams',function getLocalStreams(){return [];});
    _m(P,'getReceivers',function getReceivers(){return [];});
    _m(P,'getRemoteStreams',function getRemoteStreams(){return [];});
    _m(P,'getSenders',function getSenders(){return [];});
    _m(P,'getTransceivers',function getTransceivers(){return [];});
    _m(P,'removeStream',function removeStream(){return undefined;});
    _m(P,'removeTrack',function removeTrack(){return undefined;});
    _m(P,'restartIce',function restartIce(){return undefined;});
    _m(P,'setConfiguration',function setConfiguration(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.ProcessingInstruction&&globalThis.ProcessingInstruction.prototype; if(P){
    _m(P,'getAttribute',function getAttribute(){return null;});
    _m(P,'getAttributeNames',function getAttributeNames(){return [];});
    _m(P,'hasAttribute',function hasAttribute(){return false;});
    _m(P,'hasAttributes',function hasAttributes(){return false;});
    _m(P,'removeAttribute',function removeAttribute(){return undefined;});
    _m(P,'setAttribute',function setAttribute(){return undefined;});
    _m(P,'toggleAttribute',function toggleAttribute(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.PerformanceObserver&&globalThis.PerformanceObserver.prototype; if(P){
    _m(P,'takeRecords',function takeRecords(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.Path2D&&globalThis.Path2D.prototype; if(P){
    _m(P,'roundRect',function roundRect(){return undefined;});
    _m(P,'arcTo',function arcTo(){return undefined;});
    _m(P,'bezierCurveTo',function bezierCurveTo(){return undefined;});
    _m(P,'ellipse',function ellipse(){return undefined;});
    _m(P,'quadraticCurveTo',function quadraticCurveTo(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.OfflineAudioContext&&globalThis.OfflineAudioContext.prototype; if(P){
    _m(P,'resume',function resume(){return Promise.resolve();});
    _m(P,'suspend',function suspend(){return Promise.resolve();});
  } } catch(e){}
  try { const P=globalThis.MouseEvent&&globalThis.MouseEvent.prototype; if(P){
    _m(P,'getModifierState',function getModifierState(){return null;});
  } } catch(e){}
  try { const P=globalThis.MediaStreamTrack&&globalThis.MediaStreamTrack.prototype; if(P){
    _m(P,'applyConstraints',function applyConstraints(){return Promise.resolve();});
    _m(P,'getCapabilities',function getCapabilities(){return [];});
    _m(P,'getConstraints',function getConstraints(){return [];});
    _m(P,'getSettings',function getSettings(){return [];});
    _m(P,'getCaptureHandle',function getCaptureHandle(){return null;});
  } } catch(e){}
  try { const P=globalThis.MediaStream&&globalThis.MediaStream.prototype; if(P){
    _m(P,'getTrackById',function getTrackById(){return null;});
  } } catch(e){}
  try { const P=globalThis.KeyboardEvent&&globalThis.KeyboardEvent.prototype; if(P){
    _m(P,'getModifierState',function getModifierState(){return null;});
  } } catch(e){}
  try { const P=globalThis.Headers&&globalThis.Headers.prototype; if(P){
    _m(P,'getSetCookie',function getSetCookie(){return null;});
  } } catch(e){}
  try { const P=globalThis.HTMLTableElement&&globalThis.HTMLTableElement.prototype; if(P){
    _m(P,'createCaption',function createCaption(){return ({});});
    _m(P,'createTBody',function createTBody(){return ({});});
    _m(P,'createTFoot',function createTFoot(){return ({});});
    _m(P,'createTHead',function createTHead(){return ({});});
    _m(P,'deleteCaption',function deleteCaption(){return undefined;});
    _m(P,'deleteRow',function deleteRow(){return undefined;});
    _m(P,'deleteTFoot',function deleteTFoot(){return undefined;});
    _m(P,'deleteTHead',function deleteTHead(){return undefined;});
    _m(P,'insertRow',function insertRow(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.HTMLSlotElement&&globalThis.HTMLSlotElement.prototype; if(P){
    _m(P,'assign',function assign(){return undefined;});
    _m(P,'assignedElements',function assignedElements(){return undefined;});
    _m(P,'assignedNodes',function assignedNodes(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.HTMLSelectElement&&globalThis.HTMLSelectElement.prototype; if(P){
    _m(P,'add',function add(){return undefined;});
    _m(P,'item',function item(){return null;});
    _m(P,'namedItem',function namedItem(){return null;});
  } } catch(e){}
  try { const P=globalThis.HTMLMediaElement&&globalThis.HTMLMediaElement.prototype; if(P){
    _m(P,'addTextTrack',function addTextTrack(){return undefined;});
    _m(P,'captureStream',function captureStream(){return undefined;});
    _m(P,'setSinkId',function setSinkId(){return undefined;});
    _m(P,'setMediaKeys',function setMediaKeys(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.HTMLImageElement&&globalThis.HTMLImageElement.prototype; if(P){
    _m(P,'decode',function decode(){return Promise.resolve();});
  } } catch(e){}
  try { const P=globalThis.HTMLIFrameElement&&globalThis.HTMLIFrameElement.prototype; if(P){
    _m(P,'getSVGDocument',function getSVGDocument(){return null;});
  } } catch(e){}
  try { const P=globalThis.HTMLFormElement&&globalThis.HTMLFormElement.prototype; if(P){
    _m(P,'checkValidity',function checkValidity(){return true;});
    _m(P,'reportValidity',function reportValidity(){return undefined;});
    _m(P,'requestSubmit',function requestSubmit(){return undefined;});
    _m(P,'submit',function submit(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.HTMLAnchorElement&&globalThis.HTMLAnchorElement.prototype; if(P){
    _m(P,'toString',function toString(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.FormData&&globalThis.FormData.prototype; if(P){
    _m(P,'delete',function delete(){return undefined;});
    _m(P,'set',function set(){return undefined;});
    _m(P,'keys',function keys(){return [][Symbol.iterator]();});
    _m(P,'values',function values(){return [][Symbol.iterator]();});
  } } catch(e){}
  try { const P=globalThis.DocumentFragment&&globalThis.DocumentFragment.prototype; if(P){
    _m(P,'moveBefore',function moveBefore(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.DOMMatrix&&globalThis.DOMMatrix.prototype; if(P){
    _m(P,'invertSelf',function invertSelf(){return undefined;});
    _m(P,'multiplySelf',function multiplySelf(){return undefined;});
    _m(P,'preMultiplySelf',function preMultiplySelf(){return undefined;});
    _m(P,'rotateAxisAngleSelf',function rotateAxisAngleSelf(){return undefined;});
    _m(P,'rotateFromVectorSelf',function rotateFromVectorSelf(){return undefined;});
    _m(P,'rotateSelf',function rotateSelf(){return undefined;});
    _m(P,'scale3dSelf',function scale3dSelf(){return undefined;});
    _m(P,'scaleSelf',function scaleSelf(){return undefined;});
    _m(P,'skewXSelf',function skewXSelf(){return undefined;});
    _m(P,'skewYSelf',function skewYSelf(){return undefined;});
    _m(P,'translateSelf',function translateSelf(){return undefined;});
    _m(P,'setMatrixValue',function setMatrixValue(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.CustomElementRegistry&&globalThis.CustomElementRegistry.prototype; if(P){
    _m(P,'initialize',function initialize(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.Blob&&globalThis.Blob.prototype; if(P){
    _m(P,'stream',function stream(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.AudioContext&&globalThis.AudioContext.prototype; if(P){
    _m(P,'createMediaElementSource',function createMediaElementSource(){return ({});});
    _m(P,'createMediaStreamDestination',function createMediaStreamDestination(){return ({});});
    _m(P,'createMediaStreamSource',function createMediaStreamSource(){return ({});});
    _m(P,'getOutputTimestamp',function getOutputTimestamp(){return Promise.resolve();});
    _m(P,'setSinkId',function setSinkId(){return undefined;});
  } } catch(e){}
  try { const P=globalThis.ServiceWorkerContainer&&globalThis.ServiceWorkerContainer.prototype; if(P){
    _m(P,'getRegistration',function getRegistration(){return Promise.resolve();});
    _m(P,'startMessages',function startMessages(){return undefined;});
  } } catch(e){}
})();

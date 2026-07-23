// Auto-generated: fill missing methods on interface PROTOTYPES that obscura's
// stub constructors (92_window_globals) left empty but real Chrome populates
// (History/Performance/CanvasRenderingContext2D/Screen/etc.). Cloudflare's VM
// binds methods off these prototypes; a missing one crashes it. Native-masked,
// guarded, spec-shaped returns where cheap. Diffed vs real Chrome.
(function(){
  const _m=(protoName,proto,name,body)=>{try{if(!proto||typeof proto[name]==='function'||Object.prototype.hasOwnProperty.call(proto,name))return;const f=body;try{Object.defineProperty(f,'name',{value:name,configurable:true});}catch(e){}try{if(typeof _markNativeAs==='function')_markNativeAs(f,'function '+name+'() { [native code] }');}catch(e){}Object.defineProperty(proto,name,{value:f,writable:true,configurable:true,enumerable:true});}catch(e){}};
  try { const P=Node.prototype; if(P){
    _m('Node',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=EventTarget.prototype; if(P){
    _m('EventTarget',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=Element.prototype; if(P){
    _m('Element',P,'moveBefore',function moveBefore(){return undefined;});
    _m('Element',P,'pseudo',function pseudo(){return undefined;});
    _m('Element',P,'startViewTransition',function startViewTransition(){return undefined;});
    _m('Element',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=HTMLElement.prototype; if(P){
    _m('HTMLElement',P,'moveBefore',function moveBefore(){return undefined;});
    _m('HTMLElement',P,'pseudo',function pseudo(){return undefined;});
    _m('HTMLElement',P,'startViewTransition',function startViewTransition(){return undefined;});
    _m('HTMLElement',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=Document.prototype; if(P){
    _m('Document',P,'clear',function clear(){return undefined;});
    _m('Document',P,'moveBefore',function moveBefore(){return undefined;});
    _m('Document',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=CharacterData.prototype; if(P){
    _m('CharacterData',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=Screen.prototype; if(P){
    _m('Screen',P,'addEventListener',function addEventListener(){return undefined;});
    _m('Screen',P,'dispatchEvent',function dispatchEvent(){return true;});
    _m('Screen',P,'removeEventListener',function removeEventListener(){return undefined;});
    _m('Screen',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=History.prototype; if(P){
    _m('History',P,'back',function back(){return undefined;});
    _m('History',P,'forward',function forward(){return undefined;});
    _m('History',P,'go',function go(){return undefined;});
    _m('History',P,'pushState',function pushState(){return undefined;});
    _m('History',P,'replaceState',function replaceState(){return undefined;});
  } } catch(e){}
  try { const P=Performance.prototype; if(P){
    _m('Performance',P,'addEventListener',function addEventListener(){return undefined;});
    _m('Performance',P,'clearMarks',function clearMarks(){return undefined;});
    _m('Performance',P,'clearMeasures',function clearMeasures(){return undefined;});
    _m('Performance',P,'clearResourceTimings',function clearResourceTimings(){return undefined;});
    _m('Performance',P,'dispatchEvent',function dispatchEvent(){return true;});
    _m('Performance',P,'getEntries',function getEntries(){return [];});
    _m('Performance',P,'getEntriesByName',function getEntriesByName(){return [];});
    _m('Performance',P,'getEntriesByType',function getEntriesByType(){return [];});
    _m('Performance',P,'mark',function mark(){return undefined;});
    _m('Performance',P,'measure',function measure(){return undefined;});
    _m('Performance',P,'now',function now(){return 0;});
    _m('Performance',P,'removeEventListener',function removeEventListener(){return undefined;});
    _m('Performance',P,'setResourceTimingBufferSize',function setResourceTimingBufferSize(){return undefined;});
    _m('Performance',P,'toJSON',function toJSON(){return {};});
    _m('Performance',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=HTMLCanvasElement.prototype; if(P){
    _m('HTMLCanvasElement',P,'captureStream',function captureStream(){return undefined;});
    _m('HTMLCanvasElement',P,'moveBefore',function moveBefore(){return undefined;});
    _m('HTMLCanvasElement',P,'pseudo',function pseudo(){return undefined;});
    _m('HTMLCanvasElement',P,'startViewTransition',function startViewTransition(){return undefined;});
    _m('HTMLCanvasElement',P,'transferControlToOffscreen',function transferControlToOffscreen(){return undefined;});
    _m('HTMLCanvasElement',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=CanvasRenderingContext2D.prototype; if(P){
    _m('CanvasRenderingContext2D',P,'arc',function arc(){return undefined;});
    _m('CanvasRenderingContext2D',P,'arcTo',function arcTo(){return undefined;});
    _m('CanvasRenderingContext2D',P,'beginPath',function beginPath(){return undefined;});
    _m('CanvasRenderingContext2D',P,'bezierCurveTo',function bezierCurveTo(){return undefined;});
    _m('CanvasRenderingContext2D',P,'clearRect',function clearRect(){return undefined;});
    _m('CanvasRenderingContext2D',P,'clip',function clip(){return undefined;});
    _m('CanvasRenderingContext2D',P,'closePath',function closePath(){return undefined;});
    _m('CanvasRenderingContext2D',P,'createConicGradient',function createConicGradient(){return ({addColorStop(){}});});
    _m('CanvasRenderingContext2D',P,'createImageData',function createImageData(){return ({data:new Uint8ClampedArray(4),width:1,height:1});});
    _m('CanvasRenderingContext2D',P,'createLinearGradient',function createLinearGradient(){return ({addColorStop(){}});});
    _m('CanvasRenderingContext2D',P,'createPattern',function createPattern(){return null;});
    _m('CanvasRenderingContext2D',P,'createRadialGradient',function createRadialGradient(){return ({addColorStop(){}});});
    _m('CanvasRenderingContext2D',P,'drawFocusIfNeeded',function drawFocusIfNeeded(){return undefined;});
    _m('CanvasRenderingContext2D',P,'drawImage',function drawImage(){return undefined;});
    _m('CanvasRenderingContext2D',P,'ellipse',function ellipse(){return undefined;});
    _m('CanvasRenderingContext2D',P,'fill',function fill(){return undefined;});
    _m('CanvasRenderingContext2D',P,'fillRect',function fillRect(){return undefined;});
    _m('CanvasRenderingContext2D',P,'fillText',function fillText(){return undefined;});
    _m('CanvasRenderingContext2D',P,'getContextAttributes',function getContextAttributes(){return ({});});
    _m('CanvasRenderingContext2D',P,'getImageData',function getImageData(){return ({data:new Uint8ClampedArray(4),width:1,height:1,colorSpace:"srgb"});});
    _m('CanvasRenderingContext2D',P,'getLineDash',function getLineDash(){return [];});
    _m('CanvasRenderingContext2D',P,'getTransform',function getTransform(){return ({a:1,b:0,c:0,d:1,e:0,f:0});});
    _m('CanvasRenderingContext2D',P,'isContextLost',function isContextLost(){return false;});
    _m('CanvasRenderingContext2D',P,'isPointInPath',function isPointInPath(){return false;});
    _m('CanvasRenderingContext2D',P,'isPointInStroke',function isPointInStroke(){return false;});
    _m('CanvasRenderingContext2D',P,'lineTo',function lineTo(){return undefined;});
    _m('CanvasRenderingContext2D',P,'measureText',function measureText(){return ({width:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:0,actualBoundingBoxAscent:0,actualBoundingBoxDescent:0,fontBoundingBoxAscent:0,fontBoundingBoxDescent:0});});
    _m('CanvasRenderingContext2D',P,'moveTo',function moveTo(){return undefined;});
    _m('CanvasRenderingContext2D',P,'putImageData',function putImageData(){return undefined;});
    _m('CanvasRenderingContext2D',P,'quadraticCurveTo',function quadraticCurveTo(){return undefined;});
    _m('CanvasRenderingContext2D',P,'rect',function rect(){return undefined;});
    _m('CanvasRenderingContext2D',P,'reset',function reset(){return undefined;});
    _m('CanvasRenderingContext2D',P,'resetTransform',function resetTransform(){return undefined;});
    _m('CanvasRenderingContext2D',P,'restore',function restore(){return undefined;});
    _m('CanvasRenderingContext2D',P,'rotate',function rotate(){return undefined;});
    _m('CanvasRenderingContext2D',P,'roundRect',function roundRect(){return undefined;});
    _m('CanvasRenderingContext2D',P,'save',function save(){return undefined;});
    _m('CanvasRenderingContext2D',P,'scale',function scale(){return undefined;});
    _m('CanvasRenderingContext2D',P,'setLineDash',function setLineDash(){return undefined;});
    _m('CanvasRenderingContext2D',P,'setTransform',function setTransform(){return undefined;});
    _m('CanvasRenderingContext2D',P,'stroke',function stroke(){return undefined;});
    _m('CanvasRenderingContext2D',P,'strokeRect',function strokeRect(){return undefined;});
    _m('CanvasRenderingContext2D',P,'strokeText',function strokeText(){return undefined;});
    _m('CanvasRenderingContext2D',P,'transform',function transform(){return undefined;});
    _m('CanvasRenderingContext2D',P,'translate',function translate(){return undefined;});
  } } catch(e){}
  try { const P=HTMLInputElement.prototype; if(P){
    _m('HTMLInputElement',P,'moveBefore',function moveBefore(){return undefined;});
    _m('HTMLInputElement',P,'pseudo',function pseudo(){return undefined;});
    _m('HTMLInputElement',P,'showPicker',function showPicker(){return undefined;});
    _m('HTMLInputElement',P,'startViewTransition',function startViewTransition(){return undefined;});
    _m('HTMLInputElement',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=HTMLFormElement.prototype; if(P){
    _m('HTMLFormElement',P,'moveBefore',function moveBefore(){return undefined;});
    _m('HTMLFormElement',P,'pseudo',function pseudo(){return undefined;});
    _m('HTMLFormElement',P,'startViewTransition',function startViewTransition(){return undefined;});
    _m('HTMLFormElement',P,'when',function when(){return undefined;});
  } } catch(e){}
  try { const P=Range.prototype; if(P){
    _m('Range',P,'expand',function expand(){return undefined;});
  } } catch(e){}
})();

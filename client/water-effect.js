import * as THREE from 'three';
import WATER_GEOMETRY from './water-hazard-contours.js';

// Bright cyan shore -> deep-blue center, using distance from the actual water contour.
const WATER_CENTER_COLOR = new THREE.Color(0x06245f);
const WATER_EDGE_COLOR = new THREE.Color(0x38d8ff);
const WATER_GRADIENT_DEPTH = 0.39; // Approx. full interior depth of both water outlines.
const WATER_FAST_ZONE = 0.30; // First 30% of the inward distance.
const WATER_FAST_COLOR_BLEND = 0.65; // Mix 65% of the color change in that first 30%.
const DEBUG_WATER_BOUNDARY = false; // enable only for water collision diagnostics
const DEBUG_WATER_BOUNDARY_WIDTH_PX = 4;

const game = document.querySelector('#game');
const WATER_GIF_MIN_WIDTH = 40;
const WATER_GIF_MAX_WIDTH = 80;
const WATER_GIF_PULSE_MS = 500;
const WATER_GIF_MOVEMENT_THRESHOLD = 1;

const effect = document.createElement('img');
effect.id = 'water-step-effect';
effect.src = './assets/textures/water02.gif';
effect.alt = '';
effect.setAttribute('aria-hidden', 'true');
effect.draggable = false;
effect.style.cssText = [
  'position:absolute','left:50%','top:50%',`width:${WATER_GIF_MIN_WIDTH}px`,'height:auto','max-width:none','max-height:none',
  'transform:translate(-50%,-50%) scale(var(--echo-world-scale, 1))','display:block','pointer-events:none','z-index:2.5','opacity:0',
  `transition:width ${WATER_GIF_PULSE_MS}ms ease-in-out`
].join(';');
game?.appendChild(effect);

let pulseTimer = null;
let isMoving = false;
let isOnWater = false;
let pulseRunning = false;
function ensureOpacityAnimation(){if(!effect.animate)return null;return effect.animate([{opacity:0,offset:0},{opacity:.7,offset:.2},{opacity:.7,offset:.4},{opacity:.5,offset:.6},{opacity:.3,offset:.8},{opacity:.1,offset:1}],{duration:WATER_GIF_PULSE_MS,easing:'ease-in-out',fill:'forwards'});}
let opacityAnimation=null;
function stopPulse(){clearTimeout(pulseTimer);pulseTimer=null;pulseRunning=false;opacityAnimation?.cancel();opacityAnimation=null;effect.style.transition='none';effect.style.width=`${WATER_GIF_MIN_WIDTH}px`;effect.style.opacity='0';}
function pulse(){if(!isMoving||!isOnWater||pulseRunning)return;pulseRunning=true;opacityAnimation?.cancel();opacityAnimation=ensureOpacityAnimation();effect.style.transition=`width ${WATER_GIF_PULSE_MS}ms ease-in-out`;effect.style.width=`${WATER_GIF_MAX_WIDTH}px`;pulseTimer=setTimeout(()=>{pulseTimer=null;opacityAnimation?.cancel();opacityAnimation=null;effect.style.transition='none';effect.style.width=`${WATER_GIF_MIN_WIDTH}px`;effect.style.opacity='0';pulseRunning=false;if(isMoving&&isOnWater){void effect.offsetWidth;pulse();}},WATER_GIF_PULSE_MS);}
function updateEffectState(){if(isMoving&&isOnWater)pulse();else stopPulse();}
window.addEventListener('echo:water-state',e=>{isOnWater=Boolean(e.detail?.inWater??e.detail?.isInWater??e.detail?.water);updateEffectState();});
window.addEventListener('echo:player-movement',e=>{const vx=Number(e.detail?.vx)||0,vy=Number(e.detail?.vy)||0,movingNow=Math.hypot(vx,vy)>WATER_GIF_MOVEMENT_THRESHOLD;if(movingNow===isMoving)return;isMoving=movingNow;updateEffectState();});

const contourMaterials=new WeakSet();
const debugWaterRoots=new WeakSet();

function getContour(modelName){const raw=WATER_GEOMETRY[modelName];return Array.isArray(raw)?raw:raw?.vertices;}

function addDebugWaterBoundary(root,modelName){
  if(!DEBUG_WATER_BOUNDARY||!root||debugWaterRoots.has(root))return;
  const contour=getContour(modelName);
  if(!Array.isArray(contour)||contour.length<3){console.warn('[echo] missing server water contour for debug line:',modelName);return;}

  const ring=new THREE.Group();
  ring.name='echo-server-water-boundary-debug';
  ring.position.z=.12;
  ring.renderOrder=9999;
  ring.frustumCulled=false;

  // Water surface is the XY plane after the same X rotation used by the water model.
  // Build the debug strip directly in XY and do not rotate the debug group.
  const surface=root.children.find(child=>child?.isObject3D&&child!==ring);
  const waterScale=surface?.scale?.x||1;
  const widthLocal=DEBUG_WATER_BOUNDARY_WIDTH_PX/waterScale;
  const material=new THREE.MeshBasicMaterial({color:0xff0000,transparent:false,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});

  for(let i=0;i<contour.length;i+=1){
    const a=contour[i],b=contour[(i+1)%contour.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(!length)continue;
    const segment=new THREE.Mesh(new THREE.PlaneGeometry(length,widthLocal),material);
    segment.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,0);
    segment.rotation.z=Math.atan2(dy,dx);
    segment.renderOrder=9999;
    segment.frustumCulled=false;
    ring.add(segment);
  }
  root.add(ring);
  debugWaterRoots.add(root);
  console.log('[echo] SERVER WATER DEBUG BOUNDARY CREATED',modelName,'segments:',ring.children.length,'scale:',waterScale);
}

function handleWaterModel(root,modelName){if(!root||!modelName)return;addDebugWaterBoundary(root,modelName);root.traverse(child=>{if(!child.isMesh||!child.material)return;const materials=Array.isArray(child.material)?child.material:[child.material];for(const material of materials)if(child.parent?.name!=='echo-server-water-boundary-debug')applyContourShader(material,modelName);});}

function applyContourShader(material,modelName){if(!material||contourMaterials.has(material))return;const contour=getContour(modelName);if(!Array.isArray(contour)||contour.length<3)return;const segments=contour.map((point,index)=>({a:point,b:contour[(index+1)%contour.length]}));const allContours=Object.keys(WATER_GEOMETRY).map(getContour).filter(Array.isArray);const maxSegments=Math.max(...allContours.map(points=>points.length));const aX=new Float32Array(maxSegments),aY=new Float32Array(maxSegments),bX=new Float32Array(maxSegments),bY=new Float32Array(maxSegments);for(let i=0;i<segments.length;i+=1){aX[i]=segments[i].a[0];aY[i]=segments[i].a[1];bX[i]=segments[i].b[0];bY[i]=segments[i].b[1];}material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vEchoWaterModelXZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nvEchoWaterModelXZ = position.xz;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vEchoWaterModelXZ;\nuniform float echoContourCount;\nuniform float echoContourAX[${maxSegments}];\nuniform float echoContourAY[${maxSegments}];\nuniform float echoContourBX[${maxSegments}];\nuniform float echoContourBY[${maxSegments}];`).replace('#include <color_fragment>',`#include <color_fragment>\nfloat echoMinDistance=10000.0;\nfor(int i=0;i<${maxSegments};i++){if(float(i)>=echoContourCount)break;vec2 a=vec2(echoContourAX[i],echoContourAY[i]);vec2 b=vec2(echoContourBX[i],echoContourBY[i]);vec2 ab=b-a;float denom=max(dot(ab,ab),0.000001);float t=clamp(dot(vEchoWaterModelXZ-a,ab)/denom,0.0,1.0);float d=length(vEchoWaterModelXZ-(a+t*ab));echoMinDistance=min(echoMinDistance,d);}\nfloat echoDistance01=clamp(echoMinDistance/${WATER_GRADIENT_DEPTH.toFixed(3)},0.0,1.0);\nfloat echoColorProgress=echoDistance01<${WATER_FAST_ZONE.toFixed(2)} ? ${WATER_FAST_COLOR_BLEND.toFixed(2)}*smoothstep(0.0,${WATER_FAST_ZONE.toFixed(2)},echoDistance01) : ${WATER_FAST_COLOR_BLEND.toFixed(2)}+(1.0-${WATER_FAST_COLOR_BLEND.toFixed(2)})*smoothstep(${WATER_FAST_ZONE.toFixed(2)},1.0,echoDistance01);\nvec3 echoWaterColor=mix(vec3(${WATER_EDGE_COLOR.r},${WATER_EDGE_COLOR.g},${WATER_EDGE_COLOR.b}),vec3(${WATER_CENTER_COLOR.r},${WATER_CENTER_COLOR.g},${WATER_CENTER_COLOR.b}),echoColorProgress);\ndiffuseColor.rgb=echoWaterColor;`);shader.uniforms.echoContourCount={value:segments.length};shader.uniforms.echoContourAX={value:Array.from(aX)};shader.uniforms.echoContourAY={value:Array.from(aY)};shader.uniforms.echoContourBX={value:Array.from(bX)};shader.uniforms.echoContourBY={value:Array.from(bY)};};material.customProgramCacheKey=()=>`echo-water-contour-${modelName}`;material.needsUpdate=true;contourMaterials.add(material);}

function watchWaterModels(){window.addEventListener('echo:water-model-created',e=>{const{root,model}=e.detail||{};handleWaterModel(root,model);});window.addEventListener('echo:water-models-ready',e=>{for(const water of e.detail?.waters||[])handleWaterModel(water?.root,water?.model);});}
watchWaterModels();

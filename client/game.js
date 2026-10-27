import * as THREE from 'three';
import { isMobilePerformanceDevice, renderPixelRatio, targetFrameInterval, shouldDrawScene } from './render-performance.js';
import { energySpeedMultiplier, energySizeMultiplier, energyJumpDistance } from './energy-balance.js';
import { playGameSound } from './audio-effects.js?v=echo-sfx-1';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacterLoaderSelector } from './character-textures.js?v=echo-isolated-character-atlas-1';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { bindPlayerControls, updatePlayerMovement } from './player-controls.js?v=echo-energy-mobility-1';
import { updateCharacterFacing } from './character-facing.js';
import { createMobileFloorReflections } from './mobile-floor-reflections.js?v=echo-skeleton-reflection-1';
import { getWorldViewport } from './viewport-scale.js?v=echo-world-zoom-2';
import { createWorldMinimap } from './world-minimap.js?v=echo-isometric-minimap-1';
import { createPlayerLabels, measurePlayerLabelBounds } from './player-labels.js?v=echo-labels-up-1';
import {attachSpawnShield,updateSpawnShield} from './spawn-shield.js?v=echo-shield-pulse-1';
import { createServerWaterBoundaryDebug } from './server-water-boundary-debug.js?v=echo-global-font-1';
import { createWorldDecorations } from './world-decorations.js?v=echo-glowing-mushrooms-10';

const activityProfileStorageKey = 'echo.activityProfileId';
let activityProfileId = localStorage.getItem(activityProfileStorageKey);
if (!activityProfileId || !/^[a-zA-Z0-9_-]{16,80}$/.test(activityProfileId)) {
  activityProfileId = (globalThis.crypto?.randomUUID?.() || ('echo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))).replace(/[^a-zA-Z0-9_-]/g, '_');
  localStorage.setItem(activityProfileStorageKey, activityProfileId);
}

// Keep guest names stable through reloads and client updates.
const guestNames = ['Tom','Bob','John','Terry','Carry','Berry','Max','Jack','Leo','Alex','Sam','Nick','Mike','Finn','Rick','Ben','Mia','Luna','Kate','Anna','Eva','Ruby','Lily','Nora','Oscar','Oliver','Harry','Molly','Grace','Daisy','Tony','Robin'];
let guestHash = 0;
for (const char of activityProfileId) guestHash = (Math.imul(guestHash, 31) + char.charCodeAt(0)) >>> 0;
const guestPlayerName = guestNames[guestHash % guestNames.length] + '_' +
  String((Math.floor(guestHash / guestNames.length) % 90000) + 10000);
let playerName = window.ECHOAuth?.getCurrent?.()?.nickname || guestPlayerName;
localStorage.setItem('echo.playerName', guestPlayerName);
const canvas=document.querySelector('#world'),modelCanvas=document.querySelector('#models'),ctx=canvas.getContext('2d',{alpha:true}),energyText=document.querySelector('#energy'),coordsText=document.querySelector('#coords'),connectionDot=document.querySelector('#connection-dot'),connectionLabel=document.querySelector('#connection-label'),gameExitButton=document.querySelector('#game-exit'),joystick=document.querySelector('#joystick'),stick=document.querySelector('#stick'),boostButton=document.querySelector('#boost'),jumpButton=document.querySelector('#jump'),defeatScreen=document.querySelector('#defeat-screen'),defeatReplay=document.querySelector('#defeat-replay'),defeatMenu=document.querySelector('#defeat-menu');
const state={x:0,y:0,vx:0,vy:0,energy:0,cameraX:0,cameraY:0,inputX:0,inputY:0,width:1,height:1,dpr:1,keys:new Set(),lastTime:0,boostUntil:0,boostCooldownUntil:0,jumpUntil:0,jumpStart:0,jumpFromX:0,jumpFromY:0,jumpToX:0,jumpToY:0,combatUntil:0,combatOpponentId:null,combatFightId:null,defeated:false,socket:null,others:new Map(),lastSent:0,lastSnapshotAt:0,hasServerSpawn:false,shieldUntil:0};
const WORLD={spacing:84},ISO={x:.8660254,y:.5},JUMP_DISTANCE=420,JUMP_DURATION=200,FIGHT_DURATION=1000;
const ECHO_MOBILE_RENDER=isMobilePerformanceDevice(navigator.userAgent,window.matchMedia?.('(pointer: coarse)')?.matches);
const ECHO_FRAME_INTERVAL=targetFrameInterval(ECHO_MOBILE_RENDER);
const modelScene=new THREE.Scene(),modelCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);modelCamera.position.z=100;const modelRenderer=new THREE.WebGLRenderer({canvas:modelCanvas,alpha:true,antialias:true,powerPreference:ECHO_MOBILE_RENDER?'low-power':'default'});modelRenderer.setPixelRatio(renderPixelRatio(devicePixelRatio,ECHO_MOBILE_RENDER));modelRenderer.outputColorSpace=THREE.SRGBColorSpace;modelRenderer.setClearColor(0,0);const ambientLight=new THREE.AmbientLight(0x4f6b7d,4.0);modelScene.add(ambientLight);const keyLight=new THREE.DirectionalLight(0xb9dcf5,3.6);keyLight.position.set(-100,57.735,0);modelScene.add(keyLight);
const mobileFloorReflections=createMobileFloorReflections({THREE,renderer:modelRenderer,scene:modelScene,camera:modelCamera,cloneSkeleton});
const loader=new GLTFLoader(),DEFAULT_MODEL='character-female-a.glb',ALLOWED_MODELS=new Set(['character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-d.glb','character-female-e.glb','character-female-f.glb','character-male-a.glb','character-male-b.glb','character-male-c.glb','character-male-d.glb','character-male-e.glb','character-male-f.glb','character-ghost.glb','character-keeper.glb','character-skeleton.glb','character-zombie.glb','character-human.glb','character-orc.glb']),modelCache={source:null,clips:[],local:null,localAnimation:null,others:new Map(),otherSources:new Map(),ready:false};
let selectedModel=ALLOWED_MODELS.has(localStorage.getItem('echo.selectedModel'))?localStorage.getItem('echo.selectedModel'):DEFAULT_MODEL;
const worldObjects = {trees: [],treeSource: null,treeLoading: false,waters: [],waterSources: new Map(),waterLoading: new Set(),};
const decorations=createWorldDecorations({THREE,loader,scene:modelScene,iso:ISO});
const serverWaterBoundaryDebug = createServerWaterBoundaryDebug(document.querySelector('#game'));
const worldMinimap = createWorldMinimap();
const playerLabels = createPlayerLabels(document.querySelector('#player-labels'));
const WATER_MODEL_BASE_SCALE = 50;
const WATER_MODEL_URLS = ['./assets/models/objects/patch-water.glb', './assets/models/objects/patch-water-large.glb'];
import WATER_GEOMETRY from './water-hazard-contours.js';
function getWaterGeometry(water) { return { vertices: WATER_GEOMETRY[water.model] || WATER_GEOMETRY['patch-water-large.glb'] }; }
function getWaterScale(water) { return WATER_MODEL_BASE_SCALE * water.scale; }
function isPointInPolygon(x,y,vertices){let inside=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const[xi,yi]=vertices[i],[xj,yj]=vertices[j];const crosses=(yi>y)!==(yj>y)&&x<((xj-xi)*(y-yi))/((yj-yi)||Number.EPSILON)+xi;if(crosses)inside=!inside;const cross=(x-xi)*(yj-yi)-(y-yi)*(xj-xi);if(Math.abs(cross)<1e-7&&x>=Math.min(xi,xj)-1e-7&&x<=Math.max(xi,xj)+1e-7&&y>=Math.min(yj,yi)-1e-7&&y<=Math.max(yj,yi)+1e-7)return true;}return inside;}
const TREE_MODEL_URL='./assets/models/objects/tree.glb',TREE_BASE_SCALE=50,TREE_SCALE_MIN=1.5,TREE_SCALE_MAX=2.5;
// Mystical winter-forest palette: blue needles, snowy tips, and deep-blue trunks.
const TREE_NEEDLE_COLOR=new THREE.Color(0x66b6d4);
const TREE_TRUNK_COLOR=new THREE.Color(0x203a4c); // Slightly lighter, still blue-graphite
const TREE_SNOW_COLOR=new THREE.Color(0xf5fbff); // Silver-white snowy tips
const TREE_SNOW_START=.68,TREE_SNOW_FULL=.96; // Concentrate the brightest frost near the top
const TREE_FOLIAGE_OPACITY=.30,TREE_SNOW_OPACITY=.42;
function createTreeMaterial(sourceMaterial,geometry){
  const material=sourceMaterial?.clone?.()||new THREE.MeshStandardMaterial({color:0xffffff});
  material.transparent=true;material.opacity=TREE_FOLIAGE_OPACITY;
  material.depthWrite=false;material.depthTest=false;material.side=THREE.DoubleSide;
  // Local geometry height allows each needle layer to receive a natural frosted tip.
  if(geometry&&!geometry.boundingBox)geometry.computeBoundingBox();
  const bottom=geometry?.boundingBox?.min.y??0;
  const height=Math.max(.00001,(geometry?.boundingBox?.max.y??1)-bottom);
  material.onBeforeCompile=shader=>{
    shader.uniforms.echoTreeBottom={value:bottom};
    shader.uniforms.echoTreeHeightInv={value:1/height};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying float vEchoTreeHeight;\nuniform float echoTreeBottom;\nuniform float echoTreeHeightInv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvEchoTreeHeight=clamp((position.y-echoTreeBottom)*echoTreeHeightInv,0.0,1.0);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying float vEchoTreeHeight;')
      .replace('#include <color_fragment>',`#include <color_fragment>
float echoNeedles=smoothstep(0.002,0.030,diffuseColor.g-diffuseColor.r);
float echoSnow=clamp(smoothstep(${TREE_SNOW_START.toFixed(2)},${TREE_SNOW_FULL.toFixed(2)},vEchoTreeHeight)+0.10*smoothstep(0.38,0.74,vEchoTreeHeight),0.0,1.0);
vec3 echoWinterNeedles=mix(vec3(${TREE_NEEDLE_COLOR.r.toFixed(6)},${TREE_NEEDLE_COLOR.g.toFixed(6)},${TREE_NEEDLE_COLOR.b.toFixed(6)}),vec3(${TREE_SNOW_COLOR.r.toFixed(6)},${TREE_SNOW_COLOR.g.toFixed(6)},${TREE_SNOW_COLOR.b.toFixed(6)}),echoSnow);
float echoLowerBranchShade=mix(0.82,1.0,smoothstep(0.08,0.84,vEchoTreeHeight));
echoWinterNeedles*=mix(echoLowerBranchShade,1.0,echoSnow);
diffuseColor.rgb=mix(diffuseColor.rgb,echoWinterNeedles,echoNeedles*0.94);
// Recolor non-green bark while leaving the needle/snow blend untouched.
diffuseColor.rgb=mix(vec3(${TREE_TRUNK_COLOR.r.toFixed(6)},${TREE_TRUNK_COLOR.g.toFixed(6)},${TREE_TRUNK_COLOR.b.toFixed(6)}),diffuseColor.rgb,echoNeedles);
diffuseColor.a=mix(diffuseColor.a,${TREE_SNOW_OPACITY.toFixed(2)},echoNeedles*echoSnow);`);
  };
  material.needsUpdate=true;
  return material;
}
function prepareTreeMaterials(root){root.traverse(child=>{if(!child.isMesh)return;child.material=Array.isArray(child.material)?child.material.map(material=>createTreeMaterial(material,child.geometry)):createTreeMaterial(child.material,child.geometry);child.castShadow=false;child.receiveShadow=false;});}
function addTreeModel(tree){if(!worldObjects.treeSource||tree.root)return;const root=cloneSkeleton(worldObjects.treeSource);prepareTreeMaterials(root);const scaleFactor=Math.max(TREE_SCALE_MIN,Math.min(TREE_SCALE_MAX,tree.scale));root.scale.setScalar(TREE_BASE_SCALE*scaleFactor);root.rotation.y=Number.isFinite(tree.rotation)?tree.rotation:0;root.renderOrder=0;tree.root=root;modelScene.add(root);}
function renderWorldTrees(snapshot){if(!Array.isArray(snapshot))return;for(const tree of worldObjects.trees)if(tree.root)modelScene.remove(tree.root);worldObjects.trees=snapshot.filter(tree=>tree&&typeof tree.id==='string'&&Number.isFinite(tree.x)&&Number.isFinite(tree.y)&&Number.isFinite(tree.scale)&&tree.scale>=TREE_SCALE_MIN&&tree.scale<=TREE_SCALE_MAX).map(tree=>({...tree,root:null}));for(const tree of worldObjects.trees)addTreeModel(tree);}
function loadWorldTreeModel(){if(worldObjects.treeLoading||worldObjects.treeSource)return;worldObjects.treeLoading=true;loader.load(TREE_MODEL_URL,gltf=>{worldObjects.treeSource=gltf.scene;worldObjects.treeLoading=false;for(const tree of worldObjects.trees)addTreeModel(tree);console.log('[echo] tree model loaded');},undefined,error=>{worldObjects.treeLoading=false;console.error('[echo] failed to load tree GLB',error);});}
function updateWorldTreePositions(){for(const tree of worldObjects.trees){if(!tree.root)continue;const p=worldToScreenPrecise(tree.x,tree.y);tree.root.position.x=p.x-state.width/2;tree.root.position.y=-(p.y-state.height/2);tree.root.position.z=0;tree.root.renderOrder=0;}}
function prepareWaterMaterials(root){root.traverse(child=>{if(!child.isMesh)return;child.material=Array.isArray(child.material)?child.material.map(material=>createWaterMaterial(material)):createWaterMaterial(child.material);child.castShadow=false;child.receiveShadow=false;child.renderOrder=-1;});}
function createWaterMaterial(sourceMaterial){const material=new THREE.MeshBasicMaterial({color:0x06245f,transparent:true,opacity:.22,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false,fog:false});material.needsUpdate=true;return material;}
function addWaterModel(water){const source=worldObjects.waterSources.get(water.model);if(!source||water.root)return;const surface=cloneSkeleton(source);prepareWaterMaterials(surface);surface.rotation.set(Math.PI/2,0,0);surface.scale.setScalar(getWaterScale(water));surface.position.set(0,0,0);const holder=new THREE.Group();holder.rotation.z=(Number.isFinite(water.rotation)?water.rotation:0)+Math.PI/2;holder.position.z=-1;holder.add(surface);holder.traverse(child=>{if(!child.isMesh)return;child.renderOrder=-1;if(child.material){child.material.depthTest=true;child.material.depthWrite=false;child.needsUpdate=true;child.material.needsUpdate=true;}});holder.renderOrder=-1;water.root=holder;modelScene.add(holder);window.dispatchEvent(new CustomEvent('echo:water-model-created',{detail:{root:holder,model:water.model}}));
window.dispatchEvent(new CustomEvent('echo:water-models-ready',{detail:{waters:worldObjects.waters.map(({root,model})=>({root,model}))}}));}
function renderWorldWaters(snapshot){if(!Array.isArray(snapshot))return;for(const water of worldObjects.waters)if(water.root)modelScene.remove(water.root);worldObjects.waters=snapshot.filter(water=>water&&typeof water.id==='string'&&(water.model==='patch-water.glb'||water.model==='patch-water-large.glb')&&Number.isFinite(water.x)&&Number.isFinite(water.y)&&Number.isFinite(water.scale)&&water.scale>0&&Number.isFinite(water.collisionRadius)&&water.collisionRadius>0).map(water=>({...water,root:null}));for(const water of worldObjects.waters)addWaterModel(water);}
function loadWorldWaterModels(){for(const url of WATER_MODEL_URLS){const file=url.split('/').pop();if(worldObjects.waterSources.has(file)||worldObjects.waterLoading.has(file))continue;worldObjects.waterLoading.add(file);loader.load(url,gltf=>{worldObjects.waterSources.set(file,gltf.scene);worldObjects.waterLoading.delete(file);for(const water of worldObjects.waters)if(water.model===file)addWaterModel(water);console.log(`[echo] water model loaded: ${file}`);},undefined,error=>{worldObjects.waterLoading.delete(file);console.error(`[echo] failed to load water model: ${file}`,error);});}}
function updateWorldWaterPositions(){for(const water of worldObjects.waters){if(!water.root)continue;const p=worldToScreenPrecise(water.x,water.y);water.root.position.x=p.x-state.width/2;water.root.position.y=-(p.y-state.height/2);water.root.position.z=-1;water.root.renderOrder=-1;}}
function isPlayerInWater(x=state.x,y=state.y){return worldObjects.waters.some(water=>Array.isArray(water.serverContourWorld)&&water.serverContourWorld.length>=3&&isPointInPolygon(x,y,water.serverContourWorld));}
function prepareModel(root,isOther=false){root.traverse(child=>{if(!child.isMesh)return;child.castShadow=false;child.receiveShadow=false;if(child.material){child.material=child.material.clone();if('emissiveIntensity'in child.material)child.material.emissiveIntensity=isOther?.9:1.1;}});root.scale.setScalar(isOther?42:50);return root;}
function findClip(clips,names){const wanted=names.map(n=>n.toLowerCase());return clips.find(c=>wanted.some(n=>c.name.toLowerCase()===n))||clips.find(c=>wanted.some(n=>c.name.toLowerCase().includes(n)));}
function setupAnimation(root,clips,isOther=false){if(!clips?.length)return null;const mixer=new THREE.AnimationMixer(root),idle=findClip(clips,['idle','idle_01','idle-01']),run=findClip(clips,['sprint','run','running']),walk=run||findClip(clips,['walk','walk_01','walk-01']),attackMeleeRight=findClip(clips,['attack-melee-right']),attackMeleeLeft=findClip(clips,['attack-melee-left']),attackKickRight=findClip(clips,['attack-kick-right']),attackKickLeft=findClip(clips,['attack-kick-left']),die=findClip(clips,['die','death']),action=idle||clips[0];if(action)mixer.clipAction(action).play();return{mixer,idle,walk,attackMeleeRight,attackMeleeLeft,attackKickRight,attackKickLeft,die,current:action,combatUntil:0,combatAction:null,isOther};}
function startAttackAnimation(a,v='right',until=performance.now()+FIGHT_DURATION){if(!a)return;const action=v==='left'?(a.attackMeleeLeft||a.attackKickLeft||a.attackMeleeRight||a.attackKickRight):(a.attackMeleeRight||a.attackKickRight||a.attackMeleeLeft||a.attackKickLeft);if(!action)return;if(a.combatAction!==action){const current=a.current?a.mixer.clipAction(a.current):null,next=a.mixer.clipAction(action);current?.fadeOut(.08);next.reset();next.setLoop(THREE.LoopRepeat,Infinity);next.fadeIn(.08).play();a.current=action;a.combatAction=action;}a.combatUntil=until;}
function switchAnimation(a,moving,time){if(!a)return;if(time<a.combatUntil&&a.combatAction){const attack=a.mixer.clipAction(a.combatAction);if(!attack.isRunning())attack.play();return;}if(a.combatAction&&time>=a.combatUntil){a.combatAction=null;a.combatUntil=0;}const next=moving&&a.walk?a.walk:a.idle;if(!next||next===a.current)return;const current=a.mixer.clipAction(a.current),nextAction=a.mixer.clipAction(next);nextAction.reset().setLoop(THREE.LoopRepeat,Infinity).fadeIn(.15).play();current.fadeOut(.15);a.current=next;}
const characterLoader=createCharacterLoaderSelector(THREE,GLTFLoader,loader);
function loadCharacterModel(file,onLoaded,onError){const safe=ALLOWED_MODELS.has(file)?file:DEFAULT_MODEL;characterLoader(safe).load(`./assets/models/${safe}`,g=>onLoaded(g,safe),undefined,e=>{console.error(`[echo] failed to load character GLB: ${safe}`,e);onError?.(e,safe);});}
let localModelLoadId=0;
function createLocalModel(file){
 const loadId=++localModelLoadId;
 if(modelCache.local)modelScene.remove(modelCache.local);
 modelCache.local=null;modelCache.localAnimation=null;modelCache.ready=false;
 loadCharacterModel(file,(g,file2)=>{
  if(loadId!==localModelLoadId)return; // A previous GLB request finished after a new selection.
  modelCache.source=g.scene;modelCache.clips=g.animations||[];
  const local=new THREE.Group(),visible=prepareModel(g.scene,false);
  local.add(visible);modelCache.local=local;
  modelCache.localAnimation=setupAnimation(visible,modelCache.clips,false);
  local.userData.animation=modelCache.localAnimation;
  modelScene.add(local);
  local.userData.labelBounds=measurePlayerLabelBounds(THREE,local);
  attachSpawnShield(THREE,local);
  modelCache.ready=true;
  console.log(`[echo] GLB loaded: ${file2}; animations: ${modelCache.clips.length}`);
 });
}
function applyGameHero(file){
 if(!ALLOWED_MODELS.has(file)||file===selectedModel)return;
 selectedModel=file;
 window.ECHO_SELECTED_MODEL=file;
 createLocalModel(file);
}
// A post-login verification may correct a previously selected, now-locked hero.
document.addEventListener('echo:hero-selection-updated',event=>{
 applyGameHero(event.detail?.model);
});
createLocalModel(selectedModel);
function resize(){
  const rect=canvas.getBoundingClientRect();
  const pixelWidth=Math.max(1,rect.width),pixelHeight=Math.max(1,rect.height);
  const viewport=getWorldViewport(pixelWidth,pixelHeight);
  state.dpr=renderPixelRatio(devicePixelRatio,ECHO_MOBILE_RENDER);
  // Fixed zoomed-in vertical field of view (350 world units at 2x zoom).
  // Aspect ratio controls ONLY the visible horizontal field of view.
  state.width=viewport.width;
  state.height=viewport.height;
  state.worldScale=viewport.scale;
  canvas.width=Math.round(pixelWidth*state.dpr);
  canvas.height=Math.round(pixelHeight*state.dpr);
  ctx.setTransform(state.dpr*viewport.scale,0,0,state.dpr*viewport.scale,0,0);
  modelRenderer.setPixelRatio(state.dpr);
  modelRenderer.setSize(pixelWidth,pixelHeight,false);
  serverWaterBoundaryDebug.resize(pixelWidth,pixelHeight,state.dpr,viewport.scale);
  playerLabels.resize(pixelWidth,pixelHeight,state.dpr,viewport.scale);
  modelCamera.left=-viewport.width/2;
  modelCamera.right=viewport.width/2;
  modelCamera.top=viewport.height/2;
  modelCamera.bottom=-viewport.height/2;
  modelCamera.updateProjectionMatrix();
  // Centered water-step overlay is part of the world, not the real-screen HUD.
  const gameElement=document.querySelector('#game');
  gameElement?.style.setProperty('--echo-world-scale',String(viewport.scale));
  // HUD/menu use the original 700px height reference, independently of zoom.
  // Joystick and action buttons are enlarged separately in ui-layout.css.
  gameElement?.style.setProperty('--echo-ui-scale',String(viewport.uiScale));
}addEventListener('resize',resize,{passive:true});addEventListener('echo:viewport-resized',resize,{passive:true});resize();
function setConnection(s,l){connectionDot.classList.toggle('online',s==='online');connectionDot.classList.toggle('offline',s==='offline');connectionLabel.textContent=window.$t?window.$t(l,l):l;}function getPlayerPosition(id){if(!id)return null;if(id===state.socket?.id)return{x:state.x,y:state.y};const p=state.others.get(id);return p?{x:p.displayX??p.targetX,y:p.displayY??p.targetY}:null;}
function beginCombatVisual(a,b,fid){const now=performance.now(),local=a===state.socket?.id||b===state.socket?.id,oid=a===state.socket?.id?b:a===state.socket?.id?a:null;if(!local){const x=state.others.get(a),y=state.others.get(b);if(x){x.combatUntil=now+FIGHT_DURATION;x.combatFightId=fid;x.fightingWith=b;}if(y){y.combatUntil=now+FIGHT_DURATION;y.combatFightId=fid;y.fightingWith=a;}return;}state.combatUntil=now+FIGHT_DURATION;state.combatOpponentId=oid;state.combatFightId=fid;state.vx=0;state.vy=0;const o=state.others.get(oid);if(o)o.combatUntil=now+FIGHT_DURATION;}
function showDefeat(){state.defeated=true;state.combatUntil=0;state.combatOpponentId=null;state.vx=0;state.vy=0;energyText.textContent='0';defeatScreen.hidden=false;}let battleReplayPending=false;
async function startNewGame(){
 if(battleReplayPending)return;
 battleReplayPending=true;
 if(defeatReplay)defeatReplay.disabled=true;
 const u=new URL(location.href);
 u.searchParams.set('play','1');
 // In APK the native WebView intercepts this replay-only navigation,
 // shows SDK interstitial if due, then proceeds to the actual game URL.
 if(window.ECHO_ANDROID_ARENA===true){
  u.searchParams.set('echo_interstitial','replay');
  location.href=u.toString();
  return;
 }
 try{
  const ads=await import('./battle-entry-ads.js?v=echo-interstitial-2097075-test-from-3-1');
  await ads.showAdBeforeBattle();
 }catch(error){
  console.warn('[ECHO interstitial] replay without ad',error);
 }finally{
  location.href=u.toString();
  battleReplayPending=false;
  if(defeatReplay)defeatReplay.disabled=false;
 }
}defeatReplay?.addEventListener('click',startNewGame);defeatMenu?.addEventListener('click',returnToMenu);
function connectSocket(){if(!window.io){setConnection('offline','game:connection_local');return;}try{state.socket=window.io(window.ECHO_SERVER_URL||location.origin,{path:'/echo/socket.io/',transports:['websocket','polling'],reconnection:true,timeout:5000,auth:{skin:selectedModel,activityProfileId,playerName,accountToken:localStorage.getItem('echo.authToken')||null}});window.echoSocket=state.socket;document.dispatchEvent(new CustomEvent('echo:socket-ready',{detail:{socket:state.socket}}));state.socket.on('echo:world',world=>{window.echoWorld=world;if(world&&Array.isArray(world.trees))renderWorldTrees(world.trees);if(world&&Array.isArray(world.waters))renderWorldWaters(world.waters);if(world&&Array.isArray(world.decorations))decorations.setSnapshot(world.decorations);});state.socket.on('echo:deathFlowers',data=>{
  if(!data||!Array.isArray(data.flowers))return;
  decorations.setDeathFlowers(data.flowers);
});state.socket.on('connect',()=>{decorations.setDeathFlowers([]);state.hasServerSpawn=false;state.shieldUntil=0;setConnection('online','game:connection_online');state.socket.emit('echo:hello',{version:1,skin:selectedModel,activityProfileId,playerName});lastDailyPing=-15000;sendDailyActivityPing();});state.socket.on('disconnect',()=>setConnection('offline','game:connection_offline'));state.socket.on('connect_error',error=>{
  if(error?.data?.code==='ACCOUNT_ALREADY_PLAYING'){
    setConnection('offline','game:connection_offline');
    state.socket.io.reconnection(false);
    state.socket.disconnect();
    returnToMenu();
    window.ECHOModal?.alert({
      title:'ПОДКЛЮЧЕНИЕ ОТКЛОНЕНО',
      text:'Вы уже находитесь в игре с другого устройства.',
      buttonText:'Понятно',
      closeOnBackdrop:false
    });
    return;
  }
  setConnection('offline','game:connection_pending');
 });state.socket.on('echo:positionCorrection',data=>{
  // Server rejects moves that exceed the player's energy-based mobility budget.
  if(!Number.isFinite(data?.x)||!Number.isFinite(data?.y))return;
  state.x=data.x;state.y=data.y;state.cameraX=data.x;state.cameraY=data.y;
  state.vx=0;state.vy=0;state.jumpStart=0;state.jumpUntil=0;
 });state.socket.on('echo:spawn',data=>{
  if(!data||!Number.isFinite(data.x)||!Number.isFinite(data.y))return;
  state.x=data.x;state.y=data.y;
  state.cameraX=data.x;state.cameraY=data.y;
  state.shieldUntil=Number.isFinite(data.shieldUntil)?data.shieldUntil:0;
  state.hasServerSpawn=true;state.vx=0;state.vy=0;
  state.jumpStart=0;state.jumpUntil=0;state.combatUntil=0;
  state.combatOpponentId=null;state.combatFightId=null;state.defeated=false;
  if(defeatScreen)defeatScreen.hidden=true;
  coordsText.textContent=Math.round(state.x)+' · '+Math.round(state.y);
 });state.socket.on('echo:fight',({fightId,playerA,playerB})=>beginCombatVisual(playerA,playerB,fightId));state.socket.on('echo:combatResult',({fightId,result,energy})=>{if(fightId!==state.combatFightId)return;state.combatUntil=0;state.combatOpponentId=null;state.combatFightId=null;if(result==='lose'){state.energy=0;showDefeat();}else{state.energy=Number.isFinite(energy)?energy:state.energy;energyText.textContent=String(state.energy);}});state.socket.on('echo:players',players=>{if(!Array.isArray(players))return;const now=performance.now(),next=new Map();for(const p of players){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;if(p.id===state.socket.id){applyGameHero(p.skin);if(typeof p.name==='string'&&p.name.trim())playerName=p.name;if(Number.isFinite(p.shieldUntil))state.shieldUntil=p.shieldUntil;if(Number.isFinite(p.energy)){state.energy=Math.max(0,Math.round(p.energy));energyText.textContent=String(state.energy);}continue;}const old=state.others.get(p.id),skin=ALLOWED_MODELS.has(p.skin)?p.skin:DEFAULT_MODEL,t={...p,skin,previousX:old?.targetX??p.x,previousY:old?.targetY??p.y,targetX:p.x,targetY:p.y,previousSnapshotAt:old?.snapshotAt??now-80,snapshotAt:now,displayX:old?.displayX??p.x,displayY:old?.displayY??p.y,vx:Number.isFinite(p.vx)?p.vx:0,vy:Number.isFinite(p.vy)?p.vy:0,combatUntil:old?.combatUntil??(p.fightingWith?now+FIGHT_DURATION:0),combatFightId:old?.combatFightId??p.fightId??null};if(!old){t.previousSnapshotAt=now-120;t.previousX=p.x;t.previousY=p.y;}next.set(p.id,t);}state.others=next;state.lastSnapshotAt=now;});}catch{setConnection('offline','game:connection_local');}}

// The multiplayer connection belongs to gameplay, not to the account menu.
// Releasing it on exit frees the server-side one-session-per-account reservation.
function inActiveGame(){
 return document.querySelector('#main-menu')?.classList.contains('is-hidden')===true;
}
function releaseGameSocket(){
 const socket=state.socket;
 if(!socket)return;
 state.socket=null;
 if(window.echoSocket===socket)window.echoSocket=null;
 socket.disconnect(); // Explicit disconnect disables automatic reconnect.
 state.others.clear();
 if(typeof decorations!=='undefined')decorations.setDeathFlowers([]);
 state.hasServerSpawn=false;state.shieldUntil=0;
 setConnection('offline','game:connection_offline');
}
// VK Mini Apps authenticate asynchronously. Only enter the world after the
// game screen is active and a verified VK session has been established.
if(inActiveGame()&&(!window.isVKMiniApp||window.ECHOAuth?.getCurrent?.()))connectSocket();
document.addEventListener('echo:auth-changed',event=>{
 const detail=event.detail||{};
 const authenticated=detail.authenticated===true;
 const accountToken=authenticated?(localStorage.getItem('echo.authToken')||null):null;
 playerName=authenticated&&typeof detail.nickname==='string'&&detail.nickname.trim()
  ?detail.nickname:guestPlayerName;
 if(!inActiveGame()||(window.isVKMiniApp&&!authenticated)){
  releaseGameSocket();
  return;
 }
 if(!state.socket){
  if(authenticated||!window.isVKMiniApp)connectSocket();
  return;
 }
 const previousToken=state.socket.auth?.accountToken||null;
 if(previousToken!==accountToken||(authenticated&&detail.nicknameChanged===true)){
  // Socket.IO validates the refreshed account token on the next handshake.
  state.socket.auth={...state.socket.auth,accountToken,playerName};
  state.socket.disconnect().connect();
 }
});
let lastDailyPing=0;function sendDailyActivityPing(now=performance.now()){if(!state.socket?.connected||document.hidden||now-lastDailyPing<15000)return;lastDailyPing=now;state.socket.emit('echo:dailyPing',{activityProfileId});}document.addEventListener('visibilitychange',()=>{if(!state.socket?.connected)return;if(document.hidden){state.socket.emit('echo:dailyPing',{activityProfileId,active:false});}else{lastDailyPing=-15000;sendDailyActivityPing();}});function returnToMenu(){
  releaseGameSocket();
  // Defeat dialog has z-index 30 and would otherwise cover the menu (z-index 20).
  const defeatOverlay=document.querySelector('#defeat-screen');
  if(defeatOverlay)defeatOverlay.hidden=true;
  document.querySelector('#main-menu')?.classList.remove('is-hidden');
  document.getElementById('game')?.classList.remove('echo-in-battle');
  document.querySelector('#menu-main')?.removeAttribute('hidden');
  document.dispatchEvent(new Event('echo:returned-to-menu'));
}gameExitButton?.addEventListener('click',async()=>{const confirmed=await window.ECHOModal?.confirm({title:window.$t?.('game:exit_confirm_title','Выход из игры')||'Выход из игры',text:window.$t?.('game:exit_confirm_text','Вы действительно хотите покинуть игру?')||'Вы действительно хотите покинуть игру?',confirmText:window.$t?.('menu:yes','Да')||'Да',cancelText:window.$t?.('menu:no','Нет')||'Нет'});if(confirmed)returnToMenu();});if(new URLSearchParams(location.search).get('play')==='1')document.dispatchEvent(new Event('echo:game-started'));
function isoProject(x,y){return{x:(x-y)*ISO.x,y:(x+y)*ISO.y};}function drawIsoLine(a,b){const pa=isoProject(a.x-state.cameraX,a.y-state.cameraY),pb=isoProject(b.x-state.cameraX,b.y-state.cameraY);ctx.moveTo(Math.round(state.width/2+pa.x)+.5,Math.round(state.height/2+pa.y)+.5);ctx.lineTo(Math.round(state.width/2+pb.x)+.5,Math.round(state.height/2+pb.y)+.5);}function worldToScreen(x,y){const p=isoProject(x,y),c=isoProject(state.cameraX,state.cameraY);return{x:Math.round(state.width/2+p.x-c.x),y:Math.round(state.height/2+p.y-c.y)}}function worldToScreenPrecise(x,y){const p=isoProject(x,y),c=isoProject(state.cameraX,state.cameraY);return{x:state.width/2+p.x-c.x,y:state.height/2+p.y-c.y}}
function drawGrid(time){const{width,height}=state,s=84,fade=ctx.createRadialGradient(width/2,height/2,30,width/2,height/2,Math.max(width,height)*.7);fade.addColorStop(0,'rgba(169,198,228,.15)');fade.addColorStop(.55,'rgba(115,146,181,.055)');fade.addColorStop(1,'rgba(80,105,140,.004)');const rx=Math.ceil(width/ISO.x)+s*2,ry=Math.ceil(height/ISO.y)+s*2,sx=Math.floor((state.cameraX-rx)/s)*s,ex=Math.ceil((state.cameraX+rx)/s)*s,sy=Math.floor((state.cameraY-ry)/s)*s,ey=Math.ceil((state.cameraY+ry)/s)*s;ctx.strokeStyle=fade;ctx.lineWidth=1;ctx.beginPath();for(let x=sx;x<=ex;x+=s)drawIsoLine({x,y:state.cameraY-ry},{x,y:state.cameraY+ry});for(let y=sy;y<=ey;y+=s)drawIsoLine({x:state.cameraX-rx,y},{x:state.cameraX+rx,y});ctx.stroke();ctx.fillStyle='rgba(195,222,247,.12)';for(let x=sx;x<=ex;x+=s)for(let y=sy;y<=ey;y+=s){const p=worldToScreen(x,y);if(p.x>-2&&p.x<width+2&&p.y>-2&&p.y<height+2){ctx.globalAlpha=.25+.1*Math.sin(time*.0006+(x+y)*.02);ctx.fillRect(p.x-1,p.y-1,2,2)}}ctx.globalAlpha=1;}
function updateModel(root,a,x,y,vx,vy,time,label,other=false,fx=vx,fy=vy){if(!root)return;
 const size=energySizeMultiplier(label);
 root.scale.setScalar(size);
 // Original name/energy labels are measured at base GLB size: follow the growing model.
 if(root.userData.labelBounds){
  if(!root.userData.baseLabelBounds)root.userData.baseLabelBounds=root.userData.labelBounds;
  const bounds=root.userData.baseLabelBounds;
  root.userData.labelBounds={top:bounds.top*size,bottom:bounds.bottom*size};
 }
 const p=worldToScreenPrecise(x,y);root.position.x=p.x-state.width/2;root.position.y=-(p.y-state.height/2)+Math.sin(time*.0028+x*.02)*(Math.hypot(vx||0,vy||0)>18?1.3:1.8);root.position.z=0;root.renderOrder=0;const moving=Math.hypot(vx||0,vy||0)>18;updateCharacterFacing(root,fx,fy,ISO);switchAnimation(a,moving,time);}
function ensureOtherModel(p){let e=modelCache.others.get(p.id);if(e&&e.skin===p.skin)return e;if(e){modelScene.remove(e.root);modelCache.others.delete(p.id);}const source=modelCache.otherSources.get(p.skin);if(!source){if(!modelCache.otherSources.has(p.skin)){modelCache.otherSources.set(p.skin,null);loadCharacterModel(p.skin,(g,f)=>modelCache.otherSources.set(f,{scene:g.scene,clips:g.animations||[]}));}return null;}const holder=new THREE.Group(),clone=cloneSkeleton(source.scene);clone.scale.setScalar(1);prepareModel(clone,true);holder.add(clone);const animation=setupAnimation(clone,source.clips,true);modelScene.add(holder);holder.userData.labelBounds=measurePlayerLabelBounds(THREE,holder);attachSpawnShield(THREE,holder);e={root:holder,animation,skin:p.skin};modelCache.others.set(p.id,e);return e;}
function getCombatFacing(x,y,id,fx,fy){const o=getPlayerPosition(id);if(!o)return{x:fx,y:fy};const dx=o.x-x,dy=o.y-y,l=Math.hypot(dx,dy);return l<.001?{x:fx,y:fy}:{x:dx/l,y:dy/l};}
function drawModels(time,dt){updateWorldTreePositions();updateWorldWaterPositions();decorations.update(state.cameraX,state.cameraY);if(!modelCache.ready){mobileFloorReflections.render(null,worldObjects.trees,state.width,state.height);return;}const jumping=time<state.jumpUntil,combat=!state.defeated&&time<state.combatUntil;modelCache.local.visible=!jumping&&!state.defeated;if(!jumping&&!state.defeated){const f=combat?getCombatFacing(state.x,state.y,state.combatOpponentId,state.vx,state.vy):{x:state.vx,y:state.vy};updateModel(modelCache.local,modelCache.localAnimation,state.x,state.y,state.vx,state.vy,time,state.energy,false,f.x,f.y);if(combat)startAttackAnimation(modelCache.localAnimation,'right',state.combatUntil);updateSpawnShield(modelCache.local,state.shieldUntil);}const alive=new Set();for(const p of state.others.values()){const e=ensureOtherModel(p);if(!e)continue;alive.add(p.id);const since=Math.min(Math.max(0,(performance.now()-p.snapshotAt)/1000),.25),px=p.targetX+p.vx*since,py=p.targetY+p.vy*since,c=1-Math.exp(-18*dt);p.displayX+=(px-p.displayX)*c;p.displayY+=(py-p.displayY)*c;const fighting=p.combatUntil>time||!!p.fightingWith,f=fighting?getCombatFacing(p.displayX,p.displayY,p.fightingWith,p.vx,p.vy):{x:p.vx||0,y:p.vy||0};if(fighting)startAttackAnimation(e.animation,p.id.charCodeAt(0)%2?'left':'right',p.combatUntil||time+FIGHT_DURATION);updateModel(e.root,e.animation,p.displayX,p.displayY,p.vx||0,p.vy||0,time,p.energy||0,true,f.x,f.y);updateSpawnShield(e.root,p.shieldUntil);}for(const[id,e]of modelCache.others)if(!alive.has(id)){modelScene.remove(e.root);modelCache.others.delete(id)}for(const e of modelCache.others.values())e.animation?.mixer.update(dt);modelCache.localAnimation?.mixer.update(dt);mobileFloorReflections.render(modelCache.local,worldObjects.trees,state.width,state.height);}
function draw(time){ctx.clearRect(0,0,state.width,state.height);drawGrid(time);drawModels(time,state.lastTime?Math.min((time-state.lastTime)/1000,.05):0);serverWaterBoundaryDebug.render(worldObjects.waters,state.cameraX,state.cameraY);worldMinimap.render(time,state.x,state.y,state.others);playerLabels.render({x:state.x,y:state.y,energy:state.energy,name:playerName,bounds:modelCache.local?.userData.labelBounds,visible:modelCache.ready&&!state.defeated&&time>=state.jumpUntil&&(!window.isVKMiniApp||Boolean(window.ECHOAuth?.getCurrent?.()))},state.others,state.cameraX,state.cameraY,modelCache.others);}
function isJumpLandingBlocked(x,y){const playerRadius=24,safetyGap=10;return worldObjects.trees.some(tree=>Math.hypot(x-tree.x,y-tree.y)<(Number(tree.collisionRadius)||0)+playerRadius+safetyGap);}
function getSafeJumpTarget(startX,startY,dx,dy,maxDistance=JUMP_DISTANCE){for(let distance=maxDistance;distance>=0;distance-=4){const x=startX+dx*distance,y=startY+dy*distance;if(!isJumpLandingBlocked(x,y))return{x,y};}return{x:startX,y:startY};}
function triggerJump(){const now=performance.now();if(now<state.jumpUntil||state.defeated||state.combatUntil>now)return;let l=Math.hypot(state.vx,state.vy),dx,dy;if(l>=1){dx=state.vx/l;dy=state.vy/l;}else{const screenX=state.inputX+(state.keys.has('ArrowRight')||state.keys.has('d')?1:0)-(state.keys.has('ArrowLeft')||state.keys.has('a')?1:0),screenY=state.inputY+(state.keys.has('ArrowDown')||state.keys.has('s')?1:0)-(state.keys.has('ArrowUp')||state.keys.has('w')?1:0),inputLength=Math.hypot(screenX,screenY);if(inputLength>0.01){const x=screenX/inputLength,y=screenY/inputLength;dx=x/(2*ISO.x)+y/(2*ISO.y);dy=-x/(2*ISO.x)+y/(2*ISO.y);const worldLength=Math.hypot(dx,dy);dx/=worldLength;dy/=worldLength;}else{const facing=modelCache.local?.children?.[0]?.rotation?.y??modelCache.local?.rotation?.y??0;dx=Math.sin(facing);dy=Math.cos(facing);if(Math.hypot(dx,dy)<.01){dx=0;dy=1;}}}const target=getSafeJumpTarget(state.x,state.y,dx,dy,energyJumpDistance(state.energy,JUMP_DISTANCE));if(Math.hypot(target.x-state.x,target.y-state.y)<24)return;state.socket?.emit('echo:ability',{type:'jump',dx,dy});playGameSound('jump');window.dispatchEvent(new CustomEvent('echo:player-movement',{detail:{vx:0,vy:0}}));state.jumpStart=now;state.jumpUntil=now+JUMP_DURATION;state.jumpFromX=state.x;state.jumpFromY=state.y;state.jumpToX=target.x;state.jumpToY=target.y;}jumpButton?.addEventListener('pointerdown',triggerJump);
function update(dt,time){sendDailyActivityPing(time);if(state.defeated){state.vx=0;state.vy=0;window.dispatchEvent(new CustomEvent('echo:player-movement',{detail:{vx:0,vy:0}}))}else if(time<state.combatUntil){state.vx=0;state.vy=0;window.dispatchEvent(new CustomEvent('echo:player-movement',{detail:{vx:0,vy:0}}))}else if(time<state.jumpUntil){const p=Math.min(1,(time-state.jumpStart)/200);state.x=state.jumpFromX+(state.jumpToX-state.jumpFromX)*p;state.y=state.jumpFromY+(state.jumpToY-state.jumpFromY)*p;state.vx=(state.jumpToX-state.jumpFromX)/.2;state.vy=(state.jumpToY-state.jumpFromY)/.2}else{if(state.jumpStart){state.vx=0;state.vy=0;state.jumpStart=0}const inWater=isPlayerInWater();state.speedMultiplier=inWater?.5:1;window.dispatchEvent(new CustomEvent('echo:water-state',{detail:{inWater,x:state.x,y:state.y,vx:state.vx,vy:state.vy,cameraX:state.cameraX,cameraY:state.cameraY}}));state.energyMobilityMultiplier=energySpeedMultiplier(state.energy);updatePlayerMovement(state,dt,time,ISO,worldObjects.trees)}state.cameraX=state.x;state.cameraY=state.y;coordsText.textContent=`${Math.round(state.x)} · ${Math.round(state.y)}`;if(state.socket?.connected&&state.hasServerSpawn&&!state.defeated&&time-state.lastSent>80){state.lastSent=time;state.socket.emit('echo:move',{x:state.x,y:state.y,energy:state.energy,vx:state.vx,vy:state.vy,skin:selectedModel});}}
function triggerBoost(){const now=performance.now();if(now<state.boostCooldownUntil||state.defeated||state.combatUntil>now)return;state.socket?.emit('echo:ability',{type:'boost'});playGameSound('dash');state.boostUntil=now+700;state.boostCooldownUntil=now+3000;boostButton.classList.remove('cooldown','ready');boostButton.classList.add('active');setTimeout(()=>boostButton.classList.remove('active'),700);const countdown=document.createElement('span');countdown.className='ability-cooldown';countdown.setAttribute('aria-hidden','true');boostButton.appendChild(countdown);boostButton.classList.add('cooldown');const phases=[{value:'2',start:0,duration:850},{value:'1',start:1150,duration:1550}];let last=-1;const tick=()=>{const elapsed=performance.now()-now;if(elapsed>=3000){countdown.remove();boostButton.classList.remove('cooldown');boostButton.classList.add('ready');setTimeout(()=>boostButton.classList.remove('ready'),450);return;}const i=phases.findIndex(p=>elapsed>=p.start&&elapsed<p.start+p.duration);if(i!==last){last=i;countdown.classList.remove('countdown-pop');if(i>=0){countdown.textContent=phases[i].value;countdown.style.animationDuration=`${phases[i].duration}ms`;void countdown.offsetWidth;countdown.classList.add('countdown-pop')}else countdown.textContent='';}requestAnimationFrame(tick)};tick();}
loadWorldTreeModel();loadWorldWaterModels();bindPlayerControls({state,joystick,stick,boostButton,triggerBoost,jumpButton,triggerJump});
// Render only during an active, visible battle. Never run heavy GPU passes behind menus.
let renderRequest=0,previousRenderedAt=0;
function frame(time){
 renderRequest=0;
 if(!shouldDrawScene(inActiveGame(),document.hidden)){
  state.lastTime=0;previousRenderedAt=0;return;
 }
 renderRequest=requestAnimationFrame(frame);
 if(previousRenderedAt&&time-previousRenderedAt<ECHO_FRAME_INTERVAL-1)return;
 const dt=state.lastTime?Math.min((time-state.lastTime)/1000,.05):0;
 update(dt,time);draw(time);
 state.lastTime=time;previousRenderedAt=time;
}
function syncGameRender(){
 if(!shouldDrawScene(inActiveGame(),document.hidden)){
  if(renderRequest)cancelAnimationFrame(renderRequest);
  renderRequest=0;state.lastTime=0;previousRenderedAt=0;return;
 }
 if(!renderRequest)renderRequest=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',syncGameRender);
document.addEventListener('echo:returned-to-menu',syncGameRender);
document.addEventListener('echo:game-started',syncGameRender);
syncGameRender();

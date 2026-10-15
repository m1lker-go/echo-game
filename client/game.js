import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js';
import { bindPlayerControls, updatePlayerMovement } from './player-controls.js';
import { updateCharacterFacing } from './character-facing.js';

const activityProfileStorageKey = 'echo.activityProfileId';
let activityProfileId = localStorage.getItem(activityProfileStorageKey);
if (!activityProfileId || !/^[a-zA-Z0-9_-]{16,80}$/.test(activityProfileId)) {
  activityProfileId = (globalThis.crypto?.randomUUID?.() || ('echo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))).replace(/[^a-zA-Z0-9_-]/g, '_');
  localStorage.setItem(activityProfileStorageKey, activityProfileId);
}

const canvas=document.querySelector('#world'),modelCanvas=document.querySelector('#models'),ctx=canvas.getContext('2d',{alpha:true}),energyText=document.querySelector('#energy'),coordsText=document.querySelector('#coords'),connectionDot=document.querySelector('#connection-dot'),connectionLabel=document.querySelector('#connection-label'),gameExitButton=document.querySelector('#game-exit'),joystick=document.querySelector('#joystick'),stick=document.querySelector('#stick'),boostButton=document.querySelector('#boost'),jumpButton=document.querySelector('#jump'),defeatScreen=document.querySelector('#defeat-screen'),defeatReplay=document.querySelector('#defeat-replay'),defeatMenu=document.querySelector('#defeat-menu');
const state={x:0,y:0,vx:0,vy:0,energy:0,cameraX:0,cameraY:0,inputX:0,inputY:0,width:1,height:1,dpr:1,keys:new Set(),lastTime:0,boostUntil:0,boostCooldownUntil:0,jumpUntil:0,jumpStart:0,jumpFromX:0,jumpFromY:0,jumpToX:0,jumpToY:0,combatUntil:0,combatOpponentId:null,combatFightId:null,defeated:false,socket:null,others:new Map(),lastSent:0,lastSnapshotAt:0};
const WORLD={spacing:84},ISO={x:.8660254,y:.5},JUMP_DISTANCE=420,JUMP_DURATION=200,FIGHT_DURATION=1000;
const modelScene=new THREE.Scene(),modelCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);modelCamera.position.z=100;const modelRenderer=new THREE.WebGLRenderer({canvas:modelCanvas,alpha:true,antialias:true});modelRenderer.setPixelRatio(Math.min(devicePixelRatio||1,2));modelRenderer.outputColorSpace=THREE.SRGBColorSpace;modelRenderer.setClearColor(0,0);modelScene.add(new THREE.AmbientLight(0xffffff,2.2));const keyLight=new THREE.DirectionalLight(0xd9eeff,3.5);keyLight.position.set(-40,80,120);modelScene.add(keyLight);const rimLight=new THREE.DirectionalLight(0x9ed7ff,2.2);rimLight.position.set(60,30,100);modelScene.add(rimLight);
const loader=new GLTFLoader(),DEFAULT_MODEL='character-female-a.glb',ALLOWED_MODELS=new Set(['character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-d.glb','character-female-e.glb','character-female-f.glb','character-male-a.glb','character-male-b.glb','character-male-c.glb','character-male-d.glb','character-male-e.glb','character-male-f.glb']),selectedModel=ALLOWED_MODELS.has(localStorage.getItem('echo.selectedModel'))?localStorage.getItem('echo.selectedModel'):DEFAULT_MODEL,modelCache={source:null,clips:[],local:null,localAnimation:null,others:new Map(),otherSources:new Map(),ready:false};
const worldObjects = { trees: [], treeSource: null, treeLoading: false };
const TREE_MODEL_URL = './assets/models/objects/tree.glb';
// The server's tree.scale is a per-tree size factor, not a world-unit scale.
// Apply one deterministic server-generated factor uniformly on all axes.
const TREE_BASE_SCALE = 50;
const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 2.5;
const MODEL_DEPTH_SCALE = 0;
function createTreeMaterial(sourceMaterial) {
  const material = sourceMaterial?.clone?.() || new THREE.MeshStandardMaterial({ color: 0xffffff });
  material.transparent = true;
  material.opacity = 0.30;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}

function prepareTreeMaterials(root) {
  root.traverse(child => {
    if (!child.isMesh) return;
    const sourceMaterial = child.material;
    child.material = Array.isArray(sourceMaterial)
      ? sourceMaterial.map(material => createTreeMaterial(material))
      : createTreeMaterial(sourceMaterial);
    child.castShadow = true;
    child.receiveShadow = true;
  });
}
function addTreeModel(tree) {
  if (!worldObjects.treeSource || tree.root) return;
  const root = cloneSkeleton(worldObjects.treeSource);
  prepareTreeMaterials(root);
  const scaleFactor = Math.max(TREE_SCALE_MIN, Math.min(TREE_SCALE_MAX, tree.scale));
  root.scale.setScalar(TREE_BASE_SCALE * scaleFactor);
  root.rotation.y = Number.isFinite(tree.rotation) ? tree.rotation : 0;
  root.renderOrder = 0;
  tree.root = root;
  modelScene.add(root);
}
function renderWorldTrees(snapshot) {
  if (!Array.isArray(snapshot)) return;
  for (const tree of worldObjects.trees) if (tree.root) modelScene.remove(tree.root);
  worldObjects.trees = snapshot.filter(tree =>
    tree && typeof tree.id === 'string' && Number.isFinite(tree.x) &&
    Number.isFinite(tree.y) && Number.isFinite(tree.scale) &&
    tree.scale >= TREE_SCALE_MIN && tree.scale <= TREE_SCALE_MAX
  ).map(tree => ({ ...tree, root: null }));
  for (const tree of worldObjects.trees) addTreeModel(tree);
}
function loadWorldTreeModel() {
  if (worldObjects.treeLoading || worldObjects.treeSource) return;
  worldObjects.treeLoading = true;
  loader.load(TREE_MODEL_URL, gltf => {
    worldObjects.treeSource = gltf.scene;
    worldObjects.treeLoading = false;
    for (const tree of worldObjects.trees) addTreeModel(tree);
    console.log('[echo] tree model loaded');
  }, undefined, error => {
    worldObjects.treeLoading = false;
    console.error('[echo] failed to load tree GLB', error);
  });
}
function updateWorldTreePositions() {
  for (const tree of worldObjects.trees) {
    if (!tree.root) continue;
    const p = worldToScreenPrecise(tree.x, tree.y);
    tree.root.position.x = p.x - state.width / 2;
    tree.root.position.y = -(p.y - state.height / 2);
    tree.root.position.z = 0;
    tree.root.renderOrder = 10;
  }
}

function prepareModel(root,isOther=false){root.traverse(child=>{if(!child.isMesh)return;child.castShadow=false;child.receiveShadow=false;if(child.material){child.material=child.material.clone();if('emissiveIntensity' in child.material)child.material.emissiveIntensity=isOther?0.9:1.1;}});root.scale.setScalar(isOther?42:50);return root;}
function findClip(clips,names){const wanted=names.map(n=>n.toLowerCase());return clips.find(c=>wanted.some(n=>c.name.toLowerCase()===n))||clips.find(c=>wanted.some(n=>c.name.toLowerCase().includes(n)));}
function setupAnimation(root,clips,isOther=false){if(!clips?.length)return null;const mixer=new THREE.AnimationMixer(root),idle=findClip(clips,['idle','idle_01','idle-01']),run=findClip(clips,['sprint','run','running']),walk=run||findClip(clips,['walk','walk_01','walk-01']),attackMeleeRight=findClip(clips,['attack-melee-right']),attackMeleeLeft=findClip(clips,['attack-melee-left']),attackKickRight=findClip(clips,['attack-kick-right']),attackKickLeft=findClip(clips,['attack-kick-left']),die=findClip(clips,['die','death']),action=idle||clips[0];if(action)mixer.clipAction(action).play();return{mixer,idle,walk,attackMeleeRight,attackMeleeLeft,attackKickRight,attackKickLeft,die,current:action,combatUntil:0,combatAction:null,isOther};}
function startAttackAnimation(a,v='right',until=performance.now()+FIGHT_DURATION){if(!a)return;const action=v==='left'?(a.attackMeleeLeft||a.attackKickLeft||a.attackMeleeRight||a.attackKickRight):(a.attackMeleeRight||a.attackKickRight||a.attackMeleeLeft||a.attackKickLeft);if(!action)return;if(a.combatAction!==action){const current=a.current?a.mixer.clipAction(a.current):null,next=a.mixer.clipAction(action);current?.fadeOut(.08);next.reset();next.setLoop(THREE.LoopRepeat,Infinity);next.fadeIn(.08).play();a.current=action;a.combatAction=action;}a.combatUntil=until;}
function switchAnimation(a,moving,time){if(!a)return;if(time<a.combatUntil&&a.combatAction){const attack=a.mixer.clipAction(a.combatAction);if(!attack.isRunning())attack.play();return;}if(a.combatAction&&time>=a.combatUntil){a.combatAction=null;a.combatUntil=0;}const next=moving&&a.walk?a.walk:a.idle;if(!next||next===a.current)return;const current=a.mixer.clipAction(a.current),nextAction=a.mixer.clipAction(next);nextAction.reset().setLoop(THREE.LoopRepeat,Infinity).fadeIn(.15).play();current.fadeOut(.15);a.current=next;}
function loadCharacterModel(file,onLoaded,onError){const safe=ALLOWED_MODELS.has(file)?file:DEFAULT_MODEL;loader.load(`./assets/models/${safe}`,g=>onLoaded(g,safe),undefined,e=>{console.error(`[echo] failed to load character GLB: ${safe}`,e);onError?.(e,safe);});}
function createLocalModel(file){loadCharacterModel(file,(g,file2)=>{modelCache.source=g.scene;modelCache.clips=g.animations||[];const local=new THREE.Group(),visible=prepareModel(g.scene,false);local.add(visible);modelCache.local=local;modelCache.localAnimation=setupAnimation(visible,modelCache.clips,false);local.userData.animation=modelCache.localAnimation;modelScene.add(local);modelCache.ready=true;console.log(`[echo] GLB loaded: ${file2}; animations: ${modelCache.clips.length}`);console.log('[echo] available animations:',modelCache.clips.map(c=>c.name));});}createLocalModel(selectedModel);
function resize(){const r=canvas.getBoundingClientRect();state.dpr=Math.min(devicePixelRatio||1,2);state.width=Math.max(1,r.width);state.height=Math.max(1,r.height);canvas.width=Math.round(state.width*state.dpr);canvas.height=Math.round(state.height*state.dpr);ctx.setTransform(state.dpr,0,0,state.dpr,0,0);modelRenderer.setPixelRatio(state.dpr);modelRenderer.setSize(state.width,state.height,false);modelCamera.left=-state.width/2;modelCamera.right=state.width/2;modelCamera.top=state.height/2;modelCamera.bottom=-state.height/2;modelCamera.updateProjectionMatrix();}addEventListener('resize',resize,{passive:true});resize();
function setConnection(s,l){connectionDot.classList.toggle('online',s==='online');connectionDot.classList.toggle('offline',s==='offline');connectionLabel.textContent=l;}function getPlayerPosition(id){if(!id)return null;if(id===state.socket?.id)return{x:state.x,y:state.y};const p=state.others.get(id);return p?{x:p.displayX??p.targetX,y:p.displayY??p.targetY}:null;}

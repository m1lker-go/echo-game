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
const modelScene=new THREE.Scene(),modelCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);modelCamera.position.z=100;const modelRenderer=new THREE.WebGLRenderer({canvas:modelCanvas,alpha:true,antialias:true});modelRenderer.setPixelRatio(Math.min(devicePixelRatio||1,2));modelRenderer.outputColorSpace=THREE.SRGBColorSpace;modelRenderer.setClearColor(0,0);const ambientLight=new THREE.AmbientLight(0xffffff,2.0);modelScene.add(ambientLight);const keyLight=new THREE.DirectionalLight(0xffffff,3.6);keyLight.position.set(-100,57.735,0);modelScene.add(keyLight);
const loader=new GLTFLoader(),DEFAULT_MODEL='character-female-a.glb',ALLOWED_MODELS=new Set(['character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-d.glb','character-female-e.glb','character-female-f.glb','character-male-a.glb','character-male-b.glb','character-male-c.glb','character-male-d.glb','character-male-e.glb','character-male-f.glb']),selectedModel=ALLOWED_MODELS.has(localStorage.getItem('echo.selectedModel'))?localStorage.getItem('echo.selectedModel'):DEFAULT_MODEL,modelCache={source:null,clips:[],local:null,localAnimation:null,others:new Map(),otherSources:new Map(),ready:false};
const worldObjects = {
  trees: [], treeSource: null, treeLoading: false,
  waters: [], waterSources: new Map(), waterLoading: new Set(),
};
const WATER_MODEL_BASE_SCALE = 50;
const WATER_MODEL_URLS = ['./assets/models/objects/patch-water.glb', './assets/models/objects/patch-water-large.glb'];
import WATER_GEOMETRY from './water-hazard-contours.js';
function getWaterGeometry(water) { return { vertices: WATER_GEOMETRY[water.model] || WATER_GEOMETRY['patch-water-large.glb'] }; }
function getWaterScale(water) { return WATER_MODEL_BASE_SCALE * water.scale; }
function isPointInPolygon(x, y, vertices) { let inside=false; for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const [xi,yi]=vertices[i],[xj,yj]=vertices[j];const crosses=(yi>y)!==(yj>y)&&x<((xj-xi)*(y-yi))/((yj-yi)||Number.EPSILON)+xi;if(crosses)inside=!inside;const cross=(x-xi)*(yj-yi)-(y-yi)*(xj-xi);if(Math.abs(cross)<1e-7&&x>=Math.min(xi,xj)-1e-7&&x<=Math.max(xi,xj)+1e-7&&y>=Math.min(yi,yj)-1e-7&&y<=Math.max(yi,yj)+1e-7)return true;} return inside; }

const TREE_MODEL_URL = './assets/models/objects/tree.glb';
const TREE_BASE_SCALE = 50;
const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 2.5;
function createTreeMaterial(sourceMaterial) { const material=sourceMaterial?.clone?.()||new THREE.MeshStandardMaterial({color:0xffffff}); material.transparent=true;material.opacity=.30;material.depthWrite=false;material.depthTest=false;material.side=THREE.DoubleSide;material.needsUpdate=true;return material; }
function prepareTreeMaterials(root) { root.traverse(child=>{if(!child.isMesh)return;child.material=Array.isArray(child.material)?child.material.map(material=>createTreeMaterial(material)):createTreeMaterial(child.material);child.castShadow=false;child.receiveShadow=false;}); }
function addTreeModel(tree) { if(!worldObjects.treeSource||tree.root)return;const root=cloneSkeleton(worldObjects.treeSource);prepareTreeMaterials(root);const scaleFactor=Math.max(TREE_SCALE_MIN,Math.min(TREE_SCALE_MAX,tree.scale));root.scale.setScalar(TREE_BASE_SCALE*scaleFactor);root.rotation.y=Number.isFinite(tree.rotation)?tree.rotation:0;root.renderOrder=0;tree.root=root;modelScene.add(root); }
function renderWorldTrees(snapshot) { if(!Array.isArray(snapshot))return;for(const tree of worldObjects.trees)if(tree.root)modelScene.remove(tree.root);worldObjects.trees=snapshot.filter(tree=>tree&&typeof tree.id==='string'&&Number.isFinite(tree.x)&&Number.isFinite(tree.y)&&Number.isFinite(tree.scale)&&tree.scale>=TREE_SCALE_MIN&&tree.scale<=TREE_SCALE_MAX).map(tree=>({...tree,root:null}));for(const tree of worldObjects.trees)addTreeModel(tree); }
function loadWorldTreeModel() { if(worldObjects.treeLoading||worldObjects.treeSource)return;worldObjects.treeLoading=true;loader.load(TREE_MODEL_URL,gltf=>{worldObjects.treeSource=gltf.scene;worldObjects.treeLoading=false;for(const tree of worldObjects.trees)addTreeModel(tree);console.log('[echo] tree model loaded');},undefined,error=>{worldObjects.treeLoading=false;console.error('[echo] failed to load tree GLB',error);}); }
function updateWorldTreePositions() { for(const tree of worldObjects.trees){if(!tree.root)continue;const p=worldToScreenPrecise(tree.x,tree.y);tree.root.position.x=p.x-state.width/2;tree.root.position.y=-(p.y-state.height/2);tree.root.position.z=0;tree.root.renderOrder=0;} }

function prepareWaterMaterials(root) { root.traverse(child=>{if(!child.isMesh)return;child.material=Array.isArray(child.material)?child.material.map(material=>createWaterMaterial(material)):createWaterMaterial(child.material);child.castShadow=false;child.receiveShadow=false;child.renderOrder=-1;}); }
function createWaterMaterial(sourceMaterial) {
  // Keep the puddle visibly rendered with the existing transparent WebGL setup.
  // MeshStandardMaterial is intentional here: MeshPhysicalMaterial made the
  // very thin GLB surface too dependent on an environment map and effectively invisible.
  const material = new THREE.MeshStandardMaterial({
    color: 0x71888d,
    metalness: 0.16,
    roughness: 0.22,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.needsUpdate = true;
  return material;
}
function createWaterHighlights(water, surface) {
  const scale=getWaterScale(water),group=new THREE.Group();group.name='water-highlight-layer';group.position.z=0.12;
  const specs=[{x:-.20,y:.18,w:.38,h:.025,opacity:.28,phase:.2},{x:.13,y:.02,w:.28,h:.018,opacity:.22,phase:2},{x:-.04,y:-.24,w:.23,h:.014,opacity:.18,phase:4.1}];
  for(const spec of specs){const geometry=new THREE.PlaneGeometry(scale*spec.w,scale*spec.h);const material=new THREE.MeshBasicMaterial({color:0xe4f1f4,transparent:true,opacity:spec.opacity,depthWrite:false,depthTest:false,side:THREE.DoubleSide,toneMapped:false});const glint=new THREE.Mesh(geometry,material);glint.position.set(scale*spec.x,scale*spec.y,Math.random()*.005);glint.rotation.set(-Math.PI/2,-.16+Math.random()*.32,0);glint.renderOrder=-.8;glint.userData.waterGlint=spec;glint.userData.baseX=glint.position.x;group.add(glint);}surface.add(group);return group;
}
function updateWaterHighlights(time) { for(const water of worldObjects.waters){if(!water.highlightLayer)continue;const phaseBase=time*.00022+(Number(water.rotation)||0);for(const glint of water.highlightLayer.children){const spec=glint.userData.waterGlint;glint.material.opacity=spec.opacity*(.62+.38*Math.sin(phaseBase+spec.phase));glint.position.x=glint.userData.baseX+Math.sin(phaseBase+spec.phase)*1.2;}} }
function addWaterModel(water) { const source=worldObjects.waterSources.get(water.model);if(!source||water.root)return;const surface=cloneSkeleton(source);prepareWaterMaterials(surface);surface.rotation.set(Math.PI/2,0,0);surface.scale.setScalar(getWaterScale(water));water.highlightLayer=createWaterHighlights(water,surface);surface.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(surface),center=bounds.getCenter(new THREE.Vector3());surface.position.x-=center.x;surface.position.y-=center.y;surface.position.z-=bounds.min.z;const holder=new THREE.Group();holder.rotation.z=(Number.isFinite(water.rotation)?water.rotation:0)+Math.PI/2;holder.position.z=-1;holder.add(surface);holder.traverse(child=>{if(!child.isMesh)return;child.renderOrder=-1;if(child.material){child.material.depthTest=false;child.material.depthWrite=false;child.needsUpdate=true;child.material.needsUpdate=true;}});holder.renderOrder=-1;water.root=holder;modelScene.add(holder); }
function renderWorldWaters(snapshot) { if(!Array.isArray(snapshot))return;for(const water of worldObjects.waters)if(water.root)modelScene.remove(water.root);worldObjects.waters=snapshot.filter(water=>water&&typeof water.id==='string'&&(water.model==='patch-water.glb'||water.model==='patch-water-large.glb')&&Number.isFinite(water.x)&&Number.isFinite(water.y)&&Number.isFinite(water.scale)&&water.scale>0&&Number.isFinite(water.collisionRadius)&&water.collisionRadius>0).map(water=>({...water,root:null}));for(const water of worldObjects.waters)addWaterModel(water); }
function loadWorldWaterModels() { for(const url of WATER_MODEL_URLS){const file=url.split('/').pop();if(worldObjects.waterSources.has(file)||worldObjects.waterLoading.has(file))continue;worldObjects.waterLoading.add(file);loader.load(url,gltf=>{worldObjects.waterSources.set(file,gltf.scene);worldObjects.waterLoading.delete(file);for(const water of worldObjects.waters)if(water.model===file)addWaterModel(water);console.log(`[echo] water model loaded: ${file}`);},undefined,error=>{worldObjects.waterLoading.delete(file);console.error(`[echo] failed to load water model: ${file}`,error);});} }
function updateWorldWaterPositions() { for(const water of worldObjects.waters){if(!water.root)continue;const p=worldToScreenPrecise(water.x,water.y);water.root.position.x=p.x-state.width/2;water.root.position.y=-(p.y-state.height/2);water.root.position.z=-1;water.root.renderOrder=-1;} }
function isPlayerInWater(x=state.x,y=state.y) { return worldObjects.waters.some(water=>{const vertices=getWaterGeometry(water).vertices,angle=(Number.isFinite(water.rotation)?water.rotation:0)+Math.PI/2,dx=x-water.x,dy=y-water.y,localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle),scale=getWaterScale(water);return isPointInPolygon(localX/scale,localY/scale,vertices);}); }

function prepareModel(root,isOther=false){root.traverse(child=>{if(!child.isMesh)return;child.castShadow=false;child.receiveShadow=false;if(child.material){child.material=child.material.clone();child.material.transparent=true;child.material.depthWrite=false;child.material.depthTest=false;child.material.opacity=isOther?.95:1;}});}
function fitModelToCamera(root){const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),max=Math.max(size.x,size.y,size.z)||1;modelCamera.left=-max*.65;modelCamera.right=max*.65;modelCamera.top=max*.65;modelCamera.bottom=-max*.65;modelCamera.updateProjectionMatrix();}
function updateModelCamera(){modelCamera.position.set(0,0,100);modelCamera.lookAt(0,0,0);}

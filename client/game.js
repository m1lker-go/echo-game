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
const modelScene=new THREE.Scene(),modelCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);modelCamera.position.z=100;const modelRenderer=new THREE.WebGLRenderer({canvas:modelCanvas,alpha:true,antialias:true});modelRenderer.setPixelRatio(Math.min(devicePixelRatio||1,2));modelRenderer.outputColorSpace=THREE.SRGBColorSpace;modelRenderer.setClearColor(0,0);const ambientLight=new THREE.AmbientLight(0xffffff,2.0);modelScene.add(ambientLight);const keyLight=new THREE.DirectionalLight(0xffffff,5.0);keyLight.position.set(-100,57.735,0);modelScene.add(keyLight);
const loader=new GLTFLoader(),DEFAULT_MODEL='character-female-a.glb',ALLOWED_MODELS=new Set(['character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-d.glb','character-female-e.glb','character-female-f.glb','character-male-a.glb','character-male-b.glb','character-male-c.glb','character-male-d.glb','character-male-e.glb','character-male-f.glb']),selectedModel=ALLOWED_MODELS.has(localStorage.getItem('echo.selectedModel'))?localStorage.getItem('echo.selectedModel'):DEFAULT_MODEL,modelCache={source:null,clips:[],local:null,localAnimation:null,others:new Map(),otherSources:new Map(),ready:false};
const worldObjects = { trees: [], treeSource: null, treeLoading: false };
const TREE_MODEL_URL = './assets/models/objects/tree.glb';
const TREE_BASE_SCALE = 50;
const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 2.5;
function createTreeMaterial(sourceMaterial) {
  const material = sourceMaterial?.clone?.() || new THREE.MeshStandardMaterial({ color: 0xffffff });
  material.transparent = true;
  material.opacity = 0.30;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}
function prepareTreeMaterials(root) {
  root.traverse(child => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material)
      ? child.material.map(material => createTreeMaterial(material))
      : createTreeMaterial(child.material);
    child.castShadow = false;
    child.receiveShadow = false;
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
    tree.root.renderOrder = 0;
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
function beginCombatVisual(a,b,fid){const now=performance.now(),local=a===state.socket?.id||b===state.socket?.id,oid=a===state.socket?.id?b:a===state.socket?.id?a:null;if(!local){const x=state.others.get(a),y=state.others.get(b);if(x){x.combatUntil=now+FIGHT_DURATION;x.combatFightId=fid;x.fightingWith=b;}if(y){y.combatUntil=now+FIGHT_DURATION;y.combatFightId=fid;y.fightingWith=a;}return;}state.combatUntil=now+FIGHT_DURATION;state.combatOpponentId=oid;state.combatFightId=fid;state.vx=0;state.vy=0;const o=state.others.get(oid);if(o)o.combatUntil=now+FIGHT_DURATION;}
function showDefeat(){state.defeated=true;state.combatUntil=0;state.combatOpponentId=null;state.vx=0;state.vy=0;energyText.textContent='0';defeatScreen.hidden=false;}function startNewGame(){const u=new URL(location.href);u.searchParams.set('play','1');location.href=u.toString();}defeatReplay?.addEventListener('click',startNewGame);defeatMenu?.addEventListener('click',returnToMenu);
function connectSocket(){if(!window.io){setConnection('offline','режим без сервера');return;}try{state.socket=window.io(window.ECHO_SERVER_URL||location.origin,{path:'/echo/socket.io/',transports:['websocket','polling'],reconnection:true,timeout:5000,auth:{skin:selectedModel,activityProfileId}});window.echoSocket=state.socket;state.socket.on('echo:world',world=>{if(world&&Array.isArray(world.trees))renderWorldTrees(world.trees);});state.socket.on('connect',()=>{setConnection('online','сервер подключён');state.socket.emit('echo:hello',{version:1,skin:selectedModel,activityProfileId});lastDailyPing=-15000;sendDailyActivityPing();});state.socket.on('disconnect',()=>setConnection('offline','нет соединения'));state.socket.on('connect_error',()=>setConnection('offline','ожидаем сервер'));state.socket.on('echo:fight',({fightId,playerA,playerB})=>beginCombatVisual(playerA,playerB,fightId));state.socket.on('echo:combatResult',({fightId,result,energy})=>{if(fightId!==state.combatFightId)return;state.combatUntil=0;state.combatOpponentId=null;state.combatFightId=null;if(result==='lose'){state.energy=0;showDefeat();}else{state.energy=Number.isFinite(energy)?energy:state.energy;energyText.textContent=String(state.energy);}});state.socket.on('echo:players',players=>{if(!Array.isArray(players))return;const now=performance.now(),next=new Map();for(const p of players){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;if(p.id===state.socket.id){if(Number.isFinite(p.energy))state.energy=Math.max(0,Math.round(p.energy));continue;}const old=state.others.get(p.id),skin=ALLOWED_MODELS.has(p.skin)?p.skin:DEFAULT_MODEL,t={...p,skin,previousX:old?.targetX??p.x,previousY:old?.targetY??p.y,targetX:p.x,targetY:p.y,previousSnapshotAt:old?.snapshotAt??now-80,snapshotAt:now,displayX:old?.displayX??p.x,displayY:old?.displayY??p.y,vx:Number.isFinite(p.vx)?p.vx:0,vy:Number.isFinite(p.vy)?p.vy:0,combatUntil:old?.combatUntil??(p.fightingWith?now+FIGHT_DURATION:0),combatFightId:old?.combatFightId??p.fightId??null};if(!old){t.previousSnapshotAt=now-120;t.previousX=p.x;t.previousY=p.y;}next.set(p.id,t);}state.others=next;state.lastSnapshotAt=now;});}catch{setConnection('offline','режим без сервера');}}connectSocket();
let lastDailyPing = 0;
function sendDailyActivityPing(now = performance.now()) {
 if (!state.socket?.connected || document.hidden || now - lastDailyPing < 15000) return;
 lastDailyPing = now;
 state.socket.emit('echo:dailyPing', { activityProfileId });
}
document.addEventListener('visibilitychange', () => {
 if (!state.socket?.connected) return;
 if (document.hidden) {
   state.socket.emit('echo:dailyPing', { activityProfileId, active: false });
 } else {
   lastDailyPing = -15000;
   sendDailyActivityPing();
 }
});
function returnToMenu(){const u=new URL(location.href);u.searchParams.delete('play');location.href=u.toString();}gameExitButton?.addEventListener('click',returnToMenu);
function isoProject(x,y){return{x:(x-y)*ISO.x,y:(x+y)*ISO.y};}function drawIsoLine(a,b){const pa=isoProject(a.x-state.cameraX,a.y-state.cameraY),pb=isoProject(b.x-state.cameraX,b.y-state.cameraY);ctx.moveTo(Math.round(state.width/2+pa.x)+.5,Math.round(state.height/2+pa.y)+.5);ctx.lineTo(Math.round(state.width/2+pb.x)+.5,Math.round(state.height/2+pb.y)+.5);}function worldToScreen(x,y){const p=isoProject(x,y),c=isoProject(state.cameraX,state.cameraY);return{x:Math.round(state.width/2+p.x-c.x),y:Math.round(state.height/2+p.y-c.y)}}function worldToScreenPrecise(x,y){const p=isoProject(x,y),c=isoProject(state.cameraX,state.cameraY);return{x:state.width/2+p.x-c.x,y:state.height/2+p.y-c.y};}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function drawGrid(){ctx.clearRect(0,0,state.width,state.height);const step=WORLD.spacing*2;const range=12;ctx.save();ctx.strokeStyle='rgba(66,93,118,.20)';ctx.lineWidth=1;for(let i=-range;i<=range;i++){ctx.beginPath();drawIsoLine({x:-range*step,y:i*step},{x:range*step,y:i*step});ctx.stroke();ctx.beginPath();drawIsoLine({x:i*step,y:-range*step},{x:i*step,y:range*step});ctx.stroke();}ctx.restore();}
function updateCamera(){state.cameraX=state.x;state.cameraY=state.y;}
function setLocalPosition(){if(!modelCache.local)return;const p=worldToScreenPrecise(state.x,state.y);modelCache.local.position.x=p.x-state.width/2;modelCache.local.position.y=-(p.y-state.height/2);modelCache.local.position.z=0;modelCache.local.renderOrder=0;}
function updateOtherModels(){const now=performance.now();for(const [id,p] of state.others){if(!p.model)continue;const t=clamp((now-p.snapshotAt)/120,0,1),x=p.previousX+(p.targetX-p.previousX)*t,y=p.previousY+(p.targetY-p.previousY)*t,s=worldToScreenPrecise(x,y);p.model.position.x=s.x-state.width/2;p.model.position.y=-(s.y-state.height/2);p.model.position.z=0;p.model.renderOrder=0;if(p.animation){const moving=Math.abs(p.vx)+Math.abs(p.vy)>1;p.animation.mixer.update(Math.min(.05,state.lastTime?((now-state.lastTime)/1000):.016));switchAnimation(p.animation,moving,now);}}}
function ensureOtherModel(p){if(p.model||p.loading)return;p.loading=true;loadCharacterModel(p.skin,(g)=>{const root=new THREE.Group(),visible=prepareModel(g.scene,true);root.add(visible);p.model=root;p.animation=setupAnimation(visible,g.animations||[],true);root.userData.animation=p.animation;modelScene.add(root);p.loading=false;},()=>{p.loading=false;});}
function updateModels(){if(!modelCache.ready)return;setLocalPosition();for(const p of state.others)ensureOtherModel(p);updateOtherModels();updateWorldTreePositions();}
function renderModels(){modelRenderer.render(modelScene,modelCamera);}
function drawVignette(){const g=ctx.createRadialGradient(state.width/2,state.height/2,Math.min(state.width,state.height)*.30,state.width/2,state.height/2,Math.max(state.width,state.height)*.70);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,.82)');ctx.fillStyle=g;ctx.fillRect(0,0,state.width,state.height);}
function triggerBoost(){const now=performance.now();if(now<state.boostCooldownUntil||state.defeated||state.combatUntil>now)return;state.boostUntil=now+700;state.boostCooldownUntil=now+3000;boostButton.classList.remove('cooldown','ready');boostButton.classList.add('active');setTimeout(()=>boostButton.classList.remove('active'),700);const countdown=document.createElement('span');countdown.className='ability-cooldown';countdown.setAttribute('aria-hidden','true');boostButton.appendChild(countdown);boostButton.classList.add('cooldown');const phases=[{value:'2',start:0,duration:850},{value:'1',start:1150,duration:1550}];let last=-1;const tick=()=>{const elapsed=performance.now()-now;if(elapsed>=3000){countdown.remove();boostButton.classList.remove('cooldown');boostButton.classList.add('ready');setTimeout(()=>boostButton.classList.remove('ready'),450);return;}const i=phases.findIndex(p=>elapsed>=p.start&&elapsed<p.start+p.duration);if(i!==last){last=i;countdown.classList.remove('countdown-pop');if(i>=0){countdown.textContent=phases[i].value;countdown.style.animationDuration=`${phases[i].duration}ms`;void countdown.offsetWidth;countdown.classList.add('countdown-pop')}else countdown.textContent='';}requestAnimationFrame(tick)};tick();}
function gameLoop(time){const dt=Math.min(.05,(time-state.lastTime||16)/1000);state.lastTime=time;updatePlayerMovement(state,dt,time,ISO,worldObjects.trees);updateCamera();drawGrid();updateModels();renderModels();drawVignette();sendDailyActivityPing(time);requestAnimationFrame(gameLoop);}requestAnimationFrame(gameLoop);
function bindKeys(){addEventListener('keydown',e=>{state.keys.add(e.code);if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});addEventListener('keyup',e=>state.keys.delete(e.code));}
bindKeys();bindPlayerControls({state,joystick,stick,boostButton,triggerBoost});
loadWorldTreeModel();

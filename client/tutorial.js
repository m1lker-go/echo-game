// ECHO tutorial preview: a standalone offline training corridor.
// No Socket.IO connection, profile writes, advertising, or real pack grants.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacterLoaderSelector } from './character-textures.js';
import { updateCharacterFacing } from './character-facing.js';
import { createPlayerLabels, measurePlayerLabelBounds } from './player-labels.js?v=echo-labels-up-1-voice-1';
import { bindPlayerControls, updatePlayerMovement } from './player-controls.js?v=echo-energy-mobility-1';
import { energyJumpDistance, energySpeedMultiplier, energySizeMultiplier } from './energy-balance.js';
import { getWorldViewport } from './viewport-scale.js?v=echo-world-zoom-2';
import {
  TILE, WIDTH, LENGTH, WATER_START, WATER_END, STAGE_GATES, STAGE_DESCRIPTIONS,
  FOOD_PLACEMENTS, worldFromTrack, trackFromWorld, boundToCorridor,
  shuffledEnemies, outcome
} from './tutorial-logic.js';

const ISO = {x:0.8660254,y:0.5};
const root=document.querySelector('#game');
const ground=document.querySelector('#tutorial-ground');
const groundCtx=ground.getContext('2d',{alpha:true});
const models=document.querySelector('#tutorial-models');
const labels=createPlayerLabels(document.querySelector('#player-labels'));
const taskStep=document.querySelector('#tutorial-step');
const taskTitle=document.querySelector('#tutorial-task-title');
const taskHint=document.querySelector('#tutorial-task-hint');
const taskProgress=document.querySelector('#tutorial-progress');
const taskBar=document.querySelector('#tutorial-progress-bar');
const energyNode=document.querySelector('#tutorial-energy');
const toast=document.querySelector('#tutorial-toast');
const toastTitle=document.querySelector('#tutorial-toast-title');
const toastText=document.querySelector('#tutorial-toast-text');
const boostButton=document.querySelector('#boost');
const jumpButton=document.querySelector('#jump');
const dialog=document.querySelector('#tutorial-dialog');
const dialogButton=document.querySelector('#tutorial-dialog-button');
const dialogIcon=document.querySelector('#tutorial-dialog-icon');
const dialogTitle=document.querySelector('#tutorial-dialog-title');
const dialogText=document.querySelector('#tutorial-dialog-text');
const dialogPacks=document.querySelector('#tutorial-dialog-packs');
const dialogCaption=document.querySelector('#tutorial-dialog-caption');

const t0=worldFromTrack(0,0);
const state={
  ...t0, vx:0,vy:0,energy:0,stage:0,keys:new Set(),inputX:0,inputY:0,
  boostUntil:0,boostCooldownUntil:0,jumpUntil:0,jumpStart:0,jumpFrom:0,jumpTo:0,
  boostUsed:false,jumpUsed:false,kills:0,lastWaterDamage:0,locked:false,
  view:{width:600,height:350,scale:1},dpr:1,lastTime:0,toastTimer:0,gateToastTime:0,
  food:FOOD_PLACEMENTS.map(([p,l],i)=>({id:i,progress:p,lateral:l,taken:false})),
  bots:[],models:new Map()
};

function createBots(){
  return shuffledEnemies().map((energy,i)=>({
    id:'training-bot-'+i,energy,progress:1122,lateral:[-90,0,90][i],
    skin:['character-male-a.glb','character-female-b.glb','character-male-c.glb'][i],
    name:'Тренировочный бот',alive:true
  }));
}
state.bots=createBots();

function showToast(title,message,duration=3000){
  toastTitle.textContent=title;
  toastText.textContent=message;
  toast.hidden=false;
  clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>{toast.hidden=true;},duration);
}

function showStage(){
  root.dataset.tutorialStage=String(state.stage);
  const desc=STAGE_DESCRIPTIONS[state.stage];
  taskStep.textContent='ШАГ '+(state.stage+1)+' / 5';
  taskTitle.textContent=desc.title;
  taskHint.textContent=desc.tip;
  boostButton.disabled=state.stage<2 || state.stage>3;
  jumpButton.disabled=state.stage!==3;
  state.locked=false;
  updateHud();
  showToast(desc.title,desc.tip,3600);
}

function getTrack(){
  return trackFromWorld(state.x,state.y);
}
function updateHud(){
  const {progress}=getTrack();
  const stage=state.stage;
  let current=stage===0?Math.floor(Math.min(126,progress)):
    stage===1?Math.min(10,state.energy):
    stage===2?state.boostUsed && progress>=560?1:0:
    stage===3?state.jumpUsed?1:0:state.kills;
  const max=STAGE_DESCRIPTIONS[stage].target;
  taskProgress.textContent=current+' / '+max;
  taskBar.style.width=(Math.min(1,current/max)*100)+'%';
  energyNode.textContent=String(state.energy);
}

function enterStage(index){
  state.stage=index;
  showStage();
}

function boundPlayer(){
  const p=boundToCorridor(state.x,state.y,STAGE_GATES[state.stage]);
  const before=getTrack();
  state.x=p.x;state.y=p.y;
  const after=getTrack();
  if(before.progress>after.progress+3 || Math.abs(before.lateral-after.lateral)>3){
    if(before.progress>after.progress+3 && performance.now()-state.gateToastTime>2500){
      state.gateToastTime=performance.now();
      showToast('ПРОЙДИ ЗАДАНИЕ','Следующая часть дороги откроется после выполнения текущего задания.',2000);
    }
  }
}

function collectEnergy(){
  if(state.stage!==1)return;
  const t=getTrack();
  for(const f of state.food){
    if(!f.taken && Math.hypot(f.progress-t.progress,f.lateral-t.lateral)<39){
      f.taken=true;state.energy+=1;
      if(state.energy<10)showToast('ЭНЕРГИЯ +1','Собрано '+state.energy+' из 10',850);
    }
  }
  if(state.energy===10)enterStage(2);
}

function triggerBoost(){
  if(state.stage!==2 || state.locked)return;
  const now=performance.now();
  if(now<state.boostCooldownUntil)return;
  state.boostUsed=true;
  state.boostUntil=now+700;
  state.boostCooldownUntil=now+3000;
  showToast('РЫВОК!','Отлично! Теперь доберись до светящейся черты.',1700);
}

function triggerJump(){
  if(state.stage!==3 || state.locked || performance.now()<state.jumpUntil)return;
  const from=getTrack();
  if(from.progress<625 || from.progress>=WATER_START-12){
    showToast('ПОДОЙДИ К БЕРЕГУ','Для прыжка остановись перед водой, на светящейся отметке.',2200);
    return;
  }
  const reach=energyJumpDistance(state.energy,420);
  const to=Math.min(STAGE_GATES[3]-12,from.progress+reach);
  if(to<WATER_END+16)return;
  state.jumpStart=performance.now();
  state.jumpUntil=state.jumpStart+240;
  state.jumpFrom=from.progress;
  state.jumpTo=to;
  state.jumpLateral=from.lateral;
  state.vx=0;state.vy=0;
  showToast('ПРЫЖОК!','Перелетаем воду — энергия остаётся с тобой.',1900);
}

// bindPlayerControls owns boost pointer events, and this page owns the jump.
jumpButton.addEventListener('pointerdown',triggerJump);
window.addEventListener('keydown',event=>{
  if(event.code==='KeyJ' || event.code==='ShiftLeft' || event.code==='ShiftRight'){
    if(!event.repeat){triggerJump();}event.preventDefault();
  }
});
bindPlayerControls({
  state,joystick:document.querySelector('#joystick'),stick:document.querySelector('#stick'),
  boostButton,triggerBoost
});

function openDialog(kind){
  state.locked=true;
  dialog.hidden=false;
  const win=kind==='win';
  dialogIcon.textContent=win?'✦':'×';
  dialogTitle.textContent=win?'ПОЗДРАВЛЯЕМ!':'ВЫ ПРОИГРАЛИ';
  dialogText.textContent=win?
    'Ты освоил движение, энергию, рывок, прыжок и бой. В полноценном обучении награда — 3 обычных пака!':
    'Противник оказался сильнее. Нужно победить всех в порядке 9 → 12 → 15.';
  dialogPacks.hidden=!win;
  dialogCaption.hidden=!win;
  dialogButton.textContent=win?'ВЕРНУТЬСЯ В МЕНЮ':'ПОПРОБОВАТЬ ЕЩЁ РАЗ';
  dialogButton.onclick=win?()=>{window.location.href='./';}:resetFinalChallenge;
}

function resetFinalChallenge(){
  dialog.hidden=true;
  state.locked=false;
  state.energy=10;
  state.kills=0;
  state.bots=createBots();
  // All enemies receive newly shuffled positions; reset only this last stage.
  for(const [id,item] of state.models)if(id!=='local'){
    item.root.visible=false;item.scene.remove(item.root);state.models.delete(id);
  }
  for(const bot of state.bots)loadHero(bot.id,bot.skin);
  const p=worldFromTrack(1000,0);
  state.x=p.x;state.y=p.y;state.vx=0;state.vy=0;
  state.inputX=0;state.inputY=0;state.keys.clear();
  document.querySelector('#stick').style.transform='translate(0,0)';
  showStage();
}

function tryCombat(){
  if(state.stage!==4 || state.locked)return;
  const our=getTrack();
  for(const bot of state.bots){
    if(!bot.alive || Math.hypot(our.progress-bot.progress,our.lateral-bot.lateral)>63)continue;
    state.locked=true;
    state.vx=0;state.vy=0;
    const battle=outcome(state.energy,bot.energy);
    const heroModel=state.models.get('local');
    heroModel?.attack?.();
    showToast('СРАЖЕНИЕ',state.energy+' против '+bot.energy,750);
    setTimeout(()=>{
      if(!battle.win){
        state.energy=0;updateHud();openDialog('lose');return;
      }
      bot.alive=false;
      state.energy=battle.energy;
      state.kills++;
      const enemyModel=state.models.get(bot.id);
      if(enemyModel)enemyModel.root.visible=false;
      updateHud();
      if(state.kills===3){openDialog('win');return;}
      state.locked=false;
      showToast('ПОБЕДА! +'+battle.gained+' ЭНЕРГИИ',
        'У тебя '+state.energy+' энергии. Осталось врагов: '+(3-state.kills),2400);
    },860);
    break;
  }
}

function update(dt,now){
  if(state.locked)return;
  if(now<state.jumpUntil){
    const ratio=Math.min(1,(now-state.jumpStart)/240);
    const pos=worldFromTrack(state.jumpFrom+(state.jumpTo-state.jumpFrom)*ratio,state.jumpLateral);
    state.x=pos.x;state.y=pos.y;
  }else if(state.jumpUntil){
    const p=worldFromTrack(state.jumpTo,state.jumpLateral);
    state.x=p.x;state.y=p.y;
    state.jumpUntil=0;state.jumpStart=0;
    if(state.stage===3 && state.jumpFrom<WATER_START && state.jumpTo>WATER_END){
      state.jumpUsed=true;state.energy=10;enterStage(4);
    }
  }else{
    const waterPos=getTrack().progress;
    state.speedMultiplier=(waterPos>=WATER_START && waterPos<=WATER_END)?0.5:1;
    state.energyMobilityMultiplier=energySpeedMultiplier(state.energy);
    updatePlayerMovement(state,dt,now,ISO,[]);
    boundPlayer();
  }
  const p=getTrack();
  if(state.stage===0 && p.progress>=126)enterStage(1);
  if(state.stage===1)collectEnergy();
  if(state.stage===2 && state.boostUsed && p.progress>=560)enterStage(3);
  if(state.stage===3 && !state.jumpUntil && p.progress>=WATER_START && p.progress<=WATER_END && now-state.lastWaterDamage>550){
    state.energy=Math.max(0,state.energy-1);
    state.lastWaterDamage=now;
    showToast('ОПАСНО! ВОДА','Вода забирает энергию! Вернись на берег и используй прыжок.',1200);
  }
  if(state.stage===3 && (p.progress>WATER_END+4 || state.energy===0)){
    const shore=worldFromTrack(660,0);
    state.x=shore.x;state.y=shore.y;state.vx=0;state.vy=0;state.energy=10;
    showToast('ПОПРОБУЙ ЕЩЁ РАЗ','Воду нужно именно перепрыгнуть. Нажми «ПРЫЖОК» перед берегом.',2900);
  }
  tryCombat();
  updateHud();
}

const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);
camera.position.z=100;
scene.add(new THREE.AmbientLight(0x657e93,3.7));
const sun=new THREE.DirectionalLight(0xb9e7ff,3.5);
sun.position.set(-80,70,60);scene.add(sun);
const isMobile=/Android|iPhone|iPad/i.test(navigator.userAgent);
const renderer=new THREE.WebGLRenderer({canvas:models,alpha:true,antialias:!isMobile,powerPreference:isMobile?'low-power':'default'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0x000000,0);
const gltfLoader=new GLTFLoader();
const characterLoader=createCharacterLoaderSelector(THREE,GLTFLoader,gltfLoader);
const validSkin=/^character-(?:male-[a-f]|female-[a-f]|ghost|keeper|skeleton|zombie|human|orc)\.glb$/;
const selected=localStorage.getItem('echo.selectedModel');
const localSkin=validSkin.test(selected||'')?selected:'character-female-a.glb';
const nickname=localStorage.getItem('echo.playerName')||'Герой';

function findAnimation(clips,pattern){return clips.find(c=>pattern.test(c.name));}
function loadHero(id,skin){
  const parent=new THREE.Group();
  scene.add(parent);
  const actor={root:parent,scene,mixer:null,idle:null,run:null,attackClip:null,current:null,attackUntil:0,attack(){
    if(!actor.attackClip || !actor.mixer)return;
    const next=actor.mixer.clipAction(actor.attackClip);
    next.reset().play();
    actor.attackUntil=performance.now()+850;
    actor.current=actor.attackClip;
  }};
  state.models.set(id,actor);
  characterLoader(skin).load('./assets/models/'+skin,g=>{
    if(state.models.get(id)!==actor)return;
    const mesh=g.scene;mesh.scale.setScalar(50);
    mesh.traverse(child=>{
      if(!child.isMesh)return;
      child.castShadow=false;child.receiveShadow=false;
      if(child.material)child.material=child.material.clone();
    });
    parent.add(mesh);
    parent.userData.labelBounds=measurePlayerLabelBounds(THREE,parent);
    const clips=g.animations||[];
    actor.idle=findAnimation(clips,/idle/i)||clips[0]||null;
    actor.run=findAnimation(clips,/run|sprint|walk/i)||actor.idle;
    actor.attackClip=findAnimation(clips,/attack-melee|attack-kick/i)||null;
    if(actor.idle){
      actor.mixer=new THREE.AnimationMixer(mesh);
      actor.mixer.clipAction(actor.idle).play();
      actor.current=actor.idle;
    }
  },undefined,error=>{
    console.warn('[ECHO tutorial] Hero model unavailable:',skin,error);
  });
}
loadHero('local',localSkin);
for(const bot of state.bots)loadHero(bot.id,bot.skin);

function resize(){
  const w=Math.max(1,ground.clientWidth),h=Math.max(1,ground.clientHeight);
  state.view=getWorldViewport(w,h);
  state.dpr=Math.min(isMobile?1.5:2,window.devicePixelRatio||1);
  ground.width=Math.round(w*state.dpr);
  ground.height=Math.round(h*state.dpr);
  groundCtx.setTransform(state.dpr*state.view.scale,0,0,state.dpr*state.view.scale,0,0);
  renderer.setPixelRatio(state.dpr);
  renderer.setSize(w,h,false);
  camera.left=-state.view.width/2;camera.right=state.view.width/2;
  camera.top=state.view.height/2;camera.bottom=-state.view.height/2;
  camera.updateProjectionMatrix();
  labels.resize(w,h,state.dpr,state.view.scale);
}
window.addEventListener('resize',resize,{passive:true});
resize();

function screenPosition(progress,lateral){
  const w=worldFromTrack(progress,lateral);
  const dx=w.x-state.camX,dy=w.y-state.camY;
  return {x:state.view.width/2+(dx-dy)*ISO.x,y:state.view.height/2+(dx+dy)*ISO.y};
}
function poly(coords,fill,stroke,lineWidth=1){
  groundCtx.beginPath();
  coords.forEach(([p,l],index)=>{
    const s=screenPosition(p,l);
    if(!index)groundCtx.moveTo(s.x,s.y);
    else groundCtx.lineTo(s.x,s.y);
  });
  groundCtx.closePath();
  if(fill){groundCtx.fillStyle=fill;groundCtx.fill();}
  if(stroke){groundCtx.lineWidth=lineWidth;groundCtx.strokeStyle=stroke;groundCtx.stroke();}
}
function line(p1,l1,p2,l2,color,width=1){
  const a=screenPosition(p1,l1),b=screenPosition(p2,l2);
  groundCtx.beginPath();groundCtx.moveTo(a.x,a.y);groundCtx.lineTo(b.x,b.y);
  groundCtx.lineWidth=width;groundCtx.strokeStyle=color;groundCtx.stroke();
}

function drawGround(now){
  const ctx=groundCtx,{width,height}=state.view;
  ctx.clearRect(0,0,width,height);
  const grad=ctx.createLinearGradient(0,0,0,height);
  grad.addColorStop(0,'#102b3c');grad.addColorStop(1,'#091622');
  poly([[0,-WIDTH/2],[LENGTH,-WIDTH/2],[LENGTH,WIDTH/2],[0,WIDTH/2]],grad,'#5aadd0',2.4);
  const visible=getTrack().progress;
  for(let p=Math.max(0,Math.floor((visible-400)/TILE)*TILE);p<=Math.min(LENGTH,visible+600);p+=TILE){
    line(p,-WIDTH/2,p,WIDTH/2,'rgba(157,217,247,.095)',1);
  }
  for(const l of [-WIDTH/2+TILE,-WIDTH/2+TILE*2])
    line(0,l,LENGTH,l,'rgba(157,217,247,.11)',1);
  for(const edge of [-WIDTH/2,WIDTH/2]){
    line(0,edge,LENGTH,edge,'rgba(80,191,239,.65)',2);
    for(let p=0;p<LENGTH;p+=TILE){
      const s=screenPosition(p,edge);
      ctx.fillStyle='rgba(118,222,252,.65)';
      ctx.fillRect(s.x-2,s.y-2,4,4);
    }
  }
  // Unlocked objective markers and locked gates are part of the arena itself.
  const marks=[126,410,560,645];
  const goal=marks[state.stage];
  if(Number.isFinite(goal)){
    const a=0.46+Math.sin(now*.004)*.22;
    line(goal,-105,goal,105,'rgba(122,242,255,'+a+')',7);
    line(goal,-105,goal,105,'#bbf3ff',1.5);
  }
  if(state.stage<4){
    const gate=STAGE_GATES[state.stage];
    line(gate,-WIDTH/2,gate,WIDTH/2,'rgba(238,243,255,.55)',3);
  }
  // One continuous water obstacle across all three 84-unit tiles.
  const water=ctx.createLinearGradient(0,0,0,height);
  water.addColorStop(0,'rgba(22,125,199,.78)');water.addColorStop(1,'rgba(6,65,128,.86)');
  poly([[WATER_START,-WIDTH/2],[WATER_END,-WIDTH/2],[WATER_END,WIDTH/2],[WATER_START,WIDTH/2]],water,'rgba(127,212,247,.75)',2);
  for(let j=0;j<6;j++){
    const p=WATER_START+18+j*17;
    const shimmer=(now*.018+j*11)%58;
    line(p,-105+shimmer/3,p,70+shimmer/3,'rgba(132,225,255,'+(0.1+j*.05)+')',1.5);
  }
  // Visible jump launch line just before the water.
  line(666,-105,666,105,'rgba(157,243,255,.8)',2);
  // Small white, pulsing food points match the primary arena mechanic.
  if(state.stage<=1){
    state.food.forEach(f=>{
      if(f.taken)return;
      const v=screenPosition(f.progress,f.lateral);
      const radius=3.8+Math.sin(now*.007+f.id)*.8;
      const glow=ctx.createRadialGradient(v.x,v.y,0,v.x,v.y,radius*5);
      glow.addColorStop(0,'rgba(239,252,255,.8)');
      glow.addColorStop(.25,'rgba(176,235,255,.3)');
      glow.addColorStop(1,'rgba(104,219,255,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(v.x,v.y,radius*5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#f6fdff';ctx.beginPath();ctx.arc(v.x,v.y,radius,0,Math.PI*2);ctx.fill();
    });
  }
}

function updateModels(dt,now){
  const p=getTrack();
  const all=[{id:'local',progress:p.progress,lateral:p.lateral,energy:state.energy,
    vx:state.vx,vy:state.vy,alive:true},...state.bots];
  for(const actor of all){
    const model=state.models.get(actor.id);if(!model)continue;
    const show=actor.id==='local'||(state.stage===4 && actor.alive);
    model.root.visible=show;
    if(!show)continue;
    const pos=screenPosition(actor.progress,actor.lateral);
    model.root.position.set(pos.x-state.view.width/2,-(pos.y-state.view.height/2),0);
    model.root.scale.setScalar(energySizeMultiplier(actor.energy));
    if(actor.id==='local'){
      const jumping=now<state.jumpUntil;
      if(jumping)model.root.position.y+=Math.sin(Math.PI*Math.min(1,(now-state.jumpStart)/240))*50;
      updateCharacterFacing(model.root,state.vx,state.vy,ISO);
    }else{
      model.root.rotation.y=Math.PI;
    }
    const wantRun=actor.id==='local'&&Math.hypot(state.vx,state.vy)>18 && now>=state.jumpUntil;
    const want=wantRun?model.run:model.idle;
    if(model.mixer && want && model.current!==want && now>model.attackUntil){
      model.mixer.clipAction(model.current)?.fadeOut(.1);
      model.mixer.clipAction(want).reset().fadeIn(.1).play();
      model.current=want;
    }
    model.mixer?.update(dt);
  }
}

function updateLabels(){
  const p=getTrack(),others=new Map();
  for(const bot of state.bots){
    if(!bot.alive || state.stage!==4)continue;
    const w=worldFromTrack(bot.progress,bot.lateral);
    others.set(bot.id,{displayX:w.x,displayY:w.y,energy:bot.energy,name:bot.name});
  }
  labels.render({x:state.x,y:state.y,energy:state.energy,name:nickname,
    bounds:state.models.get('local')?.root.userData.labelBounds,visible:true},
    others,state.camX,state.camY);
}

let anim=0;
function frame(now){
  anim=requestAnimationFrame(frame);
  if(document.hidden){state.lastTime=now;return;}
  const dt=state.lastTime?Math.min(.05,(now-state.lastTime)/1000):0;
  state.lastTime=now;
  update(dt,now);
  const cam=worldFromTrack(Math.min(LENGTH-100,getTrack().progress+100),0);
  state.camX=cam.x;state.camY=cam.y;
  drawGround(now);
  updateModels(dt,now);
  renderer.render(scene,camera);
  updateLabels();
}
document.addEventListener('visibilitychange',()=>{state.lastTime=0;});
showStage();
anim=requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>{
  cancelAnimationFrame(anim);
  clearTimeout(state.toastTimer);
  for(const model of state.models.values())model.mixer?.stopAllAction();
  renderer.dispose();
});

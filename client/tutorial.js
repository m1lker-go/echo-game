// ECHO tutorial preview: a standalone offline training corridor.
// No Socket.IO connection, profile writes, advertising, or real pack grants.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacterLoaderSelector } from './character-textures.js';
import { updateCharacterFacing } from './character-facing.js';
import { createPlayerLabels, measurePlayerLabelBounds } from './player-labels.js?v=echo-labels-up-1-voice-1-tutorial-names-1';
import { playGameSound } from './audio-effects.js?v=echo-ui-click-1';
import { bindPlayerControls, updatePlayerMovement } from './player-controls.js?v=echo-energy-mobility-1';
import { energyJumpDistance, energySpeedMultiplier, energySizeMultiplier } from './energy-balance.js';
import { getWorldViewport } from './viewport-scale.js?v=echo-world-zoom-2';
import {
  TILE, WIDTH, LENGTH, WATER_START, WATER_END, STAGE_GATES, STAGE_DESCRIPTIONS,
  MOVE_TARGET, BOOST_TARGET, BOT_PROGRESS, RETRY_PROGRESS, JUMP_LINE, STAGE_MARKERS,
  FOOD_PLACEMENTS, worldFromTrack, trackFromWorld, boundToCorridor,
  shuffledEnemies, outcome
} from './tutorial-logic.js';

// Use the same ECHO i18n loader and saved language setting as the main game.
await window.ECHO_I18N_READY;
const tr=(key,fallback,variables)=>window.$t?.('game:tutorial.'+key,fallback,variables)??fallback;
const stageIds=['movement','energy','dash','water','battle'];
const accountToken=localStorage.getItem('echo.authToken');
let serverAttempt=null,serverAlreadyDone=false;
async function beginRegisteredAttempt(){
  if(!accountToken)return;
  try{
    const response=await fetch('/echo/api/tutorial/start',{
      method:'POST',headers:{Authorization:'Bearer '+accountToken},cache:'no-store'
    });
    if(!response.ok)throw Error('Tutorial start HTTP '+response.status);
    const result=await response.json();
    serverAttempt=typeof result.attempt==='string'?result.attempt:null;
    serverAlreadyDone=result.completed===true;
  }catch(error){
    console.warn('[echo tutorial] unable to initialize account attempt:',error.message);
  }
}
async function claimRegisteredReward(){
  if(!accountToken)return {guest:true};
  if(serverAlreadyDone)return {completed:true,alreadyClaimed:true};
  if(!serverAttempt)throw Error('The tutorial attempt could not be started');
  const response=await fetch('/echo/api/tutorial/claim',{
    method:'POST',
    headers:{Authorization:'Bearer '+accountToken,'Content-Type':'application/json'},
    body:JSON.stringify({attempt:serverAttempt}),cache:'no-store'
  });
  if(!response.ok)throw Error('Tutorial claim HTTP '+response.status);
  const result=await response.json();
  if(result.completed!==true)throw Error('Tutorial claim not confirmed');
  serverAlreadyDone=true;serverAttempt=null;
  return result;
}
const lesson=(field,index)=>tr('stages.'+stageIds[index]+'.'+field,STAGE_DESCRIPTIONS[index][field]);

const ISO = {x:0.8660254,y:0.5};
const root=document.querySelector('#game');
const ground=document.querySelector('#tutorial-ground');
const groundCtx=ground.getContext('2d',{alpha:true});
const models=document.querySelector('#tutorial-models');
const labels=createPlayerLabels(document.querySelector('#player-labels'));
const taskTitle=document.querySelector('#tutorial-task-title');
const taskHint=document.querySelector('#tutorial-task-hint');
const taskProgress=document.querySelector('#tutorial-progress');
const stageDots=document.querySelector('#tutorial-stage-dots');
const energyNode=document.querySelector('#tutorial-energy');
const boostButton=document.querySelector('#boost');
const jumpButton=document.querySelector('#jump');

const t0=worldFromTrack(0,0);
const state={
  ...t0, vx:0,vy:0,energy:0,stage:0,keys:new Set(),inputX:0,inputY:0,
  boostUntil:0,boostCooldownUntil:0,jumpUntil:0,jumpStart:0,jumpFrom:0,jumpTo:0,
  waterAudioActive:false,
  boostUsed:false,jumpUsed:false,kills:0,lastWaterDamage:0,locked:false,
  modalSerial:0,waterHintShown:false,gateHintStage:-1,
  contextHintKey:'',contextHintUntil:0,
  view:{width:600,height:350,scale:1},dpr:1,lastTime:0,gateToastTime:0,
  food:FOOD_PLACEMENTS.map(([p,l],i)=>({id:i,progress:p,lateral:l,taken:false})),
  bots:[],models:new Map()
};

function createBots(){
  return shuffledEnemies().map((energy,i)=>({
    id:'training-bot-'+i,energy,progress:BOT_PROGRESS,lateral:[-90,0,90][i],
    skin:['character-male-a.glb','character-female-b.glb','character-male-c.glb'][i],
    alive:true
  }));
}
state.bots=createBots();

function releaseInput(){
  state.vx=0;state.vy=0;
  state.keys.clear();
  state.inputX=0;state.inputY=0;
  document.querySelector('#stick').style.transform='translate(0,0)';
}
// Escape must not skip a lesson: close the real ECHO modal with its OK button.
window.addEventListener('keydown', event => {
  if(state.locked && event.key==='Escape'){
    event.preventDefault();
    event.stopImmediatePropagation();
  }
},true);

async function hintModal(title,message){
  const serial=++state.modalSerial;
  state.locked=true;
  releaseInput();
  await window.ECHOModal.alert({
    title,text:message,buttonText:tr('ok','ОК'),closeOnBackdrop:false
  });
  if(serial===state.modalSerial){
    releaseInput();
    state.locked=false;
  }
}

function refreshStaticText(){
  document.title=tr('title','ECHO — обучение');
  const logo=document.querySelector('.tutorial-brand');
  if(logo?.firstChild?.nodeType===Node.TEXT_NODE){
    const localized=window.$t?.('menu:logo','ЭХО.')||'ЭХО.';
    logo.firstChild.textContent=localized.endsWith('.')?localized.slice(0,-1):localized;
  }
  const back=document.querySelector('.tutorial-back');
  const backLabel=tr('back','В МЕНЮ ✕');
  back.setAttribute('aria-label',backLabel);
  back.setAttribute('title',backLabel);
  document.querySelector('.stats-label').textContent=window.$t?.('game:energy','ЭНЕРГИЯ')||'ЭНЕРГИЯ';
  document.querySelector('.tutorial-controls-tip').textContent=tr('controls','WASD / стрелки — движение');
  boostButton.querySelector('small').textContent=window.$t?.('game:boost','РЫВОК')||'РЫВОК';
  boostButton.setAttribute('aria-label',window.$t?.('game:boost_aria_label','Рывок')||'Рывок');
  jumpButton.querySelector('small').textContent=window.$t?.('game:jump','ПРЫЖОК')||'ПРЫЖОК';
  jumpButton.setAttribute('aria-label',window.$t?.('game:jump_aria_label','Прыжок')||'Прыжок');
  document.querySelector('#tutorial-rotate').textContent=tr('rotate','ПОВЕРНИ УСТРОЙСТВО ГОРИЗОНТАЛЬНО');
  document.documentElement.lang=window.ECHOI18n?.language||'ru';
}
function showObjectiveHint(key,duration=3100){
  state.contextHintKey=key;
  state.contextHintUntil=performance.now()+duration;
  updateHud();
}
function showStage({intro=false}={}){
  root.dataset.tutorialStage=String(state.stage);
  state.contextHintKey='';
  state.contextHintUntil=0;
  taskTitle.textContent=lesson('title',state.stage);
  // Five familiar quest dots show completed tutorial steps.
  stageDots.setAttribute('aria-label',tr('step','Этап {step} из {total}',{
    step:state.stage+1,total:STAGE_DESCRIPTIONS.length
  }));
  const dots=STAGE_DESCRIPTIONS.map((_,index)=>{
    const dot=document.createElement('span');
    dot.className='echo-quest-dot'+(index<state.stage?' is-done':'');
    return dot;
  });
  stageDots.replaceChildren(...dots);
  boostButton.disabled=state.stage!==2;
  jumpButton.disabled=state.stage!==3;
  updateHud();
  // Only the initial lesson explains controls in a modal; stages now advance
  // immediately, without interrupting walking, collecting or fighting.
  if(intro)void hintModal(lesson('title',0),lesson('tip',0));
}

function getTrack(){
  return trackFromWorld(state.x,state.y);
}
function updateHud(){
  const {progress}=getTrack();
  const stage=state.stage;
  let current=stage===0?Math.floor(Math.min(MOVE_TARGET,progress)):
    stage===1?Math.min(10,state.energy):
    stage===2?state.boostUsed && progress>=BOOST_TARGET?1:0:
    stage===3?state.jumpUsed?1:0:state.kills;
  const max=STAGE_DESCRIPTIONS[stage].target;
  // Match the main quest HUD: right side displays the remaining objective.
  const remaining=Math.max(0,max-current);
  taskProgress.textContent=tr('remaining','Осталось: {count}',{count:remaining});
  taskHint.textContent=(state.contextHintKey && performance.now()<state.contextHintUntil)
    ?tr(state.contextHintKey,lesson('objective',stage))
    :lesson('objective',stage);
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
      if(state.gateHintStage!==state.stage){
        state.gateHintStage=state.stage;
        showObjectiveHint('gate');
      }
    }
  }
}

function collectEnergy(){
  if(state.stage!==1)return;
  const t=getTrack();
  for(const f of state.food){
    if(!f.taken && Math.hypot(f.progress-t.progress,f.lateral-t.lateral)<39){
      f.taken=true;state.energy+=1;
    }
  }
  if(state.energy===10)enterStage(2);
}

function triggerBoost(){
  if(state.stage!==2 || state.locked)return;
  const now=performance.now();
  if(now<state.boostCooldownUntil)return;
  state.boostUsed=true;
  playGameSound('dash');
  state.boostUntil=now+700;
  state.boostCooldownUntil=now+3000;
}

function triggerJump(){
  if(state.stage!==3 || state.locked || performance.now()<state.jumpUntil)return;
  const from=getTrack();
  if(from.progress<WATER_START-100 || from.progress>=WATER_START-12){
    showObjectiveHint('jump_early');
    return;
  }
  const reach=energyJumpDistance(state.energy,420);
  const to=Math.min(STAGE_GATES[3]-12,from.progress+reach);
  if(to<WATER_END+16){showObjectiveHint('jump_early');return;}
  playGameSound('jump');
  state.jumpStart=performance.now();
  state.jumpUntil=state.jumpStart+240;
  state.jumpFrom=from.progress;
  state.jumpTo=to;
  state.jumpLateral=from.lateral;
  state.vx=0;state.vy=0;
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
  releaseInput();
  const win=kind==='win';
  if(!win){
    void window.ECHOModal.alert({
      title:tr('lose','ВЫ ПРОИГРАЛИ'),
      text:tr('lose_text','Противник оказался сильнее. Попробуй начать с самого слабого.'),
      buttonText:tr('retry','ПОПРОБОВАТЬ ЕЩЁ РАЗ'),
      closeOnBackdrop:false
    }).then(resetFinalChallenge);
    return;
  }
  // Completion is NOT persisted until the player actually clicks Claim.
  const reward=document.createElement('div');
  reward.className='tutorial-reward-modal';
  const paragraphs=[
    ['win_intro','И теперь ты знаешь основные механики игры «ЭХО.»!'],
    ['win_freedom','Дальше всё зависит от тебя!'],
    ['win_adventure','Сражайся с другими игроками, приглашай друзей и собери всех героев арены!'],
    ['reward','Награда: 3× обычный пак']
  ];
  for(const [key,fallback] of paragraphs){
    const line=document.createElement('p');
    line.className=key==='reward'?'tutorial-reward-line':'tutorial-message-line';
    line.textContent=tr(key,fallback);
    reward.appendChild(line);
  }
  const icons=document.createElement('div');
  icons.className='tutorial-reward-icons';
  for(let i=0;i<3;i++){
    const image=document.createElement('img');
    image.src='./assets/packs/icon_echocard_basic.webp';
    image.alt=tr('pack_alt','Обычный пак');
    icons.appendChild(image);
  }
  reward.appendChild(icons);
  const note=document.createElement('p');
  note.className='tutorial-reward-note';
  if(!accountToken)note.textContent=tr('guest_reward_note','Гости не получают паки. Войди в аккаунт, чтобы получить награду.');
  else if(serverAlreadyDone)note.textContent=tr('already_rewarded','Награда за обучение уже получена.');
  reward.appendChild(note);
  // The shared dialog keeps its behavior; tutorial-only CSS fits this finale on
  // short landscape screens without increasing the modal system's global size.
  window.ECHOModal.open({
    title:tr('win','Поздравляю, ты прошёл обучение!'),contentElement:reward,
    closeOnBackdrop:false,
    buttons:[{
      label:tr('claim','ЗАБРАТЬ'),value:true,variant:'primary',
      async onClick(){
        try{
          if(accountToken)await claimRegisteredReward();
          // The authenticated server commits completion + packs atomically;
          // guests have no DB entry and receive no free packs.
          window.location.href='./';
          return true;
        }catch(error){
          note.textContent=tr('claim_error','Не удалось забрать награду. Проверь соединение и попробуй снова.');
          return false;
        }
      }
    }]
  });
}

function resetFinalChallenge(){
  state.energy=10;
  state.kills=0;
  state.bots=createBots();
  // Keep already loaded animated GLB actors: only the training enemy energy
  // order changes on retry, so repeated losses do not reload models/GPU assets.
  const p=worldFromTrack(RETRY_PROGRESS,0);
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
  const inWater=state.stage===3 && !state.jumpUntil &&
    p.progress>=WATER_START && p.progress<=WATER_END;
  if(inWater!==state.waterAudioActive){
    state.waterAudioActive=inWater;
    window.dispatchEvent(new CustomEvent('echo:water-running',{detail:{running:inWater}}));
  }
  if(state.stage===0 && p.progress>=MOVE_TARGET)enterStage(1);
  if(state.stage===1)collectEnergy();
  if(state.stage===2 && state.boostUsed && p.progress>=BOOST_TARGET)enterStage(3);
  if(state.stage===3 && !state.jumpUntil && p.progress>=WATER_START && p.progress<=WATER_END && now-state.lastWaterDamage>550){
    state.energy=Math.max(0,state.energy-1);
    state.lastWaterDamage=now;
    if(!state.waterHintShown){
      state.waterHintShown=true;
      showObjectiveHint('water_warning',4500);
    }
  }
  if(state.stage===3 && (p.progress>WATER_END+4 || state.energy===0)){
    const shore=worldFromTrack(JUMP_LINE,0);
    state.x=shore.x;state.y=shore.y;state.vx=0;state.vy=0;state.energy=10;
    showObjectiveHint('water_retry',4100);
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
const nickname=localStorage.getItem('echo.playerName')||tr('hero','Герой');

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
  // Match main ECHO: HUD and touch controls scale with the screen height.
  root.style.setProperty('--echo-ui-scale',String(state.view.uiScale));
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
  // The same low-contrast graphite grid as ECHO, projected in true isometric world X/Y.
  const grad=ctx.createLinearGradient(0,0,0,height);
  grad.addColorStop(0,'#121a25');grad.addColorStop(1,'#070d16');
  poly([[0,-WIDTH/2],[LENGTH,-WIDTH/2],[LENGTH,WIDTH/2],[0,WIDTH/2]],grad,'rgba(179,212,235,.38)',1.5);
  const visible=getTrack().progress;
  for(let p=Math.max(0,Math.floor((visible-400)/TILE)*TILE);p<=Math.min(LENGTH,visible+600);p+=TILE){
    line(p,-WIDTH/2,p,WIDTH/2,'rgba(169,198,228,.14)',1);
  }
  for(const l of [-WIDTH/2+TILE,-WIDTH/2+TILE*2])
    line(0,l,LENGTH,l,'rgba(169,198,228,.15)',1);
  for(const edge of [-WIDTH/2,WIDTH/2]){
    line(0,edge,LENGTH,edge,'rgba(179,212,235,.38)',2);
    for(let p=0;p<LENGTH;p+=TILE){
      const s=screenPosition(p,edge);
      ctx.fillStyle='rgba(195,222,247,.22)';
      ctx.fillRect(s.x-2,s.y-2,4,4);
    }
  }
  // Unlocked objective markers and locked gates are part of the arena itself.
  const goal=STAGE_MARKERS[state.stage];
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
  water.addColorStop(0,'rgba(6,36,95,.64)');water.addColorStop(1,'rgba(6,36,95,.8)');
  poly([[WATER_START,-WIDTH/2],[WATER_END,-WIDTH/2],[WATER_END,WIDTH/2],[WATER_START,WIDTH/2]],water,'rgba(169,198,228,.45)',1.5);
  for(let j=0;j<6;j++){
    const p=WATER_START+18+j*17;
    const shimmer=(now*.018+j*11)%58;
    line(p,-105+shimmer/3,p,70+shimmer/3,'rgba(132,225,255,'+(0.1+j*.05)+')',1.5);
  }
  // Visible jump launch line just before the water.
  line(JUMP_LINE,-105,JUMP_LINE,105,'rgba(157,243,255,.8)',2);
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
      // Bots remain stationary but turn toward the approaching player using
      // the exact eight-direction isometric facing rules of real combat.
      const botWorld=worldFromTrack(actor.progress,actor.lateral);
      updateCharacterFacing(model.root,state.x-botWorld.x,state.y-botWorld.y,ISO);
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
    others.set(bot.id,{displayX:w.x,displayY:w.y,energy:bot.energy,hideName:true});
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
document.addEventListener('visibilitychange',()=>{
  state.lastTime=0;
  if(document.hidden){
    state.waterAudioActive=false;
    window.dispatchEvent(new CustomEvent('echo:water-running',{detail:{running:false}}));
  }
});
await beginRegisteredAttempt();
refreshStaticText();
showStage({intro:true});
document.addEventListener('echo:language-changed',()=>{
  refreshStaticText();
  showStage(); // Rerender active task, never restart the tutorial or reopen its modal.
});
anim=requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>{
  window.dispatchEvent(new CustomEvent('echo:water-running',{detail:{running:false}}));
  cancelAnimationFrame(anim);
  for(const model of state.models.values())model.mixer?.stopAllAction();
  renderer.dispose();
});

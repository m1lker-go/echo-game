import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import { rollPack } from './pack-balance.js?v=echo-rarity-limits-1';
import { createCharacterLoaderSelector } from './character-textures.js?v=echo-isolated-character-atlas-1';
// Visual preview only: no purchase, fragment inventory or real rewards yet.
const root=document.querySelector('#echo-pack-3d'),fan=root?.querySelector('#echo-pack-card-fan');
const rarityInfo={
 common:{ru:'ОБЫЧНАЯ',en:'COMMON',color:'#c4cbd4'},
 uncommon:{ru:'НЕОБЫЧНАЯ',en:'UNCOMMON',color:'#79e6a6'},
 rare:{ru:'РЕДКАЯ',en:'RARE',color:'#66c8ff'},
 epic:{ru:'ЭПИЧЕСКАЯ',en:'EPIC',color:'#c19aff'},
 legendary:{ru:'ЛЕГЕНДАРНАЯ',en:'LEGENDARY',color:'#ffe098'}
};
const modelNames={
 'female-a':['Костыль','Crutch'],'female-b':['Девчонка','Girl'],
 'female-c':['Бабуся','Granny'],'female-d':['Бизнес леди','Business Lady'],
 'female-e':['Медсестра','Nurse'],'female-f':['Хвостики','Pigtails'],
 'male-a':['Зоркий','Eagle Eye'],'male-b':['Дедок','Grandpa'],
 'male-c':['Полицай','Cop'],'male-d':['Бизнесмен','Businessman'],
 'male-e':['Учёный','Scientist'],'male-f':['Злюка','Grump'],
 ghost:['Призрак','Ghost'],keeper:['Фермер','Farmer'],
 skeleton:['Скелет','Skeleton'],zombie:['Зомби','Zombie'],
 human:['Воин','Warrior'],orc:['Орк','Orc']
};
const labelFor=model=>{
 const key=model.replace(/^character-/,'').replace(/\.glb$/,'');
 return modelNames[key]?.[locale()==='en'?1:0]||key;
};
let rarities=[];
const modelPromises=new Map();
let prepared=false;
function loadModel(model){
 if(!modelPromises.has(model)){
  const promise=characterLoader(model).loadAsync('./assets/models/'+model).catch(error=>{modelPromises.delete(model);throw error;});
  modelPromises.set(model,promise);
 }
 return modelPromises.get(model);
}
function prepareRoll(type,cards){
 rarities=(cards||rollPack(type==='premium'?'premium':'coin')).sort((a,b)=>['common','uncommon','rare','epic','legendary'].indexOf(a.rarity)-['common','uncommon','rare','epic','legendary'].indexOf(b.rarity));
 prepared=true;
 // Start decoding the chosen models immediately, before the user tears the pack.
 for(const {model} of rarities)void loadModel(model).catch(err=>console.warn('[ECHO cards] Preload unavailable:',model,err));
 void portraits().catch(err=>console.warn('[ECHO cards] Portrait preload unavailable:',err));
}

const baseLoader=new GLTFLoader();
const characterLoader=createCharacterLoaderSelector(THREE,GLTFLoader,baseLoader);
let session=0,timers=[],portraitCache=new Map(),portraitPromise=null,nextIndex=0,canAdvance=false,live=null,settleTimer=null,currentCard=null;
const cardArtBase='./assets/packs/';
const faceNames={common:'card_common.webp',uncommon:'card_uncommon.webp',rare:'card_rare.webp',epic:'card_epic.webp',legendary:'card_legend.webp'};
const locale=()=>document.documentElement.lang?.startsWith('en')?'en':'ru';
function stopLive(){
 if(!live)return;
 cancelAnimationFrame(live.raf);
 const {renderer,card}=live;
 // Preserve a still image of the last rendered 3D hero before stopping its scene.
 const slot=card?.querySelector('.echo-fan-portrait');
 if(slot){
  const frame=slot.querySelector('.echo-fan-still');
  try{
   const snapshot=renderer.domElement.toDataURL('image/png');
   if(frame){frame.src=snapshot;frame.hidden=false;}
  }catch(err){console.warn('[ECHO cards] Snapshot unavailable:',err);}
  slot.classList.remove('is-live');
  slot.querySelector('.echo-fan-live')?.remove();
 }
 renderer.dispose();renderer.forceContextLoss();live=null;
}
function clear(){if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}session++;timers.forEach(clearTimeout);timers=[];stopLive();nextIndex=0;canAdvance=false;currentCard=null;fan?.replaceChildren();fan?.classList.remove('is-visible');fan?.classList.remove('can-advance');}
function schedule(fn,ms){timers.push(setTimeout(fn,ms));}
async function portraits(){
 if(portraitPromise)return portraitPromise;
 const pending=rarities.filter(r=>!portraitCache.has(r.model));
 if(!pending.length)return portraitCache;
 portraitPromise=(async()=>{
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setSize(256,330);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,256/330,.1,100);
  scene.add(new THREE.HemisphereLight(0xffffff,0x34465f,3));
  const lamp=new THREE.DirectionalLight(0xffffff,2.7);lamp.position.set(-3,5,7);scene.add(lamp);
  try{
   for(const r of pending){
    try{
     const gltf=await loadModel(r.model);
     const model=gltf.scene;scene.add(model);
     try{
      const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const maxDim=Math.max(size.y,size.x*1.45,size.z*1.6,.1);
      const distance=maxDim/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.22;
      camera.position.set(0,0,distance);camera.lookAt(0,0,0);
      renderer.render(scene,camera);
      portraitCache.set(r.model,renderer.domElement.toDataURL('image/png'));
     }finally{scene.remove(model);model.position.set(0,0,0);}
    }catch(err){console.warn('[ECHO cards] Character portrait:',r.model,err);}
   }
  }finally{renderer.dispose();renderer.forceContextLoss();}
  return portraitCache;
 })();
 try{return await portraitPromise;}finally{portraitPromise=null;}
}
function makeCard(r,i){
 const card=document.createElement('div');card.className='echo-fan-card';card.style.setProperty('--rarity',rarityInfo[r.rarity].color);
 
 card.style.setProperty('--index',i);
 card.style.setProperty('--angle',(-34+i*17)+'deg');
 card.style.setProperty('--spread',(-2+i)*49+'%');
 card.style.setProperty('--rise',(Math.abs(i-2)*10)+'px');
 const info=rarityInfo[r.rarity];
 const label=locale()==='en'?info.en:info.ru;
 const name=labelFor(r.model);
 card.innerHTML='<div class="echo-fan-inner"><div class="echo-fan-back"><img class="echo-fan-back-animated" src="./assets/packs/card_rubashkaa.webp" alt="" draggable="false"></div><div class="echo-fan-front"><img class="echo-fan-face-texture" alt="" draggable="false"><div class="echo-fan-glow"></div><div class="echo-fan-portrait"></div><div class="echo-fan-rarity"></div><div class="echo-fan-name"></div><div class="echo-fan-count"></div></div></div>';
 card.querySelector('.echo-fan-face-texture').src=cardArtBase+faceNames[r.rarity];
 const backImage=card.querySelector('.echo-fan-back-animated');
 backImage.addEventListener('error',()=>{backImage.remove();},{once:true});
 card.querySelector('.echo-fan-rarity').textContent=label;
 card.querySelector('.echo-fan-name').textContent=name;
 card.querySelector('.echo-fan-count').textContent='×'+r.count;
 const pic=portraitCache.get(r.model);
 if(pic){const img=document.createElement('img');img.src=pic;img.alt='';card.querySelector('.echo-fan-portrait').append(img);}
 else{card.querySelector('.echo-fan-portrait').textContent='✦';}
 const still=document.createElement('img');still.className='echo-fan-still';still.alt='';still.hidden=true;card.querySelector('.echo-fan-portrait').append(still);
 return card;
}
// Only the latest revealed card hosts a live model; older cards keep their static portraits.
async function animateHero(r,card,id){
 stopLive();
 const slot=card.querySelector('.echo-fan-portrait');
 if(!slot||!card.isConnected)return;
 let renderer;
 try{
  const gltf=await loadModel(r.model);
  if(id!==session||root.hidden||!card.isConnected||currentCard!==card)return;
  const canvas=document.createElement('canvas');canvas.className='echo-fan-live';
  slot.append(canvas);slot.classList.add('is-live');
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setPixelRatio(1);renderer.setSize(180,230,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,180/230,.1,100);
  scene.add(new THREE.HemisphereLight(0xffffff,0x395474,3));
  const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(-2,4,6);scene.add(light);
  const hero=gltf.scene;scene.add(hero);
  const box=new THREE.Box3().setFromObject(hero),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  hero.position.sub(center);
  const dist=Math.max(size.y,size.x*1.45,size.z*1.6,.1)/(2*Math.tan(THREE.MathUtils.degToRad(16)))*1.2;
  camera.position.set(0,0,dist);camera.lookAt(0,0,0);
  const mixer=gltf.animations.length?new THREE.AnimationMixer(hero):null;
  if(mixer){
   // Favor an expressive clip if the model provides one, otherwise its first real animation.
   const expressive=gltf.animations.find(c=>/dance|wave|victory|cheer|celebrat|jump|emote|idle/i.test(c.name));
   mixer.clipAction(expressive||gltf.animations[0]).play();
  }
  const state={renderer,raf:0,card};live=state;
  let previous=performance.now(),elapsed=0;
  const frame=(now)=>{
   if(live!==state||id!==session||root.hidden||!card.isConnected)return;
   const dt=Math.min(.05,(now-previous)/1000);previous=now;elapsed+=dt;
   if(mixer)mixer.update(dt);
   else{hero.rotation.y=Math.sin(elapsed*1.1)*.19;hero.position.y=-center.y+Math.sin(elapsed*1.8)*.025;}
   renderer.render(scene,camera);state.raf=requestAnimationFrame(frame);
  };
  state.raf=requestAnimationFrame(frame);
 }catch(err){console.warn('[ECHO cards] Animated hero unavailable:',r.model,err);if(renderer){renderer.dispose();renderer.forceContextLoss();}}
}
function finishCurrent(){
 if(!currentCard)return;
 currentCard.classList.add('is-instant');
 // Force the final transform rather than waiting for a transition to complete.
 const card=currentCard;
 card.classList.add('is-launched');
 card.querySelector('.echo-fan-inner').classList.add('is-instant');
 if(settleTimer){clearTimeout(settleTimer);settleTimer=null;}
 if(!live)animateHero(rarities[nextIndex-1],card,session);
 canAdvance=nextIndex<rarities.length;
 fan.classList.toggle('can-advance',canAdvance);
}
function launchNext(){
 if(root.hidden||nextIndex>=rarities.length)return;
 // A quick tap skips the remaining flip and immediately advances.
 if(!canAdvance&&currentCard)finishCurrent();
 if(!canAdvance)return;
 canAdvance=false;fan.classList.add('can-advance');
 stopLive();
 const i=nextIndex++,r=rarities[i],id=session,card=makeCard(r,i);
 currentCard=card;fan.append(card);
 requestAnimationFrame(()=>card.classList.add('is-launched'));
 settleTimer=setTimeout(()=>{
  settleTimer=null;
  if(id!==session||root.hidden||currentCard!==card)return;
  animateHero(r,card,id);
  canAdvance=nextIndex<rarities.length;
  fan.classList.toggle('can-advance',canAdvance);
  fan.setAttribute('aria-label',canAdvance?
   (locale()==='en'?'Tap to reveal the next card':'Нажми, чтобы открыть следующую карточку'):
   (locale()==='en'?'All cards revealed':'Все карточки открыты'));
 },2100);
}
async function reveal(event){
 if(!fan||root.hidden)return;
 clear();if(!prepared)prepareRoll(event?.detail?.type);const id=session;fan.classList.add('is-visible');
 fan.setAttribute('role','button');fan.setAttribute('tabindex','0');
 fan.setAttribute('aria-label',locale()==='en'?'Revealing character cards':'Открытие карточек героев');
 await portraits().catch(err=>console.warn('[ECHO cards] portraits unavailable',err));
 // A previous preparation may have finished while this new pack was queued.
 if(rarities.some(r=>!portraitCache.has(r.model)))await portraits().catch(err=>console.warn('[ECHO cards] More portraits unavailable',err));
 if(id!==session||root.hidden)return;
 canAdvance=true;launchNext();
}
fan?.addEventListener('click',launchNext);
fan?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();launchNext();}});
window.addEventListener('echo:pack-prepare',event=>prepareRoll(event.detail?.type,event.detail?.cards));
window.addEventListener('echo:pack-opened',reveal);
window.addEventListener('echo:pack-reset',clear);
window.addEventListener('echo:pack-closed',()=>{clear();prepared=false;});
document.addEventListener('echo:language-changed',()=>{
 fan?.querySelectorAll('.echo-fan-card').forEach((card,i)=>card.querySelector('.echo-fan-rarity').textContent=locale()==='en'?rarityInfo[rarities[i].rarity].en:rarityInfo[rarities[i].rarity].ru);
 fan?.querySelectorAll('.echo-fan-card').forEach((card,i)=>card.querySelector('.echo-fan-name').textContent=labelFor(rarities[i].model));
});

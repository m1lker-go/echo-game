import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Demo only: five mock fragment drops, ordered by rarity; no server rewards.
const root=document.querySelector('#echo-pack-3d'),fan=root?.querySelector('#echo-pack-card-fan');
const rarities=[
 {key:'common',ru:'ОБЫЧНАЯ',en:'COMMON',color:'#c4cbd4',model:'character-female-a.glb',count:3},
 {key:'uncommon',ru:'НЕОБЫЧНАЯ',en:'UNCOMMON',color:'#79e6a6',model:'character-male-b.glb',count:2},
 {key:'rare',ru:'РЕДКАЯ',en:'RARE',color:'#66c8ff',model:'character-female-c.glb',count:3},
 {key:'epic',ru:'ЭПИЧЕСКАЯ',en:'EPIC',color:'#c19aff',model:'character-male-d.glb',count:1},
 {key:'legendary',ru:'ЛЕГЕНДАРНАЯ',en:'LEGENDARY',color:'#ffe098',model:'character-female-f.glb',count:1}
];
let session=0,timers=[],portraitCache=new Map(),portraitPromise=null;
const locale=()=>document.documentElement.lang?.startsWith('en')?'en':'ru';
function clear(){session++;timers.forEach(clearTimeout);timers=[];fan?.replaceChildren();fan?.classList.remove('is-visible');}
function schedule(fn,ms){timers.push(setTimeout(fn,ms));}
async function portraits(){
 if(portraitPromise)return portraitPromise;
 portraitPromise=(async()=>{
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setSize(256,330);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,256/330,.1,100);
  scene.add(new THREE.HemisphereLight(0xffffff,0x34465f,3));
  const lamp=new THREE.DirectionalLight(0xffffff,2.7);lamp.position.set(-3,5,7);scene.add(lamp);
  const loader=new GLTFLoader();
  try{
   for(const r of rarities){
    try{
     const gltf=await loader.loadAsync('./assets/models/'+r.model);
     const model=gltf.scene;scene.add(model);
     const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
     model.position.sub(center);
     const maxDim=Math.max(size.y,size.x*1.45,size.z*1.6,.1);
     const distance=maxDim/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.22;
     camera.position.set(0,0,distance);camera.lookAt(0,0,0);
     renderer.render(scene,camera);portraitCache.set(r.key,renderer.domElement.toDataURL('image/png'));
     scene.remove(model);
    }catch(err){console.warn('[ECHO cards] Character portrait:',r.model,err);}
   }
  }finally{renderer.dispose();renderer.forceContextLoss();}
  return portraitCache;
 })();return portraitPromise;
}
function makeCard(r,i){
 const card=document.createElement('div');card.className='echo-fan-card';card.style.setProperty('--rarity',r.color);
 card.style.setProperty('--index',i);
 card.style.setProperty('--angle',(-24+i*12)+'deg');
 card.style.setProperty('--spread',(-2+i)*29+'%');
 card.style.setProperty('--rise',(Math.abs(i-2)*11)+'px');
 const label=locale()==='en'?r.en:r.ru;
 const name=r.model.replace('character-','').replace('.glb','').toUpperCase().replaceAll('-',' ');
 card.innerHTML='<div class="echo-fan-inner"><div class="echo-fan-back"><b>ECHO</b><small>CARDS</small></div><div class="echo-fan-front"><div class="echo-fan-glow"></div><div class="echo-fan-portrait"></div><div class="echo-fan-rarity"></div><div class="echo-fan-name"></div><div class="echo-fan-count"></div></div></div>';
 card.querySelector('.echo-fan-rarity').textContent=label;
 card.querySelector('.echo-fan-name').textContent=name;
 card.querySelector('.echo-fan-count').textContent='+'+r.count;
 const pic=portraitCache.get(r.key);
 if(pic){const img=document.createElement('img');img.src=pic;img.alt='';card.querySelector('.echo-fan-portrait').append(img);}
 else{card.querySelector('.echo-fan-portrait').textContent='✦';}
 return card;
}
async function reveal(){
 if(!fan||root.hidden)return;
 clear();const id=session;fan.classList.add('is-visible');
 // Preview portraits before revealing; loading failures never prevent animations.
 await portraits().catch(err=>console.warn('[ECHO cards] portraits unavailable',err));
 if(id!==session||root.hidden)return;
 rarities.forEach((r,i)=>schedule(()=>{
  if(id!==session||root.hidden)return;
  const card=makeCard(r,i);fan.append(card);
  requestAnimationFrame(()=>card.classList.add('is-launched'));
 },i*580));
}
window.addEventListener('echo:pack-opened',reveal);
window.addEventListener('echo:pack-reset',clear);
window.addEventListener('echo:pack-closed',clear);
document.addEventListener('echo:language-changed',()=>{
 fan?.querySelectorAll('.echo-fan-card').forEach((card,i)=>card.querySelector('.echo-fan-rarity').textContent=locale()==='en'?rarities[i].en:rarities[i].ru);
});

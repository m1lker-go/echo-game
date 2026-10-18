(()=>{'use strict';
const root=document.querySelector('#echo-pack-demo');
if(!root)return;
const foil=root.querySelector('.echo-demo-foil'),strip=root.querySelector('.echo-demo-strip'),cut=root.querySelector('.echo-demo-cut'),hit=root.querySelector('.echo-demo-hit'),tip=root.querySelector('.echo-demo-tip'),cards=root.querySelector('.echo-demo-cards');
let progress=0,dragging=false,opened=false;
const lang=(ru,en)=>document.documentElement.lang?.startsWith('en')?en:ru;
function render(){
 root.style.setProperty('--tear',String(progress));
 foil.classList.toggle('is-opened',opened);
 tip.textContent=opened?lang('Пак открыт! Карточки пока демонстрационные.','Pack opened! Demo cards only.'):lang('Проведи по верхнему шву слева направо','Swipe the top seam from left to right');
 cards.setAttribute('aria-hidden',String(!opened));
}
function reset(type){
 progress=0;dragging=false;opened=false;
 root.dataset.type=type;
 root.hidden=false;
 root.classList.remove('is-opened');
 render();
}
document.querySelectorAll('[data-echo-preview-pack]').forEach(button=>button.addEventListener('click',()=>reset(button.dataset.echoPreviewPack)));
root.querySelector('.echo-demo-close').addEventListener('click',()=>{root.hidden=true;dragging=false;});
root.querySelector('.echo-demo-again').addEventListener('click',()=>reset(root.dataset.type));
hit.addEventListener('pointerdown',e=>{if(opened)return;dragging=true;hit.setPointerCapture(e.pointerId);move(e);});
function move(e){
 if(!dragging||opened)return;
 const rect=hit.getBoundingClientRect();
 progress=Math.max(progress,Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));
 if(progress>=.95){progress=1;opened=true;root.classList.add('is-opened');dragging=false;}
 render();
}
hit.addEventListener('pointermove',move);
hit.addEventListener('pointerup',()=>{dragging=false;});
hit.addEventListener('pointercancel',()=>{dragging=false;});
root.addEventListener('keydown',e=>{if(e.key==='Escape'){root.hidden=true;}if((e.key==='Enter'||e.key===' ')&&document.activeElement===hit){e.preventDefault();progress=1;opened=true;root.classList.add('is-opened');render();}});
})();
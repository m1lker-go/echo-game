(()=>{'use strict';
const root=document.querySelector('#echo-pack-demo');if(!root)return;
const hit=root.querySelector('.echo-demo-hit'),tip=root.querySelector('.echo-demo-tip'),cards=root.querySelector('.echo-demo-cards');
const peel=root.querySelector('.echo-demo-peel'),front=root.querySelector('.echo-demo-peel-front'),back=root.querySelector('.echo-demo-peel-back');
let progress=0,dragging=false,opened=false,pullY=0;
const lang=(ru,en)=>document.documentElement.lang?.startsWith('en')?en:ru;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function render(){
  const end=clamp(progress*240,0,240);
  root.style.setProperty('--tear-pct',`${(progress*100).toFixed(2)}%`);
  root.classList.toggle('is-tearing',progress>0&&!opened);
  root.classList.toggle('is-opened',opened);
  // Draw the torn portion as its OWN folded foil sheet, not a decoration over intact foil.
  // Its lower edge stays attached to the pointer and curls upward from the exposed cut.
  const lift=clamp(pullY,-110,12);
  if(end>0 && !opened){
    const tipX=end+clamp(-lift*.25,5,32);
    const tipY=14+lift;
    const foldX=Math.max(0,end*.5);
    front.setAttribute('d',`M0 0 L${end.toFixed(1)} 0 Q${(end+4).toFixed(1)} 6 ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q${foldX.toFixed(1)} ${(14+lift*.42).toFixed(1)} 0 45 Z`);
    back.setAttribute('d',`M0 45 Q${foldX.toFixed(1)} ${(14+lift*.42).toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q${(end*.63).toFixed(1)} ${(27+lift*.1).toFixed(1)} 0 45 Z`);
    peel.style.opacity='1';
  }else{peel.style.opacity='0';front.setAttribute('d','');back.setAttribute('d','');}
  tip.textContent=opened?lang('Пак открыт! Карточки пока демонстрационные.','Pack opened! Demo cards only.'):progress>0?lang('Продолжай тянуть вправо','Keep pulling to the right'):lang('Потяни за левый верхний угол вправо','Pull the upper-left corner to the right');
  cards.setAttribute('aria-hidden',String(!opened));
}
function reset(type){progress=0;pullY=0;dragging=false;opened=false;root.dataset.type=type;root.hidden=false;render();}
document.querySelectorAll('[data-echo-preview-pack]').forEach(b=>b.addEventListener('click',()=>reset(b.dataset.echoPreviewPack)));
root.querySelector('.echo-demo-close').addEventListener('click',()=>{root.hidden=true;dragging=false;});
root.querySelector('.echo-demo-again').addEventListener('click',()=>reset(root.dataset.type));
function move(e){
 if(!dragging||opened)return;
 const rect=hit.getBoundingClientRect();
 const ratio=clamp((e.clientX-rect.left)/rect.width,0,1);
 progress=Math.max(progress,ratio);
 pullY=clamp((e.clientY-rect.top)/rect.height*64-35,-110,12);
 if(progress>=.97){progress=1;opened=true;dragging=false;}
 render();
}
hit.addEventListener('pointerdown',e=>{
 if(opened)return;
 const rect=hit.getBoundingClientRect();
 if(progress===0&&(e.clientX-rect.left)>rect.width*.25)return;
 dragging=true;hit.setPointerCapture(e.pointerId);move(e);
});
hit.addEventListener('pointermove',move);
hit.addEventListener('pointerup',()=>{dragging=false;render();});
hit.addEventListener('pointercancel',()=>{dragging=false;render();});
root.addEventListener('keydown',e=>{
 if(e.key==='Escape')root.hidden=true;
 if((e.key==='Enter'||e.key===' ')&&document.activeElement===hit){e.preventDefault();progress=1;opened=true;render();}
});
})();
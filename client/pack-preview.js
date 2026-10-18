(()=>{'use strict';
const root=document.querySelector('#echo-pack-demo');if(!root)return;
const hit=root.querySelector('.echo-demo-hit'),tip=root.querySelector('.echo-demo-tip'),cards=root.querySelector('.echo-demo-cards');
const peel=root.querySelector('.echo-demo-peel'),front=root.querySelector('.echo-demo-peel-front'),back=root.querySelector('.echo-demo-peel-back');
let progress=0,dragging=false,opened=false,pullY=0;
const lang=(ru,en)=>document.documentElement.lang?.startsWith('en')?en:ru;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Sample a bent rectangular ribbon. Both long edges follow the same curve;
// one edge keeps the original zigzag/crimp of the sealed booster.
function drawRibbon(end,lift){
  const span=Math.max(9,end*.72);
  const width=clamp(11+end*.017,11,15);
  const rise=clamp(23-lift*.55,24,78);
  const point=t=>{
    // Connected end is always fixed to the current tear point at (end, 31).
    // The free end doubles back over a rounded U-shaped bend.
    const left=end-span;
    if(t<.5){
      const q=t*2,inv=1-q;
      return {x:inv*inv*inv*end+3*inv*inv*q*(end-span*.32)+3*inv*q*q*(left-span*.04)+q*q*q*left,
              y:inv*inv*inv*31+3*inv*inv*q*39+3*inv*q*q*(20-rise*.18)+q*q*q*(10-rise*.35)};
    }
    const q=(t-.5)*2,inv=1-q;
    return {x:inv*inv*inv*left+3*inv*inv*q*(left-span*.12)+3*inv*q*q*(end-span*.55)+q*q*q*(end-span*.15),
            y:inv*inv*inv*(10-rise*.35)+3*inv*inv*q*(-rise*.9)+3*inv*q*q*(-rise)+q*q*q*(-rise*.75)};
  };
  const n=56,outer=[],inner=[];
  for(let i=0;i<=n;i++){
    const t=i/n,p=point(t),p0=point(Math.max(0,t-.002)),p1=point(Math.min(1,t+.002));
    const dx=p1.x-p0.x,dy=p1.y-p0.y,mag=Math.hypot(dx,dy)||1;
    const nx=-dy/mag,ny=dx/mag;
    const teeth=i===0||i===n?0:(i%4===0?3:0);
    outer.push([p.x+nx*(width+teeth),p.y+ny*(width+teeth)]);
    inner.push([p.x-nx*width,p.y-ny*width]);
  }
  const coords=pts=>pts.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
  // The silver reverse side fills the actual rectangular curled ribbon.
  back.setAttribute('d',coords(outer)+' '+coords([...inner].reverse()).replace(/^M/,'L')+' Z');
  // A narrow highlight near the bending edge adds dimensionality.
  const highlight=outer.slice(Math.floor(n*.40),Math.floor(n*.75));
  front.setAttribute('d',coords(highlight));
}
function render(){
  const end=clamp(progress*240,0,240);
  root.style.setProperty('--tear-pct',`${(progress*100).toFixed(2)}%`);
  root.classList.toggle('is-tearing',progress>0&&!opened);
  root.classList.toggle('is-opened',opened);
  if(end>3&&!opened){drawRibbon(end,pullY);peel.style.opacity='1';}
  else{peel.style.opacity='0';front.setAttribute('d','');back.setAttribute('d','');}
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
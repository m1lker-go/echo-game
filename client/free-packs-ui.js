// Shop display only. The server owns free-pack counts and their consumption.
const types=['coin','premium'],counts={coin:0,premium:0};
let version=0;
const isEnglish=()=>document.documentElement.lang?.startsWith('en')===true;
const tr=(key,fallback)=>window.$t?.('menu:'+key,fallback)??fallback;
function render(){
 for(const type of types){
  const n=counts[type];
  const badge=document.querySelector('[data-echo-free-badge="'+type+'"]');
  const button=document.querySelector('[data-echo-preview-pack="'+type+'"]');
  if(badge){badge.hidden=n===0;badge.textContent=n+' '+(isEnglish()?'pcs.':'шт.');}
  if(!button)continue;
  const price=button.querySelector('[data-echo-paid-price]');
  const label=button.querySelector('[data-echo-free-label]');
  if(price)price.hidden=n>0;
  if(label){label.hidden=n===0;label.textContent=tr('pack_free_open',isEnglish()?'Open':'Открыть');}
  if(n)button.setAttribute('aria-label',tr('pack_free_open',isEnglish()?'Open':'Открыть'));
  else button.setAttribute('aria-label',type==='coin'?'50 ECHO Coin':document.getElementById('echo-premium-price')?.textContent||'Premium');
 }
}
export function cachedFreePackCount(type){return counts[type]||0;}
export function setFreePackRemaining(type,remaining){
 if(!types.includes(type))return;
 version++;counts[type]=Math.max(0,Math.trunc(Number(remaining)||0));render();
}
export async function refreshFreePackCounts(){
 const id=++version,token=localStorage.getItem('echo.authToken');
 if(!token){counts.coin=0;counts.premium=0;render();return {...counts};}
 const res=await fetch('/echo/api/packs/free',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!res.ok)throw new Error(res.status===401?'auth':'free_packs_status');
 const data=await res.json();
 if(id===version&&token===localStorage.getItem('echo.authToken')){
  for(const type of types)counts[type]=Math.max(0,Math.trunc(Number(data.packs?.[type])||0));
  render();
 }
 return {...counts};
}
const quiet=()=>refreshFreePackCounts().catch(e=>console.warn('[free-packs] balance unavailable:',e.message));
document.getElementById('menu-shop')?.addEventListener('click',quiet);
window.addEventListener('echo:shop-balance-refresh',quiet);
document.addEventListener('echo:auth-changed',()=>{
 version++;counts.coin=0;counts.premium=0;render();
 if(!document.getElementById('menu-shop-screen')?.hidden)quiet();
});
document.addEventListener('echo:language-changed',render);
window.addEventListener('echo:language-changed',render);
render();

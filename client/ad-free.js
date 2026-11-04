// Server-authorized, one-time ECHO ad-free purchase (not a renewable subscription).
// Payment success is accepted ONLY after the provider-signed server callback.
const STATUS_URL='/echo/api/ad-free/status';
const VK_SKU='2', ROBO_PENDING_KEY='echo.adFreePendingOrder';
let cached=null, busy=false, reconcileBusy=false;
const token=()=>localStorage.getItem('echo.authToken');
const vkPlatform=()=>window.isVKMiniApp===true || new URLSearchParams(location.search).has('vk_app_id');
const english=()=>document.documentElement.lang?.startsWith('en');
const tr=(ru,en)=>english()?en:ru;
const toast=text=>window.ECHOToast?.show(text);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function notify(active){
 document.dispatchEvent(new CustomEvent('echo:ad-free-changed',{detail:{active}}));
 const button=document.getElementById('echo-ad-free-buy');
 if(button){
  button.classList.toggle('is-owned',active);
  button.setAttribute('aria-label',active?tr('Без рекламы куплено','Ad-free purchased'):tr('Купить без рекламы','Buy ad-free'));
  const title=button.querySelector('.echo-ad-free-caption');
  if(title)title.textContent=active?tr('Куплено','Purchased'):tr('Без рекламы','No ads');
 }
}
export async function hasAdFree(force=false){
 const current=token();
 if(!current){cached=null;notify(false);return false;}
 if(!force&&cached?.token===current&&Date.now()-cached.at<15000)return cached.active;
 const response=await fetch(STATUS_URL,{headers:{Authorization:'Bearer '+current},cache:'no-store'});
 if(!response.ok)throw Error('status '+response.status);
 const data=await response.json();
 if(token()!==current)return false;
 const active=data.active===true;
 cached={token:current,active,at:Date.now()};
 notify(active);
 return active;
}
export async function refreshAdFree(){try{return await hasAdFree(true);}catch(e){console.warn('[ECHO ad-free] status:',e.message);return false;}}
async function serverPost(path,auth){
 const response=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:'{}'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(response.status===401?'auth':response.status===409?'owned':response.status===503?'unavailable':'payment');
 return data;
}
async function pollVK(intentId,auth){
 for(let i=0;i<30;i++){
  if(token()!==auth)return false;
  const response=await fetch('/echo/api/payments/vk/intent/'+encodeURIComponent(intentId),
   {headers:{Authorization:'Bearer '+auth},cache:'no-store'});
  if(!response.ok)throw Error('verification');
  const state=await response.json();
  if(state.status==='paid')return true;
  if(state.status!=='pending')break;
  await pause(1000);
 }
 return false;
}
async function purchaseVK(auth){
 if(!window.vkBridge?.send)throw Error('unavailable');
 const intent=await serverPost('/echo/api/payments/vk/intent-ad-free',auth);
 if(intent.item!==VK_SKU||!intent.intentId||intent.price!==100)throw Error('verification');
 const result=await window.vkBridge.send('VKWebAppShowOrderBox',{type:'item',item:VK_SKU});
 if(result?.status&&result.status!=='success'&&result.status!=='paid')return;
 toast(tr('Проверяем оплату VK…','Verifying VK payment…'));
 if(await pollVK(intent.intentId,auth)&&await hasAdFree(true)){
  toast(tr('Реклама отключена навсегда!','Ads disabled permanently!'));return;
 }
 toast(tr('Платёж обрабатывается. Доступ появится после подтверждения VK.','Payment pending. Access will activate when VK confirms it.'));
}
async function purchaseRobokassa(auth){
 const order=await serverPost('/echo/api/payments/robokassa/create-ad-free',auth);
 const url=new URL(order.checkoutUrl);
 if(url.protocol!=='https:'||url.hostname!=='auth.robokassa.ru'||
  !/^[1-9]\d{0,17}$/.test(String(order.orderId))||Number(order.price)!==490)throw Error('verification');
 localStorage.setItem(ROBO_PENDING_KEY,String(order.orderId));
 window.location.assign(url.toString());
}
export async function buyAdFree(){
 if(busy)return;
 if(!token()){toast(tr('Для покупки войдите в аккаунт ECHO.','Sign in to ECHO to purchase.'));return;}
 busy=true;
 try{
  if(await hasAdFree(true)){toast(tr('Реклама уже отключена для этого аккаунта.','Ads are already disabled for this account.'));return;}
  const isVK=vkPlatform();
  const yes=await window.ECHOModal?.confirm({
   title:tr('БЕЗ РЕКЛАМЫ','NO ADS'),
   text:tr('Больше никакой рекламы!\nРекламные задания выполняются автоматически!',
      'No more ads!\nRewarded tasks complete automatically!'),
   cancelText:tr('НЕТ','NO'),
   confirmText:isVK?tr('КУПИТЬ 100 ГОЛОСОВ VK','BUY 100 VK VOTES'):
    tr('КУПИТЬ 490 ₽','BUY 490 RUB'),
   modalClass:'echo-ad-free-confirm'
  });
  if(!yes)return;
  const auth=token();
  if(isVK)await purchaseVK(auth);
  else await purchaseRobokassa(auth);
 }catch(error){
  console.warn('[ECHO ad-free] payment:',error.message);
  if(error.message==='owned')await refreshAdFree();
  else toast(error.message==='auth'?tr('Войдите в аккаунт ECHO.','Sign in to ECHO.'):
   tr('Не удалось запустить оплату. Попробуйте позже.','Unable to start payment. Try again later.'));
 }finally{busy=false;}
}
async function reconcile(){
 if(reconcileBusy||!token())return;
 const id=localStorage.getItem(ROBO_PENDING_KEY);
 if(!id||!/^[1-9]\d{0,17}$/.test(id))return;
 reconcileBusy=true;
 try{
  const auth=token();
  for(let i=0;i<30;i++){
   if(token()!==auth||localStorage.getItem(ROBO_PENDING_KEY)!==id)break;
   const r=await fetch('/echo/api/payments/robokassa/status/'+encodeURIComponent(id),
    {headers:{Authorization:'Bearer '+auth},cache:'no-store'});
   if(r.status===404){localStorage.removeItem(ROBO_PENDING_KEY);break;}
   if(!r.ok)break;
   const result=await r.json();
   if(result.status==='paid'&&result.product==='ad_free'){
    localStorage.removeItem(ROBO_PENDING_KEY);
    if(await hasAdFree(true))toast(tr('Реклама отключена навсегда!','Ads disabled permanently!'));
    break;
   }
   if(result.status!=='pending')break;
   await pause(1500);
  }
 }catch(error){console.warn('[ECHO ad-free] reconcile:',error.message)}
 finally{reconcileBusy=false;}
}
// The custom artwork is optional until buttonads.webp has been committed.
// Avoid a broken-image tile by retaining the existing SVG/text fallback.
const adFreeArt=document.querySelector('#echo-ad-free-buy .echo-ad-free-image');
if(adFreeArt){
 const button=adFreeArt.closest('#echo-ad-free-buy');
 const updateArt=()=>button?.classList.toggle('has-art',adFreeArt.naturalWidth>0);
 adFreeArt.addEventListener('load',updateArt);
 adFreeArt.addEventListener('error',()=>button?.classList.remove('has-art'));
 if(adFreeArt.complete)updateArt();
}
window.ECHOAdFree={hasAdFree,refreshAdFree,buyAdFree};
document.querySelector('#echo-ad-free-buy')?.addEventListener('click',buyAdFree);
document.addEventListener('echo:auth-changed',()=>{cached=null;void refreshAdFree();void reconcile();});
window.addEventListener('focus',()=>{void refreshAdFree();void reconcile();});
window.addEventListener('pageshow',()=>{void refreshAdFree();void reconcile();});
window.addEventListener('echo:robokassa-returned',()=>{void reconcile();});
void refreshAdFree();
void reconcile();
if(new URLSearchParams(location.search).get('adfree')==='1'){
 let opened=false;
 const open=()=>{if(opened||!token()||!window.ECHOModal)return;opened=true;void buyAdFree();};
 document.addEventListener('echo:auth-changed',open);
 setTimeout(open,1600);
}

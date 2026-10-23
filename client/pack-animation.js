// ECHO: finger-controlled animated WebP. This is frame scrubbing, NOT autonomous playback.
import {cachedFreePackCount,refreshFreePackCounts,setFreePackRemaining} from './free-packs-ui.js?v=echo-free-packs-1';
const root=document.querySelector('#echo-pack-3d');
if(root){
 const canvas=root.querySelector('#echo-pack-3d-canvas'),ctx=canvas.getContext('2d',{alpha:false});
 const tip=root.querySelector('#echo-pack-3d-hint'),bar=root.querySelector('#echo-pack-3d-bar');
 const closeButton=root.querySelector('#echo-pack-3d-close'),resetButton=root.querySelector('#echo-pack-3d-reset');
 const handle=root.querySelector('#echo-pack-tear-handle');
 let hintTimer=null,toastTimer=null,hintIndex=0,packType='coin',awardedCards=null,purchaseBusy=false;
 const tr=(key,fallback)=>window.$t?.('menu:'+key,fallback)??fallback;
 const hints=['pack_hint_0','pack_hint_1','pack_hint_2','pack_hint_3','pack_hint_4'];
 function showHint(message){clearTimeout(toastTimer);tip.textContent=message;tip.classList.remove('is-left','is-right');tip.classList.add(hintIndex%2===0?'is-left':'is-right');tip.classList.add('is-visible');toastTimer=setTimeout(()=>tip.classList.remove('is-visible'),2600);}
 function beginHints(){clearInterval(hintTimer);hintIndex=0;showHint(tr(hints[0],'Открой пак! ✨'));hintTimer=setInterval(()=>{if(!root.hidden&&progress<1){hintIndex++;showHint(tr(hints[hintIndex%hints.length],''));}},5500);}
 const source='./assets/packs/basiccard.webp';
 let decoder=null,frames=1,progress=0,active=false,busy=false,wanted=-1,shown=-1,down=false,lastX=0;
 let generation=0,frameWidth=2,frameHeight=3,fanTriggered=false;
 const cache=new Map(),MAX_CACHE=14;
 function resize(){
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;draw();}
 }
 function draw(){
  const w=canvas.width,h=canvas.height;
  ctx.fillStyle='#07101e';ctx.fillRect(0,0,w,h);
  const frame=cache.get(shown);
  if(!frame)return;
  const scale=Math.min(w/frameWidth,h/frameHeight);
  const dw=frameWidth*scale,dh=frameHeight*scale;
  ctx.drawImage(frame,(w-dw)/2,(h-dh)/2,dw,dh);
 }
 function info(message){tip.textContent=message}
 function updateUI(){
  bar.style.width=(progress*100).toFixed(1)+'%';
  handle.style.left=(13+progress*74)+'%';
  handle.hidden=progress>=1;
  if(progress>=1){resetButton.hidden=false;clearInterval(hintTimer);if(!fanTriggered){fanTriggered=true;showHint(tr('pack_hint_done','Пак открыт! 🎉'));window.dispatchEvent(new CustomEvent('echo:pack-opened',{detail:{type:packType}}));}}
 }
 function requestFrame(){
  if(!active||!decoder)return;
  wanted=Math.max(0,Math.min(frames-1,Math.round(progress*(frames-1))));
  if(cache.has(wanted)){shown=wanted;draw();return;}
  pump();
 }
 async function pump(){
  if(busy||!active||!decoder)return;
  busy=true;const token=generation;
  try{
   while(active&&token===generation&&!cache.has(wanted)){
    const index=wanted;
    const result=await decoder.decode({frameIndex:index,completeFramesOnly:true});
    const bitmap=result.image;
    if(token!==generation){bitmap.close();break;}
    frameWidth=bitmap.displayWidth;frameHeight=bitmap.displayHeight;
    cache.set(index,bitmap);
    // Preserve the opening frame and a small sliding window for mobile memory.
    while(cache.size>MAX_CACHE){
     const candidate=[...cache.keys()].find(k=>k!==0&&k!==wanted);
     if(candidate===undefined)break;
     cache.get(candidate).close();cache.delete(candidate);
    }
    if(index===wanted){shown=index;draw();}
   }
  }catch(err){console.warn('[Echo Pack] WebP frame decode failed:',err);info(tr('pack_decode_failed','Не удалось прочитать кадр WebP. Проверь анимацию и обнови страницу.'));}
  finally{busy=false;if(active&&token===generation&&wanted>=0&&!cache.has(wanted))queueMicrotask(pump);}
 }
 async function prepare(){
  if(decoder){active=true;requestFrame();return;}
  if(typeof ImageDecoder==='undefined'){
   info(tr('pack_decoder_unsupported','Для покадрового открытия нужен браузер с поддержкой ImageDecoder (например, Chrome).'));return;
  }
  const token=++generation;
  try{
   info(tr('pack_loading','Загружаем кадры упаковки…'));
   const response=await fetch(source,{cache:'force-cache'});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const bytes=await response.arrayBuffer();
   if(token!==generation)return;
   const next=new ImageDecoder({data:new Uint8Array(bytes),type:'image/webp',preferAnimation:true});
   await next.tracks.ready;
   if(token!==generation){next.close();return;}
   const track=next.tracks.selectedTrack;
   if(!track||!Number.isInteger(track.frameCount)||track.frameCount<2){
    next.close();throw new Error('basiccard.webp is not recognized as animated WebP');
   }
   decoder=next;frames=track.frameCount;active=true;requestFrame();updateUI();
  }catch(err){console.warn('[Echo Pack] Animation init failed',err);info(tr('pack_init_failed','Анимированный WebP не удалось открыть покадрово.'));}
 }
 function reset(){window.dispatchEvent(new Event('echo:pack-reset'));fanTriggered=false;progress=0;down=false;shown=cache.has(0)?0:-1;resetButton.hidden=true;window.dispatchEvent(new CustomEvent('echo:pack-prepare',{detail:{type:packType,cards:awardedCards}}));updateUI();requestFrame();beginHints();}
 function showAwardedPack(type,cards){
  awardedCards=cards;
  packType=type;
  root.hidden=false;
  reset();resize();prepare();
  window.dispatchEvent(new Event('echo:shop-balance-refresh'));
  window.dispatchEvent(new Event('echo:hero-collection-refresh'));
 }
 function isVKPurchasePlatform(){
  return window.isVKMiniApp===true || new URLSearchParams(location.search).has('vk_app_id');
 }
 async function checkPaymentStatus(intentId,token){
  const response=await fetch('/echo/api/payments/vk/intent/'+encodeURIComponent(intentId),{
   headers:{Authorization:'Bearer '+token},cache:'no-store'
  });
  if(!response.ok)throw new Error(response.status===401?'auth':'payment_status');
  return response.json();
 }
 async function waitForVKPayment(intentId,token){
  for(let attempt=0;attempt<20;attempt++){
   const result=await checkPaymentStatus(intentId,token);
   if(result.status==='paid' && Array.isArray(result.cards) && result.cards.length===5)
    return result.cards;
   if(result.status!=='pending')throw new Error('payment_status');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  return null;
 }
 const ROBO_ORDER_KEY='echo.robokassaPendingOrder';
 let roboChecking=false;
 async function checkRobokassaStatus(orderId,token){
  const r=await fetch('/echo/api/payments/robokassa/status/'+encodeURIComponent(orderId),{
   headers:{Authorization:'Bearer '+token},cache:'no-store'
  });
  if(!r.ok)throw new Error(r.status===401?'auth':r.status===404?'missing':'status');
  return r.json();
 }
 async function reconcileRobokassa(){
  if(roboChecking)return;
  const id=localStorage.getItem(ROBO_ORDER_KEY);
  const token=localStorage.getItem('echo.authToken');
  if(!token||!id||!/^[1-9]\d{0,17}$/.test(id))return;
  roboChecking=true;
  try{
   for(let i=0;i<90;i++){
    if(localStorage.getItem(ROBO_ORDER_KEY)!==id ||
       localStorage.getItem('echo.authToken')!==token)break;
    const data=await checkRobokassaStatus(id,token);
    if(data.status==='paid'&&Array.isArray(data.cards)&&data.cards.length===5){
     localStorage.removeItem(ROBO_ORDER_KEY);
     showAwardedPack('premium',data.cards);
     window.ECHOToast?.show(tr('pack_payment_verified','Оплата подтверждена. Карты получены!'));
     return;
    }
    if(data.status!=='pending')break;
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
  }catch(error){
   if(error.message==='missing'||error.message==='auth'){
    localStorage.removeItem(ROBO_ORDER_KEY);
   }
   console.warn('[ECHO Robokassa] status check unavailable',error.message);
  }finally{roboChecking=false;}
 }
 async function buyRobokassaPack(token){
  purchaseBusy=true;
  const button=document.querySelector('[data-echo-preview-pack="premium"]');
  if(button)button.disabled=true;
  try{
   const response=await fetch('/echo/api/payments/robokassa/create',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:'{}'
   });
   if(!response.ok)throw new Error(response.status===503?'not_configured':
    response.status===401?'auth':'server');
   const order=await response.json();
   const url=new URL(order.checkoutUrl);
   if(url.protocol!=='https:'||url.hostname!=='auth.robokassa.ru'||
      !/^[1-9]\d{0,17}$/.test(String(order.orderId)))throw new Error('invalid_url');
   localStorage.setItem(ROBO_ORDER_KEY,String(order.orderId));
   // ECHO Android intercepts gateway navigation into an in-app payment view.
   // In a regular browser the same URL opens normally; pending ID survives.
   window.location.assign(url.toString());
   void reconcileRobokassa();
  }catch(error){
   window.ECHOToast?.show(error.message==='not_configured'
    ?tr('pack_payment_pending','Оплата через сайт пока не подключена')
    :error.message==='auth'?tr('pack_login_required','Для покупки пака войдите в аккаунт')
    :tr('pack_payment_error','Не удалось создать оплату. Попробуйте позже.'));
  }finally{
   purchaseBusy=false;
   if(button)button.disabled=false;
  }
 }
 // A browser reload after returning from the gateway can pick up a
 // server-confirmed order and show the original animated premium pack.
 window.addEventListener('pageshow',()=>{void reconcileRobokassa();});
 window.addEventListener('focus',()=>{void reconcileRobokassa();});
 window.addEventListener('echo:robokassa-returned',()=>{void reconcileRobokassa();});
 document.addEventListener('echo:auth-changed',event=>{
  if(event.detail?.authenticated)void reconcileRobokassa();
 });
 if(localStorage.getItem(ROBO_ORDER_KEY))setTimeout(()=>void reconcileRobokassa(),1500);
 async function buyPremiumPack(token){
  if(!isVKPurchasePlatform()){
   await buyRobokassaPack(token);
   return;
  }
  if(!window.vkBridge?.send){
   window.ECHOToast?.show(tr('pack_vk_unavailable','VK Bridge недоступен. Перезапустите приложение.'));
   return;
  }
  purchaseBusy=true;
  const button=document.querySelector('[data-echo-preview-pack="premium"]');
  if(button)button.disabled=true;
  let intentId=null;
  try{
   const response=await fetch('/echo/api/payments/vk/intent',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}
   });
   if(!response.ok)throw new Error(response.status===401?'auth':response.status===503?'not_configured':'server');
   const intent=await response.json();
   if(!intent.intentId || intent.item!=='1')throw new Error('server');
   intentId=intent.intentId;
   // VK's native vote purchase UI. Only the signed server callback grants cards.
   const result=await window.vkBridge.send('VKWebAppShowOrderBox',{type:'item',item:'1'});
   if(result?.status && result.status!=='success' && result.status!=='paid'){
    window.ECHOToast?.show(tr('pack_payment_cancelled','Покупка отменена'));
    return;
   }
   window.ECHOToast?.show(tr('pack_payment_verifying','Проверяем оплату VK…'));
   const cards=await waitForVKPayment(intentId,token);
   if(!cards){
    window.ECHOToast?.show(tr('pack_payment_waiting','Оплата обрабатывается. Карточки будут зачислены после подтверждения VK.'));
    return;
   }
   showAwardedPack('premium',cards);
  }catch(error){
   console.warn('[ECHO VK purchase] unavailable:',error);
   if(intentId && error?.error_type?.includes?.('CANCEL')){
    window.ECHOToast?.show(tr('pack_payment_cancelled','Покупка отменена'));
   }else{
    window.ECHOToast?.show(error.message==='auth'?tr('pack_login_required','Для покупки пака войдите в аккаунт'):
     error.message==='not_configured'?tr('pack_payment_pending','Оплата VK пока не настроена'):
     tr('pack_payment_error','Не удалось подтвердить оплату. Если голоса списались, проверьте коллекцию персонажей.'));
   }
  }finally{
   purchaseBusy=false;
   if(button)button.disabled=false;
  }
 }
 async function open(type='coin'){
  if(purchaseBusy)return;
  const token=localStorage.getItem('echo.authToken');
  if(!token){window.ECHOToast?.show(tr('pack_login_required','Для покупки пака войдите в аккаунт'));return;}
  purchaseBusy=true;
  const button=document.querySelector('[data-echo-preview-pack="'+type+'"]');
  if(button)button.disabled=true;
  try{
   // Check the server before every purchase. Free inventory always takes
   // precedence over money; missing inventory must never initiate payment.
   const wasFree=cachedFreePackCount(type)>0;
   const inventory=await refreshFreePackCounts();
   if(inventory[type]>0){
    const response=await fetch('/echo/api/packs/free/open',{
     method:'POST',
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:JSON.stringify({packType:type})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
     if(response.status===409){setFreePackRemaining(type,0);throw new Error('free_packs_empty');}
     throw new Error(response.status===401?'auth':'free_packs_failed');
    }
    if(!Array.isArray(data.cards)||data.cards.length!==5||!Number.isInteger(data.remaining))
     throw new Error('free_packs_failed');
    setFreePackRemaining(type,data.remaining);
    showAwardedPack(type,data.cards);
    return;
   }
   // A free pack may have just been used from another tab: never charge
   // ECHO Coins or VK votes for a click that appeared to be free.
   if(wasFree)throw new Error('free_packs_empty');
   if(type==='premium'){
    purchaseBusy=false;
    if(button)button.disabled=false;
    await buyPremiumPack(token);
    return;
   }
   const response=await fetch('/echo/api/packs/coin/open',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(response.status===409?'coins':response.status===401?'auth':'server');
   if(!Array.isArray(data.cards)||data.cards.length!==5)throw new Error('server');
   showAwardedPack('coin',data.cards);
  }catch(error){
   console.warn('[ECHO packs] opening unavailable:',error);
   const messages={
    coins:tr('pack_not_enough_coins','Недостаточно ECHO Coin'),
    auth:tr('pack_login_required','Для покупки пака войдите в аккаунт'),
    free_packs_empty:tr('pack_free_empty','Бесплатные паки закончились. Обновите магазин.'),
    free_packs_status:tr('pack_free_unavailable','Не удалось проверить бесплатные паки. Попробуйте ещё раз.'),
    free_packs_failed:tr('pack_free_failed','Не удалось открыть бесплатный пак.')
   };
   window.ECHOToast?.show(messages[error.message]||tr('pack_buy_failed','Не удалось купить пак'));
  }finally{purchaseBusy=false;if(button)button.disabled=false;}
 }
 function close(){window.dispatchEvent(new Event('echo:pack-closed'));awardedCards=null;root.hidden=true;down=false;active=false;clearInterval(hintTimer);clearTimeout(toastTimer);}
 document.querySelectorAll('[data-echo-preview-pack]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.echoPreviewPack)));
 closeButton.addEventListener('click',close);
 let repeatConfirming=false;
 resetButton.addEventListener('click',async()=>{
  if(repeatConfirming||purchaseBusy||root.hidden)return;
  repeatConfirming=true;
  try{
   const inventory=await refreshFreePackCounts();
   const hasFree=inventory[packType]>0;
   const isVk=isVKPurchasePlatform();
   const premiumPrice=isVk?tr('pack_price_votes','40 голосов VK'):tr('pack_price_rubles','250 ₽');
   const packName=packType==='premium'?tr('pack_name_premium','элитный пак'):tr('pack_name_coin','обычный пак');
   const price=packType==='premium'?premiumPrice:tr('pack_price_coin','50 ECHO Coin');
   const text=hasFree
    ?tr('pack_repeat_free_confirm','Вы уверены, что хотите бесплатно открыть {pack}?').replace('{pack}',packName)
    :tr('pack_repeat_confirm','Вы уверены, что хотите приобрести {pack} за {price}?').replace('{pack}',packName).replace('{price}',price);
   const approved=await window.ECHOModal?.confirm({
    title:hasFree?tr('pack_free_open','Открыть'):tr('pack_repeat_title','Покупка пака'),
    text,
    cancelText:tr('no','Нет'),confirmText:tr('yes','Да')
   });
   if(!approved||root.hidden)return;
   // Every accepted repeat starts a NEW verified purchase, never replays old rewards.
   await open(packType);
  }finally{repeatConfirming=false;}
 });
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)close()});
 // Tear can start only on the blue handle, not anywhere on the canvas.
 handle.addEventListener('pointerdown',e=>{
  if(root.hidden||!active||progress>=1)return;
  down=true;lastX=e.clientX;handle.setPointerCapture(e.pointerId);e.preventDefault();showHint(tr('pack_hint_drag','Тяни вправо! 👉'));
 });
 handle.addEventListener('pointermove',e=>{
  if(!down)return;
  const rect=root.querySelector('.echo-pack-view').getBoundingClientRect();
  const dx=e.clientX-lastX;lastX=e.clientX;
  progress=Math.max(progress,Math.min(1,progress+dx/Math.max(60,rect.width*.74)));
  requestFrame();updateUI();e.preventDefault();
 });
 const release=()=>{down=false};
 handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);
 document.addEventListener('echo:language-changed',()=>{if(!root.hidden)showHint(progress>=1?tr('pack_hint_done','Пак открыт! 🎉'):tr(hints[hintIndex%hints.length],''));});
 window.addEventListener('resize',resize);
}

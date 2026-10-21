// ECHO: finger-controlled animated WebP. This is frame scrubbing, NOT autonomous playback.
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
 async function buyPremiumPack(token){
  if(!isVKPurchasePlatform()){
   window.ECHOToast?.show(tr('pack_payment_pending','Оплата через сайт пока не подключена'));
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
   if(!intent.intentId || !intent.item)throw new Error('server');
   intentId=intent.intentId;
   // VK's native vote purchase UI. Only the signed server callback grants cards.
   const result=await window.vkBridge.send('VKWebAppShowOrderBox',{type:'item',item:intent.item});
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
  if(type==='premium'){await buyPremiumPack(token);return;}
  purchaseBusy=true;
  const button=document.querySelector('[data-echo-preview-pack="coin"]');
  if(button)button.disabled=true;
  try{
    const response=await fetch('/echo/api/packs/coin/open',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(response.status===409?'coins':response.status===401?'auth':'server');
    if(!Array.isArray(data.cards)||data.cards.length!==5)throw new Error('server');
    showAwardedPack('coin',data.cards);
  }catch(error){
    console.warn('[ECHO packs] Purchase unavailable:',error);
    window.ECHOToast?.show(error.message==='coins'?tr('pack_not_enough_coins','Недостаточно ECHO Coin'):error.message==='auth'?tr('pack_login_required','Для покупки пака войдите в аккаунт'):tr('pack_buy_failed','Не удалось купить пак'));
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
   const isVk=isVKPurchasePlatform();
   const premiumPrice=isVk?tr('pack_price_votes','40 голосов VK'):tr('pack_price_rubles','250 ₽');
   const packName=packType==='premium'?tr('pack_name_premium','элитный пак'):tr('pack_name_coin','обычный пак');
   const price=packType==='premium'?premiumPrice:tr('pack_price_coin','50 ECHO Coin');
   const approved=await window.ECHOModal?.confirm({
    title:tr('pack_repeat_title','Покупка пака'),
    text:tr('pack_repeat_confirm','Вы уверены, что хотите приобрести {pack} за {price}?').replace('{pack}',packName).replace('{price}',price),
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

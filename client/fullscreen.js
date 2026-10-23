// Browser fullscreen toggle, triggered by a direct user gesture.
const button=document.getElementById('echo-fullscreen-toggle');
const game=document.getElementById('game');
const allowFullscreenButton=!window.isVKMobileMiniApp;
const preferenceKey='echo.fullscreenWanted';
const t=(key,fallback)=>window.$t?.('game:'+key,fallback)||fallback;
function sync(){
 const active=Boolean(document.fullscreenElement||document.webkitFullscreenElement);
 button?.classList.toggle('is-fullscreen',active);
 button?.setAttribute('aria-label',active?t('fullscreen_exit','Выйти из полноэкранного режима'):t('fullscreen_enter','На весь экран'));
 button?.setAttribute('title',active?t('fullscreen_exit','Выйти из полноэкранного режима'):t('fullscreen_enter','На весь экран'));
}
if(allowFullscreenButton) button?.addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement||document.webkitFullscreenElement){
   const exit=document.exitFullscreen||document.webkitExitFullscreen;
   if(!exit)throw new Error('Unsupported fullscreen exit');
   sessionStorage.setItem(preferenceKey,'0');
   await exit.call(document);
  }else{
   const enter=game.requestFullscreen||game.webkitRequestFullscreen;
   if(!enter)throw new Error('Unsupported fullscreen request');
   await enter.call(game);
   sessionStorage.setItem(preferenceKey,'1');
  }
 }catch(error){
  console.warn('[echo fullscreen]',error);
  window.ECHOToast?.show(t('fullscreen_unavailable','Полноэкранный режим недоступен в этом браузере'));
 }
 sync();
});
document.addEventListener('fullscreenchange',sync);
document.addEventListener('webkitfullscreenchange',sync);
sync();

// Reloading the document exits browser fullscreen by design. Browsers require
// a fresh user activation to enter it again; reuse the first battle gesture.
if(allowFullscreenButton && sessionStorage.getItem(preferenceKey)==='1'){
 const restore=(event)=>{
  if(!game?.classList.contains('echo-in-battle'))return;
  if(document.fullscreenElement||document.webkitFullscreenElement)return;
  const enter=game.requestFullscreen||game.webkitRequestFullscreen;
  if(!enter)return;
  try{Promise.resolve(enter.call(game)).catch(error=>console.warn('[echo fullscreen restore]',error));}
  catch(error){console.warn('[echo fullscreen restore]',error);}
 };
 game?.addEventListener('pointerdown',restore,{once:true,capture:true});
 game?.addEventListener('keydown',restore,{once:true,capture:true});
}

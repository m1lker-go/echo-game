// Browser fullscreen toggle, triggered by a direct user gesture.
const button=document.getElementById('echo-fullscreen-toggle');
const game=document.getElementById('game');
const t=(key,fallback)=>window.$t?.('game:'+key,fallback)||fallback;
function sync(){
 const active=Boolean(document.fullscreenElement||document.webkitFullscreenElement);
 button?.classList.toggle('is-fullscreen',active);
 button?.setAttribute('aria-label',active?t('fullscreen_exit','Выйти из полноэкранного режима'):t('fullscreen_enter','На весь экран'));
 button?.setAttribute('title',active?t('fullscreen_exit','Выйти из полноэкранного режима'):t('fullscreen_enter','На весь экран'));
}
button?.addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement||document.webkitFullscreenElement){
   const exit=document.exitFullscreen||document.webkitExitFullscreen;
   if(!exit)throw new Error('Unsupported fullscreen exit');
   await exit.call(document);
  }else{
   const enter=game.requestFullscreen||game.webkitRequestFullscreen;
   if(!enter)throw new Error('Unsupported fullscreen request');
   await enter.call(game);
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

// Fullscreen for supporting browsers, and an actionable iPhone Safari alternative.
// WebKit on iPhone does not allow arbitrary HTML content to request fullscreen.
const button=document.getElementById('echo-fullscreen-toggle');
const game=document.getElementById('game');
const allowFullscreenButton=!window.isVKMobileMiniApp;
const preferenceKey='echo.fullscreenWanted';
const t=(key,fallback)=>window.$t?.('game:'+key,fallback)||fallback;
const isIPhone=/iPhone|iPod/i.test(navigator.userAgent);
const isInstalledWebApp=()=>navigator.standalone===true ||
  window.matchMedia?.('(display-mode: standalone)')?.matches===true ||
  window.matchMedia?.('(display-mode: fullscreen)')?.matches===true;
const fullscreenElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
const enterFullscreen=()=>game?.requestFullscreen||game?.webkitRequestFullscreen;
function showIPhoneInstructions(){
 const instructions=document.createElement('div');
 instructions.className='echo-ios-fullscreen-help';
 for(const message of [
  t('fullscreen_ios_step_one','Открой ECHO в Safari (не внутри ВКонтакте).'),
  t('fullscreen_ios_step_two','Нажми «Поделиться» → «На экран Домой».'),
  t('fullscreen_ios_step_three','Включи «Открыть как веб-приложение» и нажми «Добавить».'),
  t('fullscreen_ios_step_four','Запускай ECHO с новой иконки — без адресной строки Safari.')
 ]){
  const line=document.createElement('p');
  line.textContent=message;
  instructions.append(line);
 }
 if(window.ECHOModal?.open){
  window.ECHOModal.open({
   title:t('fullscreen_ios_title','НА ВЕСЬ ЭКРАН НА IPHONE'),
   contentElement:instructions,
   buttons:[{label:t('fullscreen_ios_close','ПОНЯТНО'),value:true,variant:'primary'}]
  });
 }else{
  window.ECHOToast?.show(t('fullscreen_ios_step_two','Нажми «Поделиться» → «На экран Домой».'));
 }
}
function sync(){
 const nativeActive=Boolean(fullscreenElement());
 const installed=isIPhone&&isInstalledWebApp();
 // Standalone iOS web apps already have no Safari toolbar. Never offer a
 // non-functional "exit fullscreen" control in this state.
 if(button)button.hidden=Boolean(installed);
 button?.classList.toggle('is-fullscreen',nativeActive);
 const iosHelp=isIPhone&&!installed&&!enterFullscreen();
 const label=nativeActive?t('fullscreen_exit','Выйти из полноэкранного режима')
  :iosHelp?t('fullscreen_ios_button','Как играть без панелей Safari')
  :t('fullscreen_enter','На весь экран');
 button?.setAttribute('aria-label',label);
 button?.setAttribute('title',label);
}
if(allowFullscreenButton) button?.addEventListener('click',async()=>{
 if(!game)return;
 try{
  if(fullscreenElement()){
   const exit=document.exitFullscreen||document.webkitExitFullscreen;
   if(!exit)throw new Error('Unsupported fullscreen exit');
   sessionStorage.setItem(preferenceKey,'0');
   await exit.call(document);
  }else{
   const enter=enterFullscreen();
   if(!enter){
    if(isIPhone&&!isInstalledWebApp())showIPhoneInstructions();
    else window.ECHOToast?.show(t('fullscreen_unavailable','Полноэкранный режим недоступен в этом браузере'));
    return;
   }
   await enter.call(game);
   sessionStorage.setItem(preferenceKey,'1');
  }
 }catch(error){
  console.warn('[echo fullscreen]',error);
  if(isIPhone&&!isInstalledWebApp()&&!fullscreenElement())showIPhoneInstructions();
  else window.ECHOToast?.show(t('fullscreen_unavailable','Полноэкранный режим недоступен в этом браузере'));
 }
 sync();
});
document.addEventListener('fullscreenchange',sync);
document.addEventListener('webkitfullscreenchange',sync);
window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change',sync);
sync();

// Fullscreen is exited on document reload; browsers require a new user gesture.
// iPhone Safari does not support this API, so do not install a fake restore.
if(allowFullscreenButton && typeof enterFullscreen()==='function' && sessionStorage.getItem(preferenceKey)==='1'){
 const restore=()=>{
  if(!game?.classList.contains('echo-in-battle'))return;
  if(fullscreenElement())return;
  const enter=enterFullscreen();
  if(!enter)return;
  try{Promise.resolve(enter.call(game)).catch(error=>console.warn('[echo fullscreen restore]',error));}
  catch(error){console.warn('[echo fullscreen restore]',error);}
 };
 game?.addEventListener('pointerdown',restore,{once:true,capture:true});
 game?.addEventListener('keydown',restore,{once:true,capture:true});
}

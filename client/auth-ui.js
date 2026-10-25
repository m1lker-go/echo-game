const t=(key,fallback)=>window.$t?.('menu:'+key,fallback)||fallback;
const guest=document.querySelector('#echo-auth-guest');
const panel=document.querySelector('#echo-auth-user');
const status=document.querySelector('#echo-auth-status');
let loginWidget=null;
let loginError=null;
const oauthButtons=new Map();
const oauthLabels={google:['Войти через Google','Связать с Google'],yandex:['Войти через Яндекс','Связать с Яндексом']};
function oauthButton(provider,link){
 const button=document.createElement('button');
 button.type='button';
 button.className='echo-oauth-button echo-oauth-'+provider;
 button.hidden=isVKMiniApp;
 const accessibleName=oauthLabels[provider][link?1:0];
 button.setAttribute('aria-label',accessibleName);
 button.title=accessibleName;
 if(provider==='yandex'){
  const mark=document.createElement('span');
  mark.className='echo-oauth-icon-yandex';
  mark.textContent='Я';
  mark.setAttribute('aria-hidden','true');
  button.append(mark);
 }else{
  // Inline multicolour Google G: no external icon request or brand-font dependency.
  button.innerHTML=`<svg class="echo-oauth-icon-google" width="32" height="32" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
   <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 5.38 6.51 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/>
   <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.27 5.48-4.8 7.18l7.73 6C44.38 38.03 46.98 31.87 46.98 24.55Z"/>
   <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1-.75-4.59c0-1.59.27-3.13.74-4.59l-7.98-6.19A23.86 23.86 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/>
   <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
  </svg>`;
 }
 button.addEventListener('click',()=>void startOAuth(provider,link));
 oauthButtons.set(provider+(link?':link':':login'),button);
 return button;
}
async function updateOAuthButtons(){
 // Always show the options outside VK Mini Apps, even while credentials
 // have not yet reached the running server. Hidden options previously made
 // setup failures impossible for players to diagnose.
 try{
  const config=await request('config');
  for(const provider of ['google','yandex']){
   const ready=config[provider+'Enabled']===true;
   for(const suffix of [':login',':link']){
    const button=oauthButtons.get(provider+suffix);
    if(!button)continue;
    button.hidden=isVKMiniApp;
    button.dataset.configured=String(ready);
    button.title=ready?oauthLabels[provider][suffix===':link'?1:0]:(provider==='google'?'Google':'Яндекс')+' пока не активирован на сервере ECHO';
   }
  }
 }catch(error){
  console.warn('[echo oauth] availability unavailable',error);
  // Let the server return a normal error when the player attempts to sign in.
 }
}
async function finishOAuth(){
 try{
  const account=await request('oauth/complete',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({platform:'web'})
  });
  if(!/^[a-f0-9]{64}$/.test(account?.token||''))throw new Error('Invalid ECHO token');
  token=account.token;localStorage.setItem(key,token);
  await refresh();
  window.ECHOModal?.close();
  window.ECHOToast?.show('Вы вошли в ECHO');
 }catch(error){
  console.error('[echo oauth] completion failed',error);
  window.ECHOToast?.show('Не удалось завершить вход. Попробуй снова.');
 }
}
async function startOAuth(provider,link=false){
 if(isVKMiniApp)return;
 const button=oauthButtons.get(provider+(link?':link':':login'));
 if(button?.dataset.configured==='false'){
  window.ECHOToast?.show((provider==='google'?'Google':'Яндекс')+' пока не активирован на сервере ECHO');
  return;
 }
 const popup=window.open('about:blank','echo-oauth-'+provider,'width=530,height=680');
 if(popup){popup.document.title='ECHO';popup.document.body.textContent='Переход к авторизации…';}
 try{
  const result=await request('oauth/'+provider+'/start',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({platform:'web',link})
  });
  const next=new URL(result.authorizationUrl);
  const expected=provider==='google'?'https://accounts.google.com':'https://oauth.yandex.ru';
  if(next.origin!==expected)throw new Error('Invalid OAuth destination');
  if(popup&&!popup.closed)popup.location.assign(next.href);
  else location.assign(next.href);
 }catch(error){
  popup?.close();
  console.error('[echo oauth] start failed',error);
  window.ECHOToast?.show(error.status===503?'Способ входа пока не настроен':'Не удалось открыть авторизацию');
 }
}
window.addEventListener('message',event=>{
 if(event.origin===location.origin&&event.data?.type==='echo-oauth-ready')
  void finishOAuth();
});


// VK Mini Apps uses VK Bridge on every launch. The signed parameters must
// still be verified by ECHO on the server; VK Bridge alone is not authentication.
function readVKLaunchFromURL(){
 const params=new URLSearchParams(location.search);
 const hash=location.hash.slice(1);
 const fragment=new URLSearchParams(hash.startsWith('?')?hash.slice(1):hash);
 for(const [name,value] of fragment){
  if(!params.has(name))params.set(name,value);
 }
 return Object.fromEntries([...params.entries()].filter(([name])=>name==='sign'||name.startsWith('vk_')));
}
const vkURLLaunch=readVKLaunchFromURL();
// Initialized in the classic bootstrap before any Three.js modules run.
const isVKMiniApp=Boolean(window.isVKMiniApp);
let vkMiniLoginInProgress=false;

async function sendVKBridge(bridge,method){
 let timer;
 try{
  return await Promise.race([
   bridge.send(method),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(method+' timed out')),10000);})
  ]);
 }finally{clearTimeout(timer);}
}
function normalizedVKLaunch(value){
 const params=value?.launch_params||value?.params||value;
 if(!params||typeof params!=='object'||Array.isArray(params))return {};
 return Object.fromEntries(
  Object.entries(params)
   .filter(([name,val])=>(name==='sign'||name.startsWith('vk_'))&&
    (typeof val==='string'||typeof val==='number'))
   .map(([name,val])=>[name,String(val)])
 );
}
function isCompleteVKLaunch(params){
 return Boolean(params.sign&&params.vk_user_id&&params.vk_app_id);
}
async function getVKMiniAppLaunch(){
 // VKWebAppInit runs early, before any Three.js imports.
 if(!window.ECHOVKBridgeReady)throw new Error('VK Bridge bootstrap was not started');
 const bridge=await window.ECHOVKBridgeReady;
 // VK already supplies signed URL parameters in normal launches. Use their
 // original string values without an unnecessary slow Bridge round-trip.
 if(isCompleteVKLaunch(vkURLLaunch))return vkURLLaunch;
 // A Bridge lookup is needed only when the VK host omitted URL parameters.
 let fromBridge={};
 try{
  fromBridge=normalizedVKLaunch(await sendVKBridge(bridge,'VKWebAppGetLaunchParams'));
 }catch(error){
  console.warn('[echo vk mini] VKWebAppGetLaunchParams unavailable',error);
 }
 if(isCompleteVKLaunch(fromBridge))return fromBridge;
 throw new Error('Signed VK Mini App launch parameters are missing');
}

const key='echo.authToken';
let token=localStorage.getItem(key);
let current=null;
let started=false;
// ECHO is hosted under /echo on a shared domain with Cat Fight.
// Never assume the domain-root /api belongs to ECHO.
const bases=['/echo/api/auth/','/api/auth/'];
let activeBase=null;
async function selectApiBase(){
 if(activeBase)return activeBase;
 for(const base of bases){
  try{
   const res=await fetch(new URL(base+'config',location.origin),{cache:'no-store'});
   if(!res.ok)continue;
   const config=await res.json();
   if(Number(config?.appId)===54832804){activeBase=base;return base;}
  }catch(error){console.warn('[echo auth] endpoint unavailable',base,error);}
 }
 throw new Error('ECHO authentication API is not reachable');
}
const url=async path=>new URL((await selectApiBase())+path,location.origin);
async function request(path,options={}){
 const headers={...options.headers};
 if(token)headers.Authorization='Bearer '+token;
 const response=await fetch(await url(path),{...options,headers,cache:'no-store'});
 if(!response.ok){
  const payload=await response.json().catch(()=>({}));
  throw Object.assign(new Error('Request failed'),{status:response.status,code:payload.code});
 }
 return response.json();
}
function showGuest(message){
 current=null;guest.hidden=isVKMiniApp;panel.hidden=true;
 status.textContent=message||'';
 status.hidden=!message;
 document.dispatchEvent(new CustomEvent('echo:auth-changed',{detail:{authenticated:false}}));
}
function showUser(data,{nicknameChanged=false}={}){
 current=data;guest.hidden=true;panel.hidden=false;
 document.querySelector('#echo-account-name').textContent=data.nickname;
 status.textContent='';
 status.hidden=true;
 document.dispatchEvent(new CustomEvent('echo:auth-changed',{detail:{
  authenticated:true,nickname:data.nickname,accountId:data.accountId,nicknameChanged
 }}));
}
async function refresh(){
 if(!token){showGuest();return;}
 try{showUser(await request('me'));}
 catch(error){if(error.status===401){token=null;localStorage.removeItem(key);}showGuest(t('auth_failed','Ошибка авторизации'));}
}
async function loginVKMiniApp(){
 if(vkMiniLoginInProgress)return;
 vkMiniLoginInProgress=true;
 status.textContent=t('vk_connecting','Подключение к VK…');
 status.hidden=false;
 try{
  const launchParams=await getVKMiniAppLaunch();
  // Never reuse a browser session before confirming which VK user opened the Mini App.
  token=null;
  localStorage.removeItem(key);
  const account=await request('vk-launch',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(launchParams)
  });
  if(!/^[a-f0-9]{64}$/.test(account?.token||''))throw new Error('Invalid session response');
  token=account.token;
  localStorage.setItem(key,token);
  await refresh();
 }catch(error){
  console.error('[echo vk mini] automatic login failed',error);
  token=null;
  localStorage.removeItem(key);
  showGuest(error.status===503?
   t('vk_not_configured','Вход через VK пока не настроен на сервере.'):
   t('vk_auth_retry','Не удалось автоматически войти через VK. Перезапустите мини-приложение.'));
 }finally{
  vkMiniLoginInProgress=false;
 }
}

function loginMessage(message){
 if(loginError)loginError.textContent=message;
}
async function start(){
 if(started||current)return;
 started=true;
 try{
  const config=await request('config');
  if(!config.enabled){loginMessage(t('auth_not_configured','Ожидается настройка сервера'));return;}
  if(!window.VKIDSDK)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://unpkg.com/@vkid/sdk@2.6.9/dist-sdk/umd/index.js';
   script.onload=resolve;script.onerror=reject;document.head.append(script);
  });
  const VKID=window.VKIDSDK;
  if(!VKID)throw new Error('VK ID SDK unavailable');
  VKID.Config.init({app:config.appId,redirectUrl:'https://cat-fight.ru/echo/',responseMode:VKID.ConfigResponseMode.Callback,source:VKID.ConfigSource.LOWCODE,scope:''});
  new VKID.OAuthList().render({container:loginWidget,scheme:'dark',styles:{borderRadius:12,height:56},oauthList:['vkid','ok_ru','mail_ru']})
   .on(VKID.WidgetEvents.ERROR,error=>{console.error('[VKID]',error);loginMessage(t('auth_failed','Ошибка авторизации'));})
   .on(VKID.OAuthListInternalEvents.LOGIN_SUCCESS,async payload=>{
    try{
     const auth=await VKID.Auth.exchangeCode(payload.code,payload.device_id);
     const account=await request('vk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:auth.access_token})});
     token=account.token;localStorage.setItem(key,token);
     await refresh();
     window.ECHOModal?.close();
    }catch(error){console.error('[VKID]',error);loginMessage(t('auth_failed','Ошибка авторизации'));}
   });
 }catch(error){
  console.error('[VKID]',error);
  loginMessage(t('auth_unavailable','Сервер авторизации ECHO недоступен'));
 }finally{started=false;}
}
document.querySelector('#menu-settings')?.addEventListener('click',()=>{if(token)refresh();});
document.querySelector('#echo-open-login')?.addEventListener('click',()=>{
 if(current)return;
 if(isVKMiniApp)return;
 const content=document.createElement('div');
 content.className='echo-login-modal-content';
 const intro=document.createElement('p');
 intro.className='echo-login-intro';
 intro.textContent=t('login_select_method','Выберите способ входа');
 const providers=document.createElement('div');
 providers.className='echo-login-providers';
 const oauthMethods=document.createElement('div');
 oauthMethods.className='echo-oauth-methods';
 oauthMethods.append(oauthButton('yandex',false),oauthButton('google',false));
 loginWidget=document.createElement('div');
 loginWidget.className='echo-login-widget';
 providers.append(oauthMethods,loginWidget);
 loginError=document.createElement('p');
 loginError.className='echo-login-error';
 loginError.setAttribute('role','status');
 content.append(intro,providers,loginError);
 window.ECHOModal?.open({
  title:t('auth_modal_title','АВТОРИЗАЦИЯ'),
  contentElement:content,
  buttons:[{label:t('back','Назад'),value:false}],
 });
 void updateOAuthButtons();
 start();
});
document.querySelector('#echo-edit-name')?.addEventListener('click',()=>{
 if(!current)return;
 const field=document.createElement('input');
 field.className='echo-nickname-modal-input';
 field.type='text';field.maxLength=20;field.value=current.nickname;field.autocomplete='off';
 field.setAttribute('aria-label',t('nickname','Имя игрока'));
 const content=document.createElement('div');
 content.className='echo-nickname-modal-form';
 const help=document.createElement('p');
 help.className='echo-nickname-help';
 help.textContent=t('nickname_invalid','Имя: 3–20 букв, цифр, _ или -');
 content.append(field,help);
 window.ECHOModal?.open({
  title:t('nickname','Имя игрока'),contentElement:content,
  buttons:[
   {label:t('no','Отмена'),value:false},
   {label:t('save_nickname','Сохранить'),value:true,variant:'primary',onClick:async()=>{
    const value=field.value.trim();
    if(!/^[a-zA-Zа-яА-ЯёЁ0-9_-]{3,20}$/u.test(value)){
     window.ECHOToast?.show(t('nickname_invalid','Имя: 3–20 букв, цифр, _ или -'));
     return false;
    }
    if(value===current?.nickname)return false;
    try{
     await request('nickname/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:value})});
    }catch(error){
     window.ECHOToast?.show(error.code==='forbidden'?t('nickname_forbidden','Имя содержит запрещённые слова'):error.status===409?t('nickname_taken','Имя занято'):error.status===400?t('nickname_invalid','Имя: 3–20 букв, цифр, _ или -'):t('auth_failed','Ошибка авторизации'));
     return false;
    }
    // Open confirmation only after this input modal has closed.
    setTimeout(async()=>{
     const confirmed=await window.ECHOModal.confirm({
      title:t('nickname_confirm_title','Изменить имя'),
      text:t('nickname_confirm_text','Сохранить новое имя игрока?'),
      confirmText:t('yes','Да'),cancelText:t('no','Нет')
     });
     if(!confirmed)return;
     try{
      const data=await request('nickname',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:value})});
      showUser({...current,nickname:data.nickname},{nicknameChanged:true});
      window.ECHOToast?.show(t('nickname_saved','Имя успешно изменено'));
     }catch(error){window.ECHOToast?.show(error.code==='forbidden'?t('nickname_forbidden','Имя содержит запрещённые слова'):error.status===409?t('nickname_taken','Имя занято'):error.status===400?t('nickname_invalid','Имя: 3–20 букв, цифр, _ или -'):t('auth_failed','Ошибка авторизации'));}
    },0);
    return true;
   }}
  ]
 });
 requestAnimationFrame(()=>field.focus());
});
document.querySelector('#echo-logout')?.addEventListener('click',async()=>{
 if(isVKMiniApp)return;
 const approved=await window.ECHOModal.confirm({title:t('logout_confirm_title','ВЫХОД'),text:t('logout_confirm_text','Вы уверены, что хотите выйти из аккаунта?'),confirmText:t('yes','Да'),cancelText:t('no','Нет')});
 if(!approved)return;
 try{await request('logout',{method:'POST'});}catch{}
 token=null;localStorage.removeItem(key);showGuest();
});
// Share the existing authenticated API with the shop; never infer balance from local storage.
window.ECHOAuth = Object.freeze({getMe:()=>token?request('me'):Promise.resolve(null),getCurrent:()=>current&&{accountId:current.accountId,nickname:current.nickname}});
if(isVKMiniApp){
 // Previous browser session must never identify the VK Mini App player.
 token=null;
 localStorage.removeItem(key);
 document.documentElement.classList.add('echo-vk-mini-app');
 document.querySelector('#echo-open-login')?.setAttribute('hidden','');
 document.querySelector('#echo-logout')?.setAttribute('hidden','');
 guest.hidden=true;
 panel.hidden=true;
 status.textContent=t('vk_connecting','Подключение к VK…');
 status.hidden=false;
 // The Mini App always authenticates its VK user automatically.
 loginVKMiniApp();
}else{
 const pending=new URL(location.href);
 if(pending.searchParams.has('echo_oauth')){
  pending.searchParams.delete('echo_oauth');
  history.replaceState(null,'',pending.pathname+pending.search+pending.hash);
  void finishOAuth();
 }else refresh();
 void updateOAuthButtons();
}

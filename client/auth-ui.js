const t=(key,fallback)=>window.$t?.('menu:'+key,fallback)||fallback;
const guest=document.querySelector('#echo-auth-guest');
const panel=document.querySelector('#echo-auth-user');
const status=document.querySelector('#echo-auth-status');
let loginWidget=null;
let loginError=null;

// VK Mini Apps uses VK Bridge on every launch. The signed parameters must
// still be verified by ECHO on the server; VK Bridge alone is not authentication.
function readVKLaunchFromURL(){
 const params=new URLSearchParams(location.search);
 const fragment=new URLSearchParams(location.hash.slice(1).replace(/^\\?/,''));
 for(const [name,value] of fragment){
  if(!params.has(name))params.set(name,value);
 }
 return Object.fromEntries([...params.entries()].filter(([name])=>name==='sign'||name.startsWith('vk_')));
}
const vkURLLaunch=readVKLaunchFromURL();
const isVKContainer=(()=>{
 let framedByVK=false;
 try{
  framedByVK=window.self!==window.top &&
   /^https?:\\/\\/([a-z0-9-]+\\.)*(vk\\.com|vk\\.ru|vkontakte\\.ru)(?::\\d+)?\\//i.test(document.referrer);
 }catch(_error){}
 return framedByVK||/VkAndroidApp|VKMobile|VKontakte|VKCOM|VKMessenger/i.test(navigator.userAgent);
})();
const isVKMiniApp=Boolean(
 vkURLLaunch.vk_app_id||vkURLLaunch.vk_user_id||
 vkURLLaunch.vk_platform||vkURLLaunch.sign||isVKContainer
);
window.isVKMiniApp=isVKMiniApp;
let vkMiniLoginInProgress=false;
let vkBridgePromise=null;

function loadVKBridge(){
 if(window.vkBridge?.send)return Promise.resolve(window.vkBridge);
 if(vkBridgePromise)return vkBridgePromise;
 vkBridgePromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const timeout=setTimeout(()=>reject(new Error('VK Bridge script timed out')),10000);
  script.src='https://unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js';
  script.onload=()=>{
   clearTimeout(timeout);
   if(window.vkBridge?.send)resolve(window.vkBridge);
   else reject(new Error('VK Bridge is unavailable'));
  };
  script.onerror=()=>{
   clearTimeout(timeout);
   reject(new Error('Cannot load VK Bridge'));
  };
  document.head.append(script);
 });
 return vkBridgePromise;
}
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
 const bridge=await loadVKBridge();
 // Initialize Bridge even when all signed parameters are already in the URL.
 await sendVKBridge(bridge,'VKWebAppInit');
 let fromBridge={};
 try{
  fromBridge=normalizedVKLaunch(await sendVKBridge(bridge,'VKWebAppGetLaunchParams'));
 }catch(error){
  // Some VK clients provide launch params only in the URL.
  console.warn('[echo vk mini] VKWebAppGetLaunchParams unavailable',error);
 }
 // Keep the exact signed URL strings when present. Do not mix signed fields
 // from different sources, since that can invalidate the signature.
 if(isCompleteVKLaunch(vkURLLaunch))return vkURLLaunch;
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
 document.dispatchEvent(new CustomEvent('echo:auth-changed',{detail:{authenticated:false}}));
 current=null;guest.hidden=isVKMiniApp;panel.hidden=true;
 status.textContent=message||'';
 status.hidden=!message;
}
function showUser(data){
 document.dispatchEvent(new CustomEvent('echo:auth-changed',{detail:{authenticated:true}}));
 current=data;guest.hidden=true;panel.hidden=false;
 document.querySelector('#echo-account-name').textContent=data.nickname;
 status.textContent='';
 status.hidden=true;
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
  new VKID.OAuthList().render({container:loginWidget,scheme:'dark',styles:{borderRadius:12,height:40},oauthList:['vkid','ok_ru','mail_ru']})
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
 loginWidget=document.createElement('div');
 loginWidget.className='echo-login-widget';
 loginError=document.createElement('p');
 loginError.className='echo-login-error';
 loginError.setAttribute('role','status');
 content.append(loginWidget,loginError);
 window.ECHOModal?.open({
  title:t('auth_modal_title','АВТОРИЗАЦИЯ'),
  contentElement:content,
  buttons:[{label:t('back','Назад'),value:false}],
 });
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
      showUser({...current,nickname:data.nickname});
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
window.ECHOAuth = Object.freeze({getMe:()=>token?request('me'):Promise.resolve(null)});
if(isVKMiniApp){
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
 refresh();
}

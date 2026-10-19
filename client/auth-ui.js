const t=(key,fallback)=>window.$t?.('menu:'+key,fallback)||fallback;
const guest=document.querySelector('#echo-auth-guest');
const panel=document.querySelector('#echo-auth-user');
const status=document.querySelector('#echo-auth-status');
let loginWidget=null;
let loginError=null;

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
 if(!response.ok)throw Object.assign(new Error('Request failed'),{status:response.status});
 return response.json();
}
function showGuest(message){
 current=null;guest.hidden=false;panel.hidden=true;
 status.textContent=message||'';
 status.hidden=!message;
}
function showUser(data){
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
   {label:t('save_nickname','Сохранить'),value:true,variant:'primary',onClick:()=>{
    const value=field.value.trim();
    if(!/^[a-zA-Zа-яА-ЯёЁ0-9_-]{3,20}$/u.test(value)){
     window.ECHOToast?.show(t('nickname_invalid','Имя: 3–20 букв, цифр, _ или -'));return;
    }
    if(value===current?.nickname)return;
    // The shared modal closes after onClick; open confirmation on the next task.
    setTimeout(async()=>{
     const confirmed=await window.ECHOModal.confirm({
      title:t('nickname_confirm_title','ИЗМЕНЕНИЕ ИМЕНИ'),
      text:t('nickname_confirm_text','Сохранить новое имя игрока?'),
      confirmText:t('yes','Да'),cancelText:t('no','Нет')
     });
     if(!confirmed)return;
     try{
      const data=await request('nickname',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:value})});
      showUser({...current,nickname:data.nickname});
      window.ECHOToast?.show(t('nickname_saved','Имя успешно изменено'));
     }catch(error){window.ECHOToast?.show(error.status===409?t('nickname_taken','Имя занято'):t('auth_failed','Ошибка авторизации'));}
    },0);
   }}
  ]
 });
 requestAnimationFrame(()=>field.focus());
});
document.querySelector('#echo-logout')?.addEventListener('click',async()=>{
 const approved=await window.ECHOModal.confirm({title:t('logout_confirm_title','ВЫХОД ИЗ АККАУНТА'),text:t('logout_confirm_text','Выйти из аккаунта ECHO?'),confirmText:t('yes','Да'),cancelText:t('no','Нет')});
 if(!approved)return;
 try{await request('logout',{method:'POST'});}catch{}
 token=null;localStorage.removeItem(key);showGuest();
});
refresh();

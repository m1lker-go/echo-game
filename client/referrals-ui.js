// Independent referral quest: never changes the Cat Fighting partner quest.
(() => {
 'use strict';
 const screen=document.querySelector('#menu-quests-screen');
 const dailyTab=document.querySelector('#quests-tab-daily');
 const specialTab=document.querySelector('#quests-tab-special');
 const mount=document.querySelector('#quests-referral');
 if (!screen||!dailyTab||!specialTab||!mount) return;
 const t=(key,fallback)=>window.$t?.('menu:'+key,fallback)||fallback;
 const token=()=>localStorage.getItem('echo.authToken');
 const image='./assets/packs/icon_echocard_basic.webp';
 let data=null,loading=false,busy=false,failed=false,sequence=0;

 const node=(tag,cls,value)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=value;
  return el;
 };
 function message(text){window.ECHOToast?.show(text);}
 function rewardToast(quantity){
  const toast=node('span','echo-quest-reward-toast');
  const label=node('span','',t('referral_received','Получено:')+' '+quantity);
  const icon=node('img');icon.src=image;icon.alt=t('referral_pack','Обычный пак');
  icon.width=27;icon.height=27;
  toast.append(label,icon);
  window.ECHOToast?.show(toast);
 }
 async function copyCode(){
  if(!data?.code)return;
  try {
   if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
   await navigator.clipboard.writeText(data.code);
  }catch{
   const area=node('textarea');area.value=data.code;
   area.style.position='fixed';area.style.opacity='0';document.body.append(area);
   area.select();
   const copied=document.execCommand?.('copy');
   area.remove();
   if(!copied){message(t('referral_copy_failed','Не удалось скопировать код'));return;}
  }
  message(t('referral_copied','Реферальный код скопирован'));
 }
 async function refresh(){
  if(mount.hidden||screen.hidden||busy)return;
  const original=token();
  if(!original){data=null;failed=false;loading=false;render();return;}
  const id=++sequence;
  loading=true;failed=false;render();
  try{
   const response=await fetch('/echo/api/referrals',{
    headers:{Authorization:'Bearer '+original},cache:'no-store'
   });
   if(!response.ok)throw new Error(String(response.status));
   const next=await response.json();
   if(id!==sequence||token()!==original)return;
   data=next;failed=false;
  }catch(error){
   if(id!==sequence)return;
   console.warn('[echo referrals] load failed',error);
   failed=true;
  }finally{
   if(id===sequence){loading=false;render();}
  }
 }
 async function claim(){
  if(busy||!token()||!Number(data?.pendingFriends))return;
  const original=token();
  busy=true;render();
  try{
   const response=await fetch('/echo/api/referrals/claim',{
    method:'POST',headers:{Authorization:'Bearer '+original},cache:'no-store'
   });
   if(!response.ok)throw new Error(String(response.status));
   const result=await response.json();
   if(token()!==original)return;
   if(result.claimedNow){
    rewardToast(result.packsGranted);
    window.dispatchEvent(new Event('echo:shop-balance-refresh'));
   }else message(t('referral_empty','Пока нет новых наград'));
  }catch(error){
   console.warn('[echo referrals] claim failed',error);
   message(t('referral_claim_failed','Не удалось забрать награду'));
  }finally{busy=false;render();void refresh();}
 }
 function render(){
  if(mount.hidden)return;
  mount.replaceChildren();
  if(!token()){mount.append(node('p','echo-referral-state',t('referral_signin','Войди в аккаунт, чтобы приглашать друзей.')));return;}
  const article=node('article','echo-special-card echo-referral-card');
  const head=node('div','echo-special-head');
  const logo=node('span','echo-special-logo echo-referral-logo','👥');
  logo.setAttribute('aria-hidden','true');
  const heading=node('div','echo-special-heading');
  heading.append(node('strong','',t('referral_title','РЕФЕРАЛ')),
   node('span','',t('referral_subtitle','Пригласи друга и отправь ему код')));
  head.append(logo,heading);article.append(head);
  if(!data){
   article.append(node('p','echo-referral-state',failed?
    t('referral_load_failed','Не удалось загрузить рефералов'):
    t('referral_loading','Загрузка реферального задания…')));
   if(failed){const retry=node('button','echo-special-action',t('referral_retry','Повторить'));retry.addEventListener('click',()=>void refresh());article.append(retry);}
   mount.append(article);return;
  }
  const pending=Math.max(0,Number(data.pendingFriends)||0);
  const perFriend=Math.max(0,Number(data.packsPerFriend)||2);
  const reward=node('div','echo-special-reward echo-referral-reward');
  const rewardLabel=node('span','echo-special-reward-label',t('special_reward_title','Награда:'));
  const amount=node('span','echo-referral-reward-unit',String(perFriend));
  const icon=node('img','echo-special-reward-icon');
  icon.src=image;icon.alt=t('referral_pack','Обычный пак');icon.width=36;icon.height=36;
  const multiplier=node('span','echo-special-reward-quantity','×'+pending);
  reward.append(rewardLabel,amount,icon,multiplier);
  if(pending>0){
   const button=node('button','echo-special-action echo-special-check echo-referral-claim',t('referral_claim','Забрать'));
   button.type='button';button.disabled=busy;button.addEventListener('click',()=>void claim());
   reward.append(button);
  }
  article.append(reward);
  const codeRow=node('div','echo-special-code-row');
  const value=node('div','echo-special-code',String(data.code||''));
  value.setAttribute('aria-label',t('referral_code','Код приглашения'));
  const copy=node('button','echo-special-copy','⧉');
  copy.type='button';copy.disabled=busy;copy.setAttribute('aria-label',t('referral_copy','Копировать код'));
  copy.title=t('referral_copy','Копировать код');
  copy.addEventListener('click',()=>void copyCode());
  codeRow.append(value,copy);article.append(codeRow);
  article.append(node('p','echo-special-instruction',
   t('referral_instructions','Друг должен войти в ECHO и в настройках выбрать «Ввести код». Оба получите по 2 обычных пака.')));
  article.append(node('p','echo-referral-stats',
   t('referral_invited','Приглашено:')+' '+Math.max(0,Number(data.totalFriends)||0)+
   ' · '+t('referral_pending','Не получена награда за:')+' '+pending));
  if(failed)article.append(node('p','echo-referral-state',t('referral_load_failed','Не удалось обновить рефералов')));
  mount.append(article);
 }
 function visibility(){
  const visible=!screen.hidden&&specialTab.classList.contains('is-active');
  mount.hidden=!visible;
  if(visible)void refresh();
 }
 specialTab.addEventListener('click',()=>visibility());
 dailyTab.addEventListener('click',()=>{mount.hidden=true;});
 window.addEventListener('echo:quests-open',()=>visibility());
 document.addEventListener('echo:auth-changed',()=>{sequence++;data=null;if(!mount.hidden)void refresh();});
 window.addEventListener('echo:referrals-refresh',()=>{if(!mount.hidden)void refresh();});
 window.addEventListener('focus',()=>{if(!mount.hidden)void refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!mount.hidden)void refresh();});
 window.addEventListener('echo:language-changed',()=>render());
})();

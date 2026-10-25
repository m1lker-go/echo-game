// ECHO daily quests: server verified account, cumulative daily tiers.
// Load the optional ads module only when Play is clicked. A missing ad
// adapter must never block standard quests, and the Node VM HUD regression
// tests can evaluate the core quests screen without an ES module loader.
async function watchEchoRewardedVideo(onReady){
 const {watchEchoRewardedVideo:showAd}=await import('./rewarded-ads.js?v=echo-ads-2096987-3');
 return showAd(onReady);
}
const list=document.querySelector('#quests-list');
const status=document.querySelector('#quests-status');
const reset=document.querySelector('#quests-reset');
const screen=document.querySelector('#menu-quests-screen');
const t=(key,fallback)=>window.$t?.('menu:'+key,fallback)||fallback;
const meta={
 play:{icon:'fa-regular fa-clock',title:'quests_play',desc:'quests_play_desc'},
 food:{icon:'fa-solid fa-apple-whole',title:'quests_food',desc:'quests_food_desc'},
 pvp:{icon:'fa-solid fa-trophy',title:'quests_pvp',desc:'quests_pvp_desc'},
 pack_coin:{icon:'fa-solid fa-box',title:'quests_pack_coin',desc:'quests_pack_coin_desc'},
 pack_premium:{icon:'fa-solid fa-gem',title:'quests_pack_premium',desc:'quests_pack_premium_desc'},
 video:{icon:'fa-solid fa-play',title:'quests_video',desc:'quests_video_desc'}
};
// Local SVG icons avoid dependence on an external icon-font CDN.
const iconPaths={
 play:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 food:'<path d="M12 7c-3-4-9-2-9 4 0 5 4 10 7 10 1 0 1.4-.6 2-.6s1 .6 2 .6c3 0 7-5 7-10 0-6-6-8-9-4Z"/><path d="M12 7c0-3 2-5 5-5"/>',
 pvp:'<path d="M7 3h10v7a5 5 0 0 1-10 0V3Z"/><path d="M7 5H4v3a4 4 0 0 0 4 4m9-7h3v3a4 4 0 0 1-4 4M12 15v4m-4 2h8m-8-2h8"/>',
 pack_coin:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10"/>',
 pack_premium:'<path d="M6 3h12l4 6-10 12L2 9l4-6Zm-4 6h20M9 3l3 6 3-6m-3 6v12"/>',
 video:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m10 8 6 4-6 4Z"/>'
};
function questIcon(id){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
 svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 svg.setAttribute('class','echo-quest-icon');svg.setAttribute('aria-hidden','true');
 svg.innerHTML=iconPaths[id]||iconPaths.play;return svg;
}
function questDots(q){
 const dots=document.createElement('span');dots.className='echo-quest-levels';
 const count=Math.min(5,Math.max(0,Number(q.levels)||0));
 const filled=q.claimed?count:Math.max(0,(Number(q.level)||1)-1)+(q.available&&q.progress>=q.target?1:0);
 for(let i=0;i<count;i++){const dot=document.createElement('span');dot.className='echo-quest-dot'+(i<filled?' is-done':'');dots.append(dot);}
 dots.setAttribute('aria-label',filled+' / '+count);return dots;
}
let current=null,loading=false;
function endpoint(path){return new URL('/echo'+path,location.origin)}
function token(){return localStorage.getItem('echo.authToken')}
function show(message){status.textContent=message}
// Read-only HUD uses the same server progress and claim endpoint as the menu.
const questHud=document.querySelector('#echo-quest-hud');
const questHudName=document.querySelector('#echo-quest-hud-name');
const questHudAction=document.querySelector('#echo-quest-hud-action');
let hudSnapshot=null,hudFetchedAt=0,hudLoading=false;
function inGame(){return !!token()&&document.querySelector('#main-menu')?.classList.contains('is-hidden')===true}
function hudCandidate(){
 const active=(hudSnapshot?.quests||[]).filter(q=>['play','food','pvp'].includes(q.id)&&!q.claimed);
 if(!active.length)return null;
 // A claimable reward takes priority; otherwise choose closest to the next threshold.
 return active.sort((a,b)=>{
  const aReady=a.progress>=a.target,bReady=b.progress>=b.target;
  if(aReady!==bReady)return aReady?-1:1;
  const ar=(a.target-a.progress)/a.target,br=(b.target-b.progress)/b.target;
  return ar-br||['play','food','pvp'].indexOf(a.id)-['play','food','pvp'].indexOf(b.id);
 })[0];
}
function displayQuestHud(){
 if(!questHud)return;
 const q=inGame()?hudCandidate():null;
 questHud.hidden=!q;
 if(!q)return;
 const info=meta[q.id];
 const target=q.id==='play'?Math.floor(q.target/60):q.target;
 const name=document.createElement('span');name.className='echo-quest-hud-title';name.textContent=t(info.title,q.id);
 const details=document.createElement('span');details.className='echo-quest-hud-description';details.textContent=t(info.desc,'').replaceAll('{count}',String(target));
 const titleLine=document.createElement('span');titleLine.className='echo-quest-hud-heading';
 titleLine.append(name,questDots(q));
 questHudName.replaceChildren(titleLine,details);
 const ready=q.progress>=q.target;
 // Estimate only time that has passed since the latest server response; the API stays authoritative.
 const elapsed=q.id==='play'&&!document.hidden?Math.min(5,Math.max(0,Math.floor((Date.now()-hudFetchedAt)/1000))):0;
 const remaining=Math.max(0,q.target-q.progress-elapsed);
 const display=q.id==='play'?Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0'):String(Math.max(0,q.target-q.progress));
 questHudAction.textContent=ready?t('quests_take','Забрать'):t('quests_remaining','Осталось:')+' '+display;
 questHudAction.disabled=!ready||loading;
 questHudAction.classList.toggle('is-ready',ready);
 questHudAction.dataset.questId=q.id;
}
async function refreshQuestHud(){
 if(!inGame()||document.hidden){if(questHud)questHud.hidden=true;return;}
 if(hudLoading||loading)return;
 const authToken=token();
 hudLoading=true;
 try{
  const response=await fetch(endpoint('/api/daily-quests'),{headers:{Authorization:'Bearer '+authToken},cache:'no-store'});
  if(authToken!==token())return;
  if(!response.ok){hudSnapshot=null;displayQuestHud();return;}
  const snapshot=await response.json();
  if(authToken!==token())return;
  hudSnapshot=snapshot;hudFetchedAt=Date.now();displayQuestHud();
 }catch(error){console.warn('[echo quests] HUD refresh failed',error)}
 finally{
  hudLoading=false;
  // A VK session can change while a request is in flight.
  if(authToken!==token()&&inGame())queueMicrotask(refreshQuestHud);
 }
}
questHudAction?.addEventListener('click',()=>{const q=hudCandidate();if(q&&q.progress>=q.target&&!loading)claim(q.id)});
// VK Mini Apps replaces the session asynchronously after scripts have started.
// Keep polling installed even if the initial screen is the menu or VK login is pending.
setInterval(refreshQuestHud,5000);
setInterval(displayQuestHud,1000);
if(inGame())refreshQuestHud();
document.addEventListener('echo:auth-changed',()=>{
 hudSnapshot=null;hudFetchedAt=0;
 if(questHud)questHud.hidden=true;
 refreshQuestHud();
});
document.addEventListener('echo:game-started',refreshQuestHud);
document.addEventListener('echo:returned-to-menu',()=>{
 if(questHud)questHud.hidden=true;
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshQuestHud();else if(questHud)questHud.hidden=true});
window.addEventListener('echo:language-changed',displayQuestHud);
// Claimable first, active next, all rewards claimed last.
function dailyQuestPriority(quest){
 if(quest.claimed)return 2;
 if(quest.available&&Number(quest.progress)>=Number(quest.target))return 0;
 return 1;
}
function render(){
 list.replaceChildren();
 reset.textContent=t('quests_reset','Обновление ежедневно в 00:00 по Москве');
 if(!current)return;
 // Keep stable order inside each status group, without modifying the server snapshot.
 const ordered=[...(current.quests||[])].sort((a,b)=>dailyQuestPriority(a)-dailyQuestPriority(b));
 for(const quest of ordered){
  const info=meta[quest.id];if(!info)continue;
  const progress=Math.max(0,Math.min(quest.target,quest.progress));
  const ready=quest.available&&!quest.claimed&&progress>=quest.target;
  const article=document.createElement('article');
  article.className='echo-quest'+(quest.claimed?' is-complete':ready?' is-ready':'');
  article.dataset.questId=quest.id;
  const heading=document.createElement('div');heading.className='echo-quest-heading';
  const symbol=questIcon(quest.id);
  const summary=document.createElement('div');summary.className='echo-quest-summary';
  const title=document.createElement('strong');title.textContent=t(info.title,quest.id);
  const description=document.createElement('span');description.className='echo-quest-description';
  const value=quest.id==='play'?Math.floor(quest.target/60):quest.target;
  description.textContent=t(info.desc,'').replaceAll('{count}',String(value));
  summary.append(title);
  if(quest.levels>1)summary.append(questDots(quest));
  summary.append(description);
  const reward=document.createElement('span');reward.className='echo-quest-reward';
  const coin=document.createElement('img');coin.src='./assets/icons/coin.webp';coin.alt='ECHO Coin';coin.width=28;coin.height=28;
  reward.append(coin,document.createTextNode('+'+quest.reward));
  heading.append(symbol,summary,reward);
  const track=document.createElement('div');track.className='echo-quest-track';
  const bar=document.createElement('div');bar.style.width=(quest.claimed?'100':quest.available?100*progress/quest.target:0)+'%';track.append(bar);
  const footer=document.createElement('div');footer.className='echo-quest-footer';
  const counter=document.createElement('span');counter.className='echo-quest-counter';
  counter.textContent=quest.id==='play'?Math.floor(progress/60)+' / '+Math.floor(quest.target/60):quest.available?progress+' / '+quest.target:'0 / 1';
  const button=document.createElement('button');button.type='button';button.className='echo-quest-claim';
  if(quest.id==='video'&&!quest.claimed&&!ready){
   button.disabled=loading;
   button.classList.add('is-video-play');
   button.setAttribute('aria-label',t('quests_video_play','Посмотреть рекламу'));
   button.title=t('quests_video_play','Посмотреть рекламу');
   const playIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
   playIcon.setAttribute('viewBox','0 0 24 24');
   playIcon.setAttribute('fill','currentColor');
   playIcon.setAttribute('aria-hidden','true');
   const triangle=document.createElementNS('http://www.w3.org/2000/svg','path');
   triangle.setAttribute('d','M8 5.5v13l10-6.5Z');
   playIcon.append(triangle);button.append(playIcon);
   button.addEventListener('click',()=>{void watchVideoBonus();});
  }else{
   button.disabled=!ready||loading;
   button.textContent=quest.claimed?t('quests_claimed','Выполнено'):!quest.available?t('quests_soon','Скоро'):ready?t('quests_take','Забрать'):t('quests_incomplete','В процессе');
   if(ready)button.classList.add('is-claim-action');
   button.addEventListener('click',()=>{void claim(quest.id);});
  }
  footer.append(counter,button);article.append(heading,track,footer);list.append(article);
 }
 show('');
}
async function refresh(){
 if(screen.hidden||loading)return;
 const auth=token();
 if(!auth){current=null;list.replaceChildren();reset.textContent='';show(t('quests_guest','Задания доступны только авторизованным пользователям.'));return}
 loading=true;show(t('quests_loading','Загружаем задания…'));
 try{
  const response=await fetch(endpoint('/api/daily-quests'),{headers:{Authorization:'Bearer '+auth},cache:'no-store'});
  if(response.status===401){current=null;list.replaceChildren();reset.textContent='';show(t('quests_guest','Задания доступны только авторизованным пользователям.'));return}
  if(!response.ok)throw Error(String(response.status));
  current=await response.json();render();
 }catch(error){console.warn('[echo quests] fetch failed',error);show(t('quests_error','Не удалось загрузить задания. Попробуй снова.'))}
 finally{loading=false;if(current&&!screen.hidden)render()}
}
async function watchVideoBonus(){
 if(loading||!token())return;
 loading=true;
 try{
  const accountToken=token();
  const result=await watchEchoRewardedVideo(async()=>{
   const response=await fetch(endpoint('/api/daily-video/start'),{
    method:'POST',headers:{Authorization:'Bearer '+accountToken}
   });
   if(!response.ok)throw Error('start '+response.status);
   return response.json();
  });
  if(accountToken!==token())return;
  if(result.watched&&result.attemptId){
   const response=await fetch(endpoint('/api/daily-video/complete'),{
    method:'POST',
    headers:{Authorization:'Bearer '+accountToken,'Content-Type':'application/json'},
    body:JSON.stringify({attemptId:result.attemptId})
   });
   if(!response.ok)throw Error('complete '+response.status);
   window.ECHOToast?.show(t('quests_video_ready','Ролик просмотрен! Забери награду.'));
  }else if(result.reason==='unsupported'){
   window.ECHOToast?.show(t('quests_video_platform','Реклама пока недоступна на этой платформе.'));
  }else if(result.reason==='incomplete'){
   window.ECHOToast?.show(t('quests_video_incomplete','Просмотр не завершён. Попробуй ещё раз.'));
  }else{
   window.ECHOToast?.show(t('quests_video_unavailable','Реклама пока недоступна. Попробуй позже.'));
  }
 }catch(error){
  console.warn('[ECHO video bonus] unavailable',error);
  window.ECHOToast?.show(t('quests_video_unavailable','Реклама пока недоступна. Попробуй позже.'));
 }finally{
  loading=false;
  if(!screen.hidden)void refresh();
 }
}
async function claim(questId){
 if(loading||!token())return;
 loading=true;
 try{
  const video=questId==='video';
  const response=await fetch(endpoint(video?'/api/daily-video/claim':'/api/daily-quests/claim'),{
   method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},
   body:JSON.stringify({questId})
  });
  const data=await response.json();
  if(!response.ok&&response.status!==409)throw Error(String(response.status));
  if(data.quests){current=data;hudSnapshot=data;hudFetchedAt=Date.now();}
  render();displayQuestHud();
  if(data.claimedNow){
   const message=document.createElement('span');message.className='echo-quest-reward-toast';
   const label=document.createElement('span');label.textContent=t('quests_reward','Получено: ')+' '+data.reward;
   const image=document.createElement('img');image.src='./assets/icons/coin.webp';image.alt='ECHO Coin';image.width=25;image.height=25;
   message.append(label,image);
   window.ECHOToast?.show(message);
  }
 }catch(error){console.warn('[echo quests] claim failed',error);show(t('quests_error','Не удалось загрузить задания. Попробуй снова.'))}
 finally{
  loading=false;
  if(questId==='video'&&!screen.hidden)void refresh();
  else if(current&&!screen.hidden)render();
  displayQuestHud();refreshQuestHud();
 }
}
window.addEventListener('echo:quests-open',refresh);
window.addEventListener('echo:language-changed',()=>{if(current)render();else if(!token())show(t('quests_guest','Задания доступны только авторизованным пользователям.'))});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!screen.hidden)refresh()});

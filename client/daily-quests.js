// ECHO daily quests: server verified account, cumulative daily tiers.
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
 pack_premium:{icon:'fa-solid fa-gem',title:'quests_pack_premium',desc:'quests_pack_premium_desc'}
};
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
 questHudName.textContent=t(info.title,q.id)+' · '+target+(q.id==='play'?' '+t('quests_progress_minutes','мин'):'');
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
 hudLoading=true;
 try{
  const response=await fetch(endpoint('/api/daily-quests'),{headers:{Authorization:'Bearer '+token()},cache:'no-store'});
  if(!response.ok){hudSnapshot=null;displayQuestHud();return;}
  hudSnapshot=await response.json();hudFetchedAt=Date.now();displayQuestHud();
 }catch(error){console.warn('[echo quests] HUD refresh failed',error)}
 finally{hudLoading=false}
}
questHudAction?.addEventListener('click',()=>{const q=hudCandidate();if(q&&q.progress>=q.target&&!loading)claim(q.id)});
if(inGame()){refreshQuestHud();setInterval(refreshQuestHud,5000);setInterval(displayQuestHud,1000);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshQuestHud();else if(questHud)questHud.hidden=true});
window.addEventListener('echo:language-changed',displayQuestHud);
function render(){
 list.replaceChildren();
 reset.textContent=t('quests_reset','Обновление ежедневно в 00:00 по Москве');
 if(!current)return;
 for(const quest of current.quests||[]){
  const info=meta[quest.id];if(!info)continue;
  const progress=Math.max(0,Math.min(quest.target,quest.progress));
  const ready=quest.available&&!quest.claimed&&progress>=quest.target;
  const article=document.createElement('article');
  article.className='echo-quest'+(quest.claimed?' is-complete':ready?' is-ready':'');
  const heading=document.createElement('div');heading.className='echo-quest-heading';
  const symbol=document.createElement('i');symbol.className='echo-quest-icon '+info.icon;symbol.setAttribute('aria-hidden','true');
  const summary=document.createElement('div');summary.className='echo-quest-summary';
  const title=document.createElement('strong');title.textContent=t(info.title,quest.id);
  const description=document.createElement('span');description.className='echo-quest-description';
  const value=quest.id==='play'?Math.floor(quest.target/60):quest.target;
  description.textContent=t(info.desc,'').replaceAll('{count}',String(value));
  if(quest.levels>1)title.textContent+=' · '+quest.level+'/'+quest.levels;
  summary.append(title,description);
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
  button.disabled=!ready||loading;
  button.textContent=quest.claimed?t('quests_claimed','Выполнено'):!quest.available?t('quests_soon','Скоро'):ready?t('quests_take','Забрать'):t('quests_incomplete','В процессе');
  button.addEventListener('click',()=>claim(quest.id));
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
async function claim(questId){
 if(loading||!token())return;
 loading=true;
 try{
  const response=await fetch(endpoint('/api/daily-quests/claim'),{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({questId})});
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
 finally{loading=false;if(current&&!screen.hidden)render();displayQuestHud();refreshQuestHud()}
}
window.addEventListener('echo:quests-open',refresh);
window.addEventListener('echo:language-changed',()=>{if(current)render();else if(!token())show(t('quests_guest','Задания доступны только авторизованным пользователям.'))});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!screen.hidden)refresh()});

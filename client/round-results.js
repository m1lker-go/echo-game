const socket=window.echoSocket;
const STORAGE_KEY='echo.lastRoundResult';
function isPlaying(){return document.querySelector('#main-menu')?.classList.contains('is-hidden');}
function openResult(item){
  const english=document.documentElement.lang?.startsWith('en');
  const area=document.createElement('div');area.className='echo-result-content';
  const place=document.createElement('div');place.className='echo-result-place';
  place.textContent=(english?'You placed #':'Вы заняли ')+item.place+(english?'':' место');
  const label=document.createElement('div');label.className='echo-result-label';
  label.textContent=english?'Reward':'Награда';
  const reward=document.createElement('div');reward.className='echo-result-reward';
  const icon=document.createElement('img');icon.src='./assets/icons/coin.webp';icon.alt='Echo Coins';icon.width=43;icon.height=43;
  const value=document.createElement('strong');value.textContent='+'+Number(item.coins||0);
  reward.append(icon,value);area.append(place,label,reward);
  window.ECHOModal?.open({
    title:english?'GAME OVER!':'ИГРА ЗАВЕРШЕНА!',
    contentElement:area,
    buttons:[{label:english?'CONTINUE':'ПРОДОЛЖИТЬ',variant:'primary',value:true}],
    closeOnBackdrop:false
  });
}
function receiveResults(results){
  if(!Array.isArray(results)||!results.length)return;
  const ordered=[...results].sort((a,b)=>Number(a.round_id)-Number(b.round_id));
  let latest=localStorage.getItem(STORAGE_KEY)||'';
  for(const item of ordered){
    const key=String(item.round_id)+':'+String(item.room_id);
    if(!/^\d+:\d+$/.test(key)||key===latest)continue;
    if(!isPlaying())continue;
    latest=key;
    localStorage.setItem(STORAGE_KEY,key);
    openResult(item);
  }
}
socket?.on('echo:roundResults',receiveResults);

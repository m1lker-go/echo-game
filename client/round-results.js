const socket=window.echoSocket;
const STORAGE_KEY='echo.lastRoundResult';
function isPlaying(){return document.querySelector('#main-menu')?.classList.contains('is-hidden');}
function openResult(item){
  const english=document.documentElement.lang?.startsWith('en');
  const area=document.createElement('div');area.className='echo-result-content';
  const place=document.createElement('div');place.className='echo-result-place';
  place.textContent=(english?'You placed #':'Вы заняли ')+item.place+(english?'':' место');
  // Until server-verified accounts are available, all current game sessions are guests.
  const guestNotice=document.createElement('div');guestNotice.className='echo-result-label';
  guestNotice.textContent=english?'Coins are available after registration':'Монеты доступны после регистрации';
  area.append(place,guestNotice);
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
  let latest=Number(localStorage.getItem(STORAGE_KEY)||0);
  for(const item of ordered){
    const key=Number(item.round_id);
    if(!Number.isSafeInteger(key)||key<=latest)continue;
    if(!isPlaying())continue;
    latest=key;
    localStorage.setItem(STORAGE_KEY,String(key));
    openResult(item);
  }
}
socket?.on('echo:roundResults',receiveResults);

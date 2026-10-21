let subscribedSocket=null;
const STORAGE_KEY='echo.lastRoundResult';
const t=(key,fallback)=>window.$t?.('game:'+key,fallback)||fallback;
function isPlaying(){return document.querySelector('#main-menu')?.classList.contains('is-hidden');}
function openResult(item){
  const area=document.createElement('div');
  area.className='echo-result-content';
  const place=document.createElement('div');
  place.className='echo-result-place';
  place.textContent=t('round_place','Вы заняли {place} место').replace('{place}',String(item.place));
  area.append(place);
  if(item.authenticated===true){
    const caption=document.createElement('div');
    caption.className='echo-result-label';
    caption.textContent=t('round_reward','Награда:');
    const reward=document.createElement('div');
    reward.className='echo-result-reward';
    const amount=document.createElement('strong');
    amount.textContent=String(Math.max(0,Number(item.coins)||0));
    const coin=document.createElement('img');
    coin.src='./assets/icons/coin.webp';
    coin.alt='ECHO Coin';
    reward.append(amount,coin);
    area.append(caption,reward);
  }else{
    const notice=document.createElement('p');
    notice.className='echo-result-guest';
    notice.textContent=t('round_guest_login','Для получения монет необходимо пройти авторизацию пользователя в настройках игры.');
    area.append(notice);
  }
  window.ECHOModal?.open({
    title:t('round_finished','ИГРА ЗАВЕРШЕНА!'),
    contentElement:area,
    buttons:[{label:t('round_continue','ПРОДОЛЖИТЬ'),variant:'primary',value:true}],
    closeOnBackdrop:false
  });
  document.querySelector('.echo-modal')?.classList.add('echo-round-result-modal');
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
function attachSocket(socket){
  if(!socket||socket===subscribedSocket)return;
  subscribedSocket?.off('echo:roundResults',receiveResults);
  subscribedSocket=socket;
  socket.on('echo:roundResults',receiveResults);
}
// VK Mini Apps creates the Socket.IO connection after VK login completes.
document.addEventListener('echo:socket-ready',event=>attachSocket(event.detail?.socket||window.echoSocket));
attachSocket(window.echoSocket);

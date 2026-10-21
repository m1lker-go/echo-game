const panel=document.querySelector('#echo-room-leaderboard');
const clock=document.querySelector('#echo-board-clock');
const room=document.querySelector('#echo-board-room');
const list=document.querySelector('#echo-board-list');
const me=document.querySelector('#echo-board-me');
const tabs=[...document.querySelectorAll('[data-board-tab]')];
let selected='rating';
let board=null;
let deadline=0;
let offset=0;
let currentRound=null;
let subscribedSocket=null;
const lang=()=>document.documentElement.lang?.startsWith('en')?'en':'ru';
const label=(ru,en)=>lang()==='en'?en:ru;
function render(){
  for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab.dataset.boardTab===selected));
  const data=board?.[selected];
  list.replaceChildren();
  if(!data){list.textContent=label('Ожидание игроков…','Waiting for players…');me.textContent='';return;}
  for(const entry of data.top||[]){
    const line=document.createElement('div');
    line.className='echo-leaderboard-line';
    const name=document.createElement('span');
    name.className='echo-leaderboard-name';
    name.textContent=entry.place+'. '+entry.name;
    const value=document.createElement('span');
    value.textContent=Number(entry.value||0).toLocaleString();
    line.append(name,value);
    list.append(line);
  }
  me.replaceChildren();
  if(data.me && !data.top.some(p=>p.place===data.me.place)){
    const name=document.createElement('span');
    name.textContent=data.me.place+'. '+label('Вы','You');
    const value=document.createElement('span');
    value.textContent=Number(data.me.value||0).toLocaleString();
    me.append(name,value);
  }
}
function updateClock(){
  if(!deadline)return;
  const left=Math.max(0,Math.ceil((deadline-(Date.now()+offset))/1000));
  clock.textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');
}
function onRoom(data){
  if(currentRound!==data.round?.id){board=null;render();}
  currentRound=data.round?.id;
  room.textContent=label('Комната ','Room ')+data.roomId;
  if(Number.isFinite(data.round?.endsAt))deadline=data.round.endsAt;
  updateClock();
}
function onRoundClock(data){
  if(Number.isFinite(data.serverNow))offset=data.serverNow-Date.now();
  if(Number.isFinite(data.endsAt))deadline=data.endsAt;
  updateClock();
}
function onLeaderboard(data){
  if(!data || (currentRound && data.roundId!==currentRound))return;
  board=data;
  render();
}
function onDisconnect(){clock.textContent='--:--';}
function attachSocket(socket){
  if(!socket || subscribedSocket===socket)return;
  if(subscribedSocket){
    subscribedSocket.off('echo:room',onRoom);
    subscribedSocket.off('echo:roundClock',onRoundClock);
    subscribedSocket.off('echo:leaderboard',onLeaderboard);
    subscribedSocket.off('disconnect',onDisconnect);
  }
  subscribedSocket=socket;
  socket.on('echo:room',onRoom);
  socket.on('echo:roundClock',onRoundClock);
  socket.on('echo:leaderboard',onLeaderboard);
  socket.on('disconnect',onDisconnect);
  // In VK Mini Apps the socket is created after asynchronous VK authentication.
  // If it connected before this module ran, ask the server for room/clock state.
  if(socket.connected)socket.emit('echo:hello',{version:1});
}
tabs.forEach(tab=>tab.addEventListener('click',()=>{selected=tab.dataset.boardTab;render();}));
document.addEventListener('echo:socket-ready',event=>attachSocket(event.detail?.socket||window.echoSocket));
attachSocket(window.echoSocket);
render();
setInterval(updateClock,1000);
window.addEventListener('languagechange',render);

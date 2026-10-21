'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../../client/game.js'),'utf8');
function testHarness({ playing, vk, signedIn }) {
 const begin=source.indexOf('function inActiveGame(){');
 const end=source.indexOf('let lastDailyPing=0;',begin);
 const menuStart=source.indexOf('function returnToMenu(){',end);
 const menuEnd=source.indexOf('gameExitButton?.addEventListener',menuStart);
 assert.ok(begin>=0&&end>begin&&menuStart>end&&menuEnd>menuStart);
 const handlers=new Map();
 let connectCalls=0;
 const menu={
  classList: {
   contains:className=>className==='is-hidden'&&playing,
   remove:className=>{if(className==='is-hidden')playing=false}
  }
 };
 const root={classList:{remove() {}}};
 const main={removeAttribute() {}};
 const state={socket:null,others:new Map([['old-player',{}]])};
 const window={isVKMiniApp:vk, ECHOAuth:{getCurrent:()=>signedIn?{accountId:'x'}:null},echoSocket:null};
 const document={
  querySelector:id=>id==='#main-menu'?menu:null,
  getElementById:id=>id==='game'?root:id==='menu-main'?main:null,
  addEventListener:(type,fn)=>handlers.set(type,fn),
  dispatchEvent:()=>{}
 };
 const localStorage={getItem:()=>signedIn?'valid-session-token':null};
 const makeSocket=()=>{
  const socket={disconnectCalls:0,auth:{accountToken:'valid-session-token'},
   disconnect(){this.disconnectCalls++;return this;},connect(){return this;}};
  return socket;
 };
 const sandbox={state,window,document,localStorage,guestPlayerName:'Guest',playerName:'Guest',
  setConnection(){},connectSocket(){connectCalls++;state.socket=makeSocket();window.echoSocket=state.socket},
  Event:class Event{constructor(type){this.type=type}}
 };
 vm.createContext(sandbox);
 vm.runInContext(source.slice(begin,end)+'\n'+source.slice(menuStart,menuEnd),sandbox);
 return {state,window,menu,sandbox,
  get connectCalls(){return connectCalls},
  enter(){playing=true},
  authenticate(){signedIn=true;handlers.get('echo:auth-changed')({detail:{authenticated:true,nickname:'Player'}})},
  returnToMenu(){vm.runInContext('returnToMenu()',sandbox)}
 };
}

test('menu does not reserve an online game slot on the ordinary website',()=>{
 const h=testHarness({playing:false,vk:false,signedIn:true});
 assert.equal(h.connectCalls,0);
 h.authenticate();
 assert.equal(h.connectCalls,0);
});

test('leaving game via the X releases the active socket even if menu stays open',()=>{
 const h=testHarness({playing:true,vk:false,signedIn:true});
 assert.equal(h.connectCalls,1);
 const first=h.state.socket;
 h.returnToMenu();
 assert.equal(first.disconnectCalls,1);
 assert.equal(h.state.socket,null);
 assert.equal(h.window.echoSocket,null);
 assert.equal(h.menu.classList.contains('is-hidden'),false);
 assert.equal(h.state.others.size,0);
 h.authenticate();
 assert.equal(h.connectCalls,1,'account refresh in menu must not rejoin');
 h.enter();
 h.authenticate();
 assert.equal(h.connectCalls,2,'the account can start playing again');
});

test('VK waits for its login when in a match, then disconnects on return to menu',()=>{
 const h=testHarness({playing:true,vk:true,signedIn:false});
 assert.equal(h.connectCalls,0);
 h.authenticate();
 assert.equal(h.connectCalls,1);
 const socket=h.state.socket;
 h.returnToMenu();
 assert.equal(socket.disconnectCalls,1);
 assert.equal(h.state.socket,null);
});

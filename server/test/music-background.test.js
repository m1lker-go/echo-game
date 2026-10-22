'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../client/music-manager.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../../client/index.html'),'utf8');
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
function emitter(){
 const listeners=new Map();
 return {
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn)},
  fire(name){for(const fn of [...(listeners.get(name)||[])])fn({type:name})},
  dispatchEvent(event){this.fire(event.type)}
 };
}
function harness({hidden=false,deferFirst=false,blocked=false}={}){
 const document=Object.assign(emitter(),{hidden});
 const window=emitter();
 const saved=new Map();
 let resolvePlay;
 class FakeAudio {
  constructor(){this.paused=true;this.currentTime=0;this.duration=180;this.playCalls=0;this.pauseCalls=0;this.listeners=new Map();FakeAudio.instance=this}
  addEventListener(name,fn){this.listeners.set(name,fn)}
  removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name)}
  load(){}
  pause(){this.pauseCalls++;this.paused=true}
  play(){
   this.playCalls++;
   if(blocked){blocked=false;return Promise.reject(Object.assign(new Error('gesture required'),{name:'NotAllowedError'}))}
   if(deferFirst&&this.playCalls===1)return new Promise(resolve=>{resolvePlay=resolve});
   this.paused=false;
   return Promise.resolve();
  }
 }
 const localStorage={getItem:()=>null,setItem:()=>{}};
 const sessionStorage={
  getItem:k=>saved.get(k)??null,
  setItem:(k,v)=>saved.set(k,v)
 };
 Object.assign(window,{});
 vm.runInNewContext(source,{Audio:FakeAudio,window,document,sessionStorage,localStorage,console,CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail}}});
 return {
  audio:FakeAudio.instance,document,window,saved,
  hidden(value){document.hidden=value;document.fire('visibilitychange')},
  resolveFirst(){if(!resolvePlay)throw Error('No pending play');resolvePlay()}
 };
}
test('music pauses when tab is hidden and resumes at the same position',async()=>{
 const h=harness();await tick();
 assert.equal(h.audio.playCalls,1);
 h.audio.currentTime=42;
 h.hidden(true);
 assert.equal(h.audio.paused,true);
 assert.equal(JSON.parse(h.saved.get('echo.music.playback')).time,42);
 h.document.fire('pointerdown');
 assert.equal(h.audio.playCalls,1,'hidden gestures must not start audio');
 h.hidden(false);await tick();
 assert.equal(h.audio.playCalls,2);
 assert.equal(h.audio.paused,false);
 assert.equal(h.audio.currentTime,42);
});
test('blur/focus works as fallback for mobile VK Mini Apps webview',async()=>{
 const h=harness();await tick();
 h.window.fire('blur');
 assert.equal(h.audio.paused,true);
 h.window.fire('focus');await tick();
 assert.equal(h.audio.paused,false);
 assert.equal(h.audio.playCalls,2);
});
test('pagehide/pageshow pauses and restores without playing before page becomes visible',async()=>{
 const h=harness();await tick();
 h.window.fire('pagehide');
 assert.equal(h.audio.paused,true);
 h.hidden(true);
 h.window.fire('pageshow');
 assert.equal(h.audio.playCalls,1,'pageshow cannot play while the tab is hidden');
 h.hidden(false);await tick();
 assert.equal(h.audio.playCalls,2);
 assert.equal(h.audio.paused,false);
});
test('repeated hide events preserve the single resume and do not restart twice',async()=>{
 const h=harness();await tick();
 h.hidden(true);
 h.hidden(true);
 h.window.fire('blur');
 h.hidden(false);
 assert.equal(h.audio.playCalls,1);
 h.window.fire('focus');await tick();
 assert.equal(h.audio.playCalls,2);
 h.window.fire('focus');await tick();
 assert.equal(h.audio.playCalls,2);
});
test('music never autoplays from hidden launch; a later interaction can start it',async()=>{
 const h=harness({hidden:true});await tick();
 assert.equal(h.audio.playCalls,0);
 h.hidden(false);
 assert.equal(h.audio.playCalls,0);
 h.document.fire('pointerdown');await tick();
 assert.equal(h.audio.playCalls,1);
});
test('a delayed audio.play response cannot start background music',async()=>{
 const h=harness({deferFirst:true});
 assert.equal(h.audio.playCalls,1);
 h.hidden(true);
 h.resolveFirst();await tick();
 assert.equal(h.audio.paused,true);
 assert.equal(h.audio.playCalls,1);
 h.hidden(false);await tick();
 assert.equal(h.audio.playCalls,2);
 assert.equal(h.audio.paused,false);
});
test('blocked autoplay is still unlockable after returning from background',async()=>{
 const h=harness({blocked:true});await tick();
 assert.equal(h.audio.paused,true);
 h.hidden(true);
 h.hidden(false);await tick();
 assert.equal(h.audio.playCalls,2);
 assert.equal(h.audio.paused,false);
});
test('playlist and volume management remain intact, updated script bypasses client cache',()=>{
 assert.match(source,/musicgame\$\{String\(index \+ 1\)/);
 assert.match(source,/audio\.addEventListener\('ended', advanceTrack\)/);
 assert.match(source,/setMusicVolume\(value\)/);
 assert.match(html,/music-manager\.js\?v=echo-visibility-pause-1/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.join(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
const src=fs.readFileSync(path.join(root,'client/voice-transport.js'),'utf8');
const vendor=fs.readFileSync(path.join(root,'scripts/install-client-deps.sh'),'utf8');

test('voice transport is linked after UI, lazily loads pinned SDK',()=>{
  assert.ok(html.indexOf('voice-ui.js') < html.indexOf('voice-transport.js'));
  assert.ok(html.includes('voice-transport.js?v=echo-livekit-voice-6'));
  assert.ok(src.includes("if (!enabled || !socket?.connected || !inGame()) return;"));
  assert.ok(src.includes("echo:voice:join"));
  assert.ok(src.includes("scheduleRetry()"));
  assert.ok(src.includes("window.addEventListener('focus'"));
  assert.ok(!src.includes("window.addEventListener('blur',disconnectVoice)"), 'transient Safari blur must not tear down a voice room');
  assert.ok(src.includes("if (connected()) void room.startAudio?.().catch(() => {});"), 'unlock Safari audio on a user gesture');
  assert.ok(src.includes("document.addEventListener('visibilitychange'"), 'still disconnect when backgrounded');
  assert.ok(src.includes("classifyConnectError(error)"));
  assert.ok(src.includes("DISCONNECTED_"));
  assert.ok(src.includes("roomSnapshot = incoming"));
  assert.ok(src.includes("socket.on('connect_error',socketConnectError)"));
  assert.ok(src.includes("SOCKET_TRANSPORT_CLOSED"));
  assert.ok(src.includes("return socketIssue || 'SOCKET_NOT_STARTED'"));
  assert.ok(src.includes("get status()"));
  assert.ok(src.includes("autoSubscribe:false"));
  assert.ok(vendor.includes("livekit-client@2.23.0"));
  assert.ok(vendor.includes("livekit-client-2.23.0.min.js"));
});

test('voice subscription follows the 500-800 range and server player snapshots',()=>{
  assert.ok(src.includes('const FULL = 500, MAX = 800;'));
  assert.ok(src.includes('const transmittingNearby = new Set();'));
  assert.ok(src.includes('microphonePublications.some(publication => !publication.isMuted)'));
  assert.ok(src.includes('for (const id of transmittingNearby) if (!talking.has(id)) speaker(id,true)'));
  assert.ok(!src.includes('!isMuted(p.identity)'));
  assert.ok(src.includes("socket.on('echo:players',onPlayers)"));
  assert.ok(src.includes("p.id === socket?.id"));
  assert.ok(src.includes("d < MAX && !isMuted(id)"));
  assert.ok(src.includes("publication.setSubscribed(wanted)"));
  assert.ok(src.includes("currentRoom.localParticipant.publishTrack"));
  assert.ok(src.includes("track.enabled = false"));
});

test('gameplay Socket.IO remains untouched and voice synchronizes with current game socket', () => {
  const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
  assert.ok(game.includes("transports:['websocket','polling'],reconnection:true,timeout:5000"));
  assert.ok(!game.includes('isIOSSocketClient'));
  assert.ok(html.includes('game.js?v=echo-camera-jitter-1'));
  assert.ok(src.includes('function syncGameSocket()'));
  assert.ok(src.includes('if (current && current !== socket) bindSocket(current)'));
  assert.ok(src.includes('if (inGame()) syncGameSocket()'));
});

test('voice module detects a late gameplay socket and then its replacement', () => {
  const window={echoSocket:null,addEventListener(){}};
  const document={
    hidden:false,
    querySelector:selector=>selector==='#main-menu'
      ? {classList:{contains: name=>name==='is-hidden'}} : null,
    addEventListener(){}
  };
  vm.runInNewContext(src,{window,document,console,
    setInterval(){return 1;},clearInterval(){},
    setTimeout(){return 1;},clearTimeout(){},queueMicrotask},{filename:'voice-transport.js'});
  function fakeSocket(){
    const handlers=new Map(),emitted=[];
    return {connected:true,id:'socket-test',handlers,emitted,
      on(event,fn){handlers.set(event,fn);},
      off(event,fn){if(handlers.get(event)===fn)handlers.delete(event);},
      emit(event,params){emitted.push([event,params]);}};
  }
  const first=fakeSocket();window.echoSocket=first;
  assert.equal(window.ECHOVoiceTransport.status,'WAIT_SERVER');
  assert.ok(first.handlers.has('echo:voice:availability'));
  assert.ok(first.emitted.some(e=>e[0]==='echo:hello'));
  const replacement=fakeSocket();window.echoSocket=replacement;
  assert.equal(window.ECHOVoiceTransport.status,'WAIT_SERVER');
  assert.equal(first.handlers.has('echo:voice:availability'),false);
  assert.ok(replacement.emitted.some(e=>e[0]==='echo:hello'));
});

test('voice transport parses as standalone JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(src, {filename:'voice-transport.js'}));
});

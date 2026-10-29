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
  assert.ok(html.includes('voice-transport.js?v=echo-livekit-voice-5'));
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

test('iPhone game Socket.IO uses polling-first fallback, without changing other clients', () => {
  const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
  assert.ok(game.includes("const isIOSSocketClient = /iPad|iPhone|iPod/.test(navigator.userAgent || '')"));
  assert.ok(game.includes("transports:isIOSSocketClient?['polling','websocket']:['websocket','polling']"));
  assert.ok(game.includes('tryAllTransports:isIOSSocketClient'));
  assert.ok(game.includes('timeout:isIOSSocketClient?10000:5000'));
  assert.ok(html.includes('game.js?v=echo-ios-socket-fallback-1'));
});

test('voice transport parses as standalone JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(src, {filename:'voice-transport.js'}));
});

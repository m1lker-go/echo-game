'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
const src=fs.readFileSync(path.join(root,'client/voice-transport.js'),'utf8');
const vendor=fs.readFileSync(path.join(root,'scripts/install-client-deps.sh'),'utf8');

test('voice transport is linked after UI, lazily loads pinned SDK',()=>{
  assert.ok(html.indexOf('voice-ui.js') < html.indexOf('voice-transport.js'));
  assert.match(html,/voice-transport\\.js\\?v=echo-livekit-voice-1/);
  assert.ok(src.includes("if (!enabled || !socket?.connected || !inGame()) return;"));
  assert.ok(src.includes("echo:voice:join"));
  assert.ok(src.includes("autoSubscribe:false"));
  assert.ok(vendor.includes("livekit-client@2.23.0"));
  assert.ok(vendor.includes("livekit-client-2.23.0.min.js"));
});

test('voice subscription follows the 500-800 range and server player snapshots',()=>{
  assert.ok(src.includes('const FULL = 500, MAX = 800;'));
  assert.ok(src.includes("socket.on('echo:players',onPlayers)"));
  assert.ok(src.includes("p.id === socket?.id"));
  assert.ok(src.includes("d < MAX && !isMuted(id)"));
  assert.ok(src.includes("publication.setSubscribed(wanted)"));
  assert.ok(src.includes("currentRoom.localParticipant.publishTrack"));
  assert.ok(src.includes("track.enabled = false"));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceService } = require('../voice-service');

const secret = 'S'.repeat(40);
function mockSdk() {
  const calls = [];
  class AccessToken {
    constructor(key, value, options) { this.options=options; calls.push(['token', key, value, options]); }
    addGrant(grant) { this.grant=grant; calls.push(['grant', grant]); }
    async toJwt() { return 'mock-jwt'; }
  }
  class RoomServiceClient {
    constructor(url,key,secret) { calls.push(['service', url, key, secret]); }
    async removeParticipant(room,id) { calls.push(['remove', room, id]); }
  }
  return { sdk: {AccessToken,RoomServiceClient},calls };
}
function player(roundId, roomId=1) { return { id:'sock-123',roundId,roomId,name:'Guest',defeated:false }; }

test('no LiveKit secrets means disabled voice without importing dependencies', async () => {
  const voice=createVoiceService({env:{}});
  assert.equal(voice.enabled,false);
  assert.equal(await voice.createJoin(player('123'),'sock-123'),null);
  await voice.remove(player('123'));
});

test('only full secure configuration enables voice', () => {
  const mock=mockSdk();
  for(const env of [
    {ECHO_LIVEKIT_URL:'http://voice.cat-fight.ru',ECHO_LIVEKIT_API_KEY:'123456',ECHO_LIVEKIT_API_SECRET:secret},
    {ECHO_LIVEKIT_URL:'wss://voice.cat-fight.ru',ECHO_LIVEKIT_API_KEY:'123456',ECHO_LIVEKIT_API_SECRET:'short'}
  ])assert.equal(createVoiceService({env,sdk:mock.sdk}).enabled,false);
  assert.equal(mock.calls.length,0);
});

test('join token is issued for server-owned identity, one round/room, microphone only', async () => {
  const {roundWindow}=require('../room-manager');
  const mock=mockSdk();
  const voice=createVoiceService({
    nodeMajor:22,
    env:{ECHO_LIVEKIT_URL:'wss://voice.cat-fight.ru',ECHO_LIVEKIT_API_URL:'http://127.0.0.1:7880',
      ECHO_LIVEKIT_API_KEY:'publickey',ECHO_LIVEKIT_API_SECRET:secret},sdk:mock.sdk
  });
  const p=player(roundWindow().id,3);
  const result=await voice.createJoin(p,p.id);
  assert.equal(result.token,'mock-jwt');
  assert.equal(result.url,'wss://voice.cat-fight.ru');
  assert.equal(result.identity,p.id);
  assert.equal(result.roomId,3);
  assert.equal(result.roundId,p.roundId);
  const grant=mock.calls.find(x=>x[0]==='grant')[1];
  assert.equal(grant.room,'echo-voice:'+p.roundId+':3');
  assert.deepEqual(grant.canPublishSources,['microphone']);
  assert.equal(grant.canPublishData,false);
  assert.equal(grant.canSubscribe,true);
  assert.equal(mock.calls.find(x=>x[0]==='token')[3].ttl,60);
  assert.equal(await voice.createJoin({...p,defeated:true},p.id),null);
  assert.equal(await voice.createJoin(p,'forged-id'),null);
  assert.equal(await voice.createJoin({...p,roundId:'0'},p.id),null);
  assert.ok(!JSON.stringify(result).includes(secret));
  await voice.remove(p);
  assert.deepEqual(mock.calls.at(-1),['remove','echo-voice:'+p.roundId+':3',p.id]);
});

test('legacy Node 18 cannot activate LiveKit even with credentials set', async () => {
  const mock=mockSdk();
  const oldWarn=console.warn;
  console.warn=()=>{};
  try {
    const voice=createVoiceService({nodeMajor:18,
      env:{ECHO_LIVEKIT_URL:'wss://voice.cat-fight.ru',
        ECHO_LIVEKIT_API_KEY:'publickey',ECHO_LIVEKIT_API_SECRET:secret},sdk:mock.sdk});
    assert.equal(voice.enabled,false);
    assert.equal(mock.calls.length,0);
  } finally { console.warn=oldWarn; }
});

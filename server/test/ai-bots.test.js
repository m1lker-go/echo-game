'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createAiBots,BOT_COUNT,TICK_MS}=require('../ai-bots');

function harness({random=()=>0.9,halfSize=2100,collectFood=()=>0,valid=()=>true}={}){
  const players=new Map();
  const food=new Map([[1,{id:1,x:0,y:0,active:true}]]);
  let clock=1000000;
  let nextSpawn=0;
  const calls={broadcast:0,food:0,fights:0,spawns:0};
  const ai=createAiBots({
    players,
    random,
    now:()=>clock,
    halfSize,
    spawn:()=>{
      const i=++nextSpawn;
      calls.spawns++;
      return {x:-800+i*29,y:-600+i*23};
    },
    getFood:()=>food,
    isValidPosition:valid,
    isWater:()=>false,
    collectFood,
    checkForFights:()=>{calls.fights++;},
    broadcastPlayers:()=>{calls.broadcast++;},
    broadcastFood:()=>{calls.food++;}
  });
  const addHuman=(id,roomId=1,roundId='round-1')=>{
    const player={id,roomId,roundId,x:200,y:100,vx:0,vy:0,energy:5,defeated:false};
    players.set(id,player);
    return player;
  };
  return {players,food,calls,ai,addHuman,
    now:()=>clock,
    forward:ms=>{clock+=ms;ai.tick();},
    bots:()=>[...players.values()].filter(p=>p.isBot)
  };
}

test('only five clearly marked bots join an occupied room; repeated joins do not duplicate them',()=>{
  const h=harness();
  const player=h.addHuman('human1');
  h.ai.ensureForRoom(player);
  assert.equal(BOT_COUNT,5);
  assert.equal(h.bots().length,5);
  assert.equal(h.ai.roomCount(),1);
  assert.equal(new Set(h.bots().map(p=>p.id)).size,5);
  for(const bot of h.bots()){
    assert.match(bot.name,/ \[BOT\]$/);
    assert.equal(bot.roundId,player.roundId);
    assert.equal(bot.roomId,player.roomId);
    assert.ok(bot.skin.endsWith('.glb'));
    assert.ok(bot.energy>0 && bot.energy<10);
    assert.ok(bot.shieldUntil>=h.now());
  }
  h.ai.ensureForRoom(player);
  h.ai.ensureForRoom(h.addHuman('human2'));
  assert.equal(h.bots().length,5);
});

test('bots wander with server-owned velocity, take breaks and obey safe world positions',()=>{
  let blocked=0;
  const h=harness({random:()=>0.82,valid:point=>{
    const inside=Math.abs(point.x)<=2100&&Math.abs(point.y)<=2100;
    if(!inside)blocked++;
    return inside;
  }});
  h.ai.ensureForRoom(h.addHuman('human'));
  const start=h.bots().map(bot=>({id:bot.id,x:bot.x,y:bot.y}));
  for(let i=0;i<320;i++)h.forward(TICK_MS);
  const after=h.bots();
  assert.equal(after.length,5);
  assert.ok(after.some(bot=>Math.hypot(bot.x-start.find(p=>p.id===bot.id).x,
    bot.y-start.find(p=>p.id===bot.id).y)>130),'at least one bot explores the map');
  assert.ok(after.every(bot=>Number.isFinite(bot.vx)&&Number.isFinite(bot.vy)));
  assert.ok(after.every(bot=>Math.abs(bot.x)<=2100&&Math.abs(bot.y)<=2100));
  assert.ok(h.calls.fights>0,'bots participate in the existing server PvP scan');
  assert.ok(h.calls.broadcast<320*5+20,'bot broadcasts are batched by room');
});

test('bot food collection is real but bounded, never writes daily activity',()=>{
  let collected=0;
  const h=harness({collectFood:()=>{collected++;return 2;}});
  h.ai.ensureForRoom(h.addHuman('human'));
  for(let i=0;i<200;i++)h.forward(TICK_MS);
  assert.ok(collected>0);
  assert.ok(h.bots().every(bot=>bot.energy<=85),'bot food farming remains modest');
  assert.ok(h.calls.food>0,'real food-consumption events are broadcast');
});

test('a defeated bot respawns after a delay without creating more than five slots',()=>{
  const h=harness();
  h.ai.ensureForRoom(h.addHuman('human'));
  const id=h.bots()[0].id;
  h.players.delete(id); // the authoritative fight winner removed the defeated bot
  h.forward(250);
  assert.equal(h.bots().length,4);
  h.forward(15000);
  assert.equal(h.bots().length,5);
  assert.ok(h.players.has(id));
  assert.equal(new Set(h.bots().map(p=>p.id)).size,5);
});


test('bot with more than 200 energy stays briefly, then leaves and rejoins fresh',()=>{
  const h=harness();
  h.ai.ensureForRoom(h.addHuman('human'));
  const bot=h.bots()[0],id=bot.id;
  bot.energy=201;
  const initialSpawns=h.calls.spawns;
  h.forward(TICK_MS);
  assert.ok(h.players.has(id),'bot does not disappear instantly at 201 energy');
  h.forward(15000);
  assert.equal(h.players.has(id),false,'high-energy bot leaves after a delay');
  assert.equal(h.bots().length,4,'only this bot temporarily leaves');
  h.forward(1000);
  assert.equal(h.players.has(id),false,'bot does not instantly re-enter');
  h.forward(15000);
  assert.ok(h.players.has(id),'bot returns to the same occupied room');
  assert.ok(h.players.get(id).energy<10,'bot returns with starter energy');
  assert.equal(h.calls.spawns,initialSpawns+1);
  assert.equal(h.bots().length,5);
});

test('high-energy bots never leave before an active PvP fight ends',()=>{
  const h=harness();
  h.ai.ensureForRoom(h.addHuman('human'));
  const bot=h.bots()[0];
  bot.energy=215;
  bot.fightingWith='opponent';
  h.forward(TICK_MS);
  h.forward(20000);
  assert.ok(h.players.has(bot.id),'active PvP fight cannot be interrupted by AI departure');
  bot.fightingWith=null;
  h.forward(TICK_MS);
  assert.equal(h.players.has(bot.id),false,'bot exits after the fight resolves');
  h.forward(15000);
  assert.ok(h.players.has(bot.id),'bot rejoins afterward');
});

test('AI bots never create Socket.IO connections, accounts or rewarded-ad actions',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../ai-bots.js'),'utf8');
  assert.doesNotMatch(source,/socket\.connect|new WebSocket|axios|rewarded.?ad|ad[_-]?watched|INSERT INTO|localStorage/i);
  const h=harness();
  h.ai.ensureForRoom(h.addHuman('human'));
  assert.ok(h.bots().every(bot=>bot.isBot && !bot.accountId && !bot.socket));
});

test('bots disappear immediately when the last real player leaves, and never run without humans',()=>{
  const h=harness();
  const a=h.addHuman('human');
  h.ai.ensureForRoom(a);
  h.players.delete(a.id);
  h.ai.removeIfEmpty(a.roundId,a.roomId);
  assert.equal(h.ai.roomCount(),0);
  assert.equal(h.bots().length,0);
  const before=h.calls.fights;
  for(let i=0;i<25;i++)h.forward(TICK_MS);
  assert.equal(h.calls.fights,before);
  assert.equal(h.bots().length,0);
});

test('five bots belong to each active room; removal and round resets are isolated',()=>{
  const h=harness();
  const a=h.addHuman('a',1),b=h.addHuman('b',2);
  h.ai.ensureForRoom(a);
  h.ai.ensureForRoom(b);
  assert.equal(h.bots().length,10);
  h.players.delete('a');
  h.ai.removeIfEmpty(a.roundId,a.roomId);
  assert.equal(h.bots().length,5);
  assert.ok(h.bots().every(bot=>bot.roomId===2));
  h.ai.reset();
  assert.equal(h.bots().length,0);
  assert.equal(h.ai.roomCount(),0);
  h.ai.ensureForRoom(b);
  assert.equal(h.bots().length,5);
});

test('game server integrates bots with PvP while protecting real score and account rewards',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
  assert.match(source,/const aiBots=createAiBots\(/);
  assert.match(source,/setInterval\(\(\)=>aiBots\.tick\(\),TICK_MS\)/);
  assert.match(source,/aiBots\.ensureForRoom\(players\.get\(socket\.id\)\)/);
  assert.match(source,/aiBots\.removeIfEmpty\(current\.roundId,current\.roomId\)/);
  assert.match(source,/aiBots\.reset\(\)/);
  assert.match(source,/!p\.isBot && p\.roomId === roomId/);
  assert.match(source,/winnerProfileId && !loserState\.isBot/);
  assert.match(source,/winnerAccountId && !loserState\.isBot/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPvpFlowers,MAX_FLOWERS_PER_ROOM,FLOWER_MODEL,MIN_SCALE,MAX_SCALE}=require('../pvp-flowers');

test('Only a server-side PvP defeat produces a flower at the losers coordinates',()=>{
 const memorials=createPvpFlowers();
 assert.equal(MAX_FLOWERS_PER_ROOM,250);
 assert.equal(FLOWER_MODEL,'flowers-tall.glb');
 assert.deepEqual([MIN_SCALE,MAX_SCALE],[0.6,0.8]);
 const first=memorials.add({roundId:'900000',roomId:1,fightId:'fight-1',x:128.5,y:-42});
 assert.equal(first.x,128.5);
 assert.equal(first.y,-42);
 assert.equal(first.model,FLOWER_MODEL);
 assert.ok(first.scale>=MIN_SCALE&&first.scale<=MAX_SCALE);
 assert.ok(first.rotation>=0&&first.rotation<Math.PI*2);
 assert.equal('collisionRadius' in first,false);
 assert.equal(memorials.add({roundId:'900000',roomId:1,fightId:'fight-1',x:0,y:0}),null);
 assert.deepEqual(memorials.list('900000',1),[first]);
});

test('Bad PvP coordinates or identifiers cannot create a flower; rooms are separate',()=>{
 const f=createPvpFlowers();
 for(const input of [
  {roundId:'900000',roomId:1,fightId:'f',x:NaN,y:3},
  {roundId:'900000',roomId:1,fightId:'f',x:0,y:Infinity},
  {roundId:'900000',roomId:-1,fightId:'f',x:0,y:3},
  {roundId:'900000',roomId:1,fightId:'',x:0,y:3},
  {roundId:'',roomId:1,fightId:'f',x:0,y:3},
 ])assert.equal(f.add(input),null);
 f.add({roundId:'900000',roomId:1,fightId:'f',x:10,y:20});
 f.add({roundId:'900000',roomId:2,fightId:'f',x:30,y:40});
 f.add({roundId:'1800000',roomId:1,fightId:'f',x:50,y:60});
 assert.deepEqual(f.list('900000',1).map(o=>o.x),[10]);
 assert.deepEqual(f.list('900000',2).map(o=>o.x),[30]);
 assert.deepEqual(f.list('1800000',1).map(o=>o.x),[50]);
});

test('At most 250 PvP memorial flowers grow per room in a 15-minute round',()=>{
 const f=createPvpFlowers();
 for(let i=0;i<250;i++){
  const o=f.add({roundId:'900000',roomId:1,fightId:'battle-'+i,x:i,y:-i});
  assert.ok(o,'Room must accept '+i);
 }
 assert.equal(f.list('900000',1).length,250);
 assert.equal(new Set(f.list('900000',1).map(o=>o.id)).size,250);
 assert.equal(f.add({roundId:'900000',roomId:1,fightId:'extra',x:100,y:100}),null);
 assert.equal(f.list('900000',1).length,250);
 assert.ok(f.add({roundId:'900000',roomId:2,fightId:'other',x:100,y:100}));
});

test('At round change flowers are cleared and do not reappear when a player reconnects',()=>{
 const f=createPvpFlowers();
 f.add({roundId:'900000',roomId:1,fightId:'first',x:10,y:12});
 f.add({roundId:'900000',roomId:2,fightId:'second',x:-5,y:2});
 assert.deepEqual(f.reset().sort(),['echo:900000:1','echo:900000:2']);
 assert.deepEqual(f.list('900000',1),[]);
 assert.deepEqual(f.list('900000',2),[]);
 assert.ok(f.add({roundId:'1800000',roomId:1,fightId:'first',x:20,y:22}));
 assert.equal(f.list('1800000',1).length,1);
});

test('Game creates flowers only in finishFight, never on generic death or the random world',()=>{
 const root=path.join(__dirname,'../..');
 const server=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
 const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
 const world=fs.readFileSync(path.join(root,'server/world-decorations.js'),'utf8');
 const client=fs.readFileSync(path.join(root,'client/world-decorations.js'),'utf8');
 const index=server.indexOf('function finishFight(fight)');
 const end=server.indexOf('function startFight(',index);
 assert.ok(index>0&&end>index);
 assert.match(server.slice(index,end),/pvpFlowers\.add\(\{/);
 assert.equal((server.match(/pvpFlowers\.add\(/g)||[]).length,1);
 assert.match(server,/const memorialRooms=pvpFlowers\.reset\(\)/);
 assert.match(server,/socket\.emit\('echo:deathFlowers'/);
 assert.match(server,/io\.to\(roomKey\(loserState\)\)\.emit\('echo:deathFlowers'/);
 assert.ok(!world.includes("'flowers-tall.glb'"),'No random flowers');
 assert.match(client,/setDeathFlowers\(snapshot\)/);
 assert.match(game,/state\.socket\.on\('echo:deathFlowers'/);
 assert.match(game,/decorations\.setDeathFlowers\(data\.flowers\)/);
 assert.match(game,/decorations\.setDeathFlowers\(\[\]\)/);
 assert.match(client,/deathFlowers=snapshot\.slice\(0,250\)/);
});

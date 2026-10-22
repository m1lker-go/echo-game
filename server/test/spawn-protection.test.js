'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SHIELD_DURATION_MS,hasSpawnShield,chooseSafeSpawn}=require('../spawn-protection');
const server=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
const game=fs.readFileSync(path.join(__dirname,'../../client/game.js'),'utf8');
const dome=fs.readFileSync(path.join(__dirname,'../../client/spawn-shield.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../../client/index.html'),'utf8');
test('PvP protection lasts exactly 5000 milliseconds',()=>{
 const now=100000;
 assert.equal(SHIELD_DURATION_MS,5000);
 assert.equal(hasSpawnShield({shieldUntil:now+5000},now),true);
 assert.equal(hasSpawnShield({shieldUntil:now+5000},now+4999),true);
 assert.equal(hasSpawnShield({shieldUntil:now+5000},now+5000),false);
});
test('respawn selects real random coordinates across the square map',()=>{
 const sectors=new Set();
 for(let i=0;i<100;i++){
  const p=chooseSafeSpawn({halfSize:2100,isSafe:()=>true});
  assert.ok(Math.abs(p.x)<=2010&&Math.abs(p.y)<=2010);
  sectors.add(Math.floor((p.x+2100)/1400)+','+Math.floor((p.y+2100)/1400));
 }
 assert.ok(sectors.size>=7);
});
test('unsafe spawn attempts are skipped and never fall back into water',()=>{
 const p=chooseSafeSpawn({halfSize:2100,isSafe:p=>p.x>1000&&p.y>1000,random:()=>.5,maxAttempts:3});
 assert.ok(p.x>1000&&p.y>1000);
 assert.throws(()=>chooseSafeSpawn({halfSize:2100,isSafe:()=>false,random:()=>.5,maxAttempts:0}),/No safe spawn/);
});
test('server excludes polygon water, shoreline trees, and nearby players',()=>{
 assert.match(server,/isValidPlayerPosition\(point\)/);
 assert.match(server,/isPointOnWater\(point,water\)/);
 assert.match(server,/distanceToWaterSegment\(point,vertices\[i\],vertices\[\(i\+1\)%vertices\.length\]\)/);
 assert.match(server,/Math\.hypot\(point\.x-other\.x,point\.y-other\.y\)<130/);
});
test('server refuses either player being shielded for PvP',()=>{
 assert.match(server,/function startFight\(a, b\)[\s\S]*?hasSpawnShield\(a\)\|\|hasSpawnShield\(b\)/);
 assert.match(server,/function checkForFights\(source\)[\s\S]*?hasSpawnShield\(source\)/);
 assert.match(server,/hasSpawnShield\(opponent\)/);
});
test('initial spawn and each round reset synchronize server-selected position',()=>{
 assert.match(server,/socket\.emit\('echo:spawn',\s*\{x:spawn\.x,y:spawn\.y,shieldUntil:/);
 assert.match(server,/socket\.emit\('echo:spawn',\s*\{x:player\.x,y:player\.y,shieldUntil:/);
 assert.match(game,/state\.socket\.on\('echo:spawn',data=>/);
 assert.match(game,/state\.x=data\.x;state\.y=data\.y/);
 assert.match(game,/state\.socket\?\.connected&&state\.hasServerSpawn/);
});
test('PNG shield replaces geometry for local and remote players',()=>{
 assert.ok(dome.includes('assets/textures/shield.png'));
 assert.ok(dome.includes('new THREE.Sprite(new THREE.SpriteMaterial'));
 assert.ok(dome.includes('transparent:true'));
 assert.ok(dome.includes('opacity:0.6'));
 assert.ok(dome.includes('dome.position.set(0,13,0)'));
 assert.ok(dome.includes('holder.visible=false'));
 assert.ok(!dome.includes('SphereGeometry'));
 assert.ok(!dome.includes('TorusGeometry'));
 assert.ok(game.includes('attachSpawnShield(THREE,local)'));
 assert.ok(game.includes('attachSpawnShield(THREE,holder)'));
 assert.ok(game.includes('updateSpawnShield(modelCache.local,state.shieldUntil)'));
 assert.ok(game.includes('updateSpawnShield(e.root,p.shieldUntil)'));
 assert.ok(html.includes('game.js?v=echo-shield-raised-60-1'));
});

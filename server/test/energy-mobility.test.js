'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const client=fs.readFileSync(path.join(root,'client/energy-balance.js'),'utf8');
const server=require('../energy-balance');
const {createMobilityState,beginAbility,moveBudget}=require('../movement-guard');
const browser=()=>import('data:text/javascript;charset=utf-8,'+encodeURIComponent(client));
test('client and server use the same smooth growth/mobility curve',async()=>{
 const front=await browser();
 const known=[[0,0],[50,.025],[100,.05],[200,.075],[300,.1],[400,.15],[500,.2],[2000,.2]];
 for(const [energy,penalty] of known){
  assert.ok(Math.abs(front.energyPenalty(energy)-penalty)<1e-8);
  assert.ok(Math.abs(server.energyPenalty(energy)-penalty)<1e-8);
  assert.equal(front.energySpeedMultiplier(energy),server.energySpeedMultiplier(energy));
  assert.equal(front.energySizeMultiplier(energy),server.energySizeMultiplier(energy));
  assert.equal(front.energyJumpDistance(energy),server.energyJumpDistance(energy));
 }
 assert.equal(front.energyJumpDistance(500),336);
 assert.equal(front.energySizeMultiplier(500),1.2);
 assert.equal(front.energySpeedMultiplier(500),0.8);
 assert.equal(front.energyPenalty(-100),0);
});
test('boost applies exactly the same energy slowdown and respects server cooldown',()=>{
 const m=createMobilityState(0),player={energy:500,x:0,y:0};
 assert.equal(beginAbility(m,player,{type:'boost'},100),true);
 assert.equal(beginAbility(m,player,{type:'boost'},120),false);
 const decision=moveBudget(m,player,{x:25,y:0},200);
 assert.equal(decision.allowed,true);
 assert.ok(Math.abs(decision.maxVelocity-300*0.8*Math.SQRT2)<1e-6);
 assert.equal(beginAbility(m,player,{type:'boost'},3100),true);
});
test('sustained displacement is limited by server energy and not packet frequency',()=>{
 const m=createMobilityState(0),player={energy:500,x:0,y:0};
 for(let t=100;t<=1000;t+=100){
  const desired={x:player.x+12,y:0};
  const result=moveBudget(m,player,desired,t);
  assert.equal(result.allowed,true);
  player.x=desired.x;
 }
 assert.equal(moveBudget(m,player,{x:player.x+200,y:0},1100).allowed,false);
 // Spamming same-timestamp packets cannot farm unlimited motion credit.
 let accepted=0;
 for(let i=0;i<200;i++){
  const desired={x:player.x+3,y:0};
  if(moveBudget(m,player,desired,1100).allowed){player.x=desired.x;accepted++;}
 }
 assert.ok(accepted<10);
});
test('server validates jump length AND direction, with lower range for large players',()=>{
 const m=createMobilityState(0),player={x:10,y:10,energy:500};
 assert.equal(beginAbility(m,player,{type:'jump',dx:1,dy:0},100),true);
 assert.equal(m.jumpLength,336);
 assert.equal(moveBudget(m,player,{x:346,y:10},190).allowed,true);
 assert.equal(moveBudget(m,player,{x:390,y:10},190).allowed,false);
 assert.equal(moveBudget(m,player,{x:90,y:70},190).allowed,false);
 assert.equal(beginAbility(m,player,{type:'jump',dx:1,dy:0},200),false);
 assert.equal(beginAbility(m,player,{type:'jump',dx:1,dy:0},305),true);
});
test('normal running resumes after 200 ms even while jump landing packets have grace',()=>{
 const m=createMobilityState(0),player={x:0,y:0,energy:500};
 assert.equal(beginAbility(m,player,{type:'jump',dx:1,dy:0},100),true);
 assert.equal(moveBudget(m,player,{x:300,y:0},210).allowed,true);
 player.x=300;
 assert.equal(moveBudget(m,player,{x:300,y:8},320).allowed,true);
});
test('server guards resist NaN, spoofed ability directions and forged values',()=>{
 const m=createMobilityState(0),player={x:0,y:0,energy:500};
 assert.equal(beginAbility(m,player,{type:'jump',dx:100,dy:0},20),false);
 assert.equal(beginAbility(m,player,{type:'jump',dx:Infinity,dy:0},20),false);
 assert.equal(beginAbility(m,player,{type:'speed-hack'},20),false);
 assert.equal(moveBudget(m,player,{x:Infinity,y:0},100).allowed,false);
});
test('live Socket.IO handlers apply mobility server-side; rendering and joystick use energy',()=>{
 const back=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
 const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
 const controls=fs.readFileSync(path.join(root,'client/player-controls.js'),'utf8');
 const page=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
 assert.match(back,/socket\.on\('echo:ability'/);
 assert.match(back,/moveBudget\(mobility,current,desired\)/);
 assert.match(back,/socket\.emit\('echo:positionCorrection'/);
 assert.match(back,/playerMobility\.delete\(socket\.id\)/);
 assert.match(back,/Math\.hypot\(vx,vy\)/);
 assert.match(game,/energySizeMultiplier\(label\)/);
 assert.match(game,/energyJumpDistance\(state\.energy,JUMP_DISTANCE\)/);
 assert.match(game,/energySpeedMultiplier\(state\.energy\)/);
 assert.match(game,/socket\?\.emit\('echo:ability',\{type:'jump',dx,dy\}\)/);
 assert.match(game,/socket\?\.emit\('echo:ability',\{type:'boost'\}\)/);
 assert.match(game,/socket\.on\('echo:positionCorrection'/);
 assert.match(controls,/energyMobilityMultiplier/);
 assert.match(page,/game\.js\?v=echo-energy-mobility-1/);
});

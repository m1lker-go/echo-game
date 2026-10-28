'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createMobilityState,beginAbility,moveBudget}=require('../movement-guard');
const client=path.resolve(__dirname,'../../client');

for(const boosted of [false,true]){
 test(`packet bunching does not reject honest ${boosted?'boosted':'normal'} movement`,()=>{
  const player={x:0,y:0,energy:500},mobility=createMobilityState(0);
  if(boosted)assert.equal(beginAbility(mobility,player,{type:'boost'},0),true);
  const maxSpeed=(boosted?300:155)*0.8*Math.SQRT2;
  // Each packet represents 100ms of maximum legal movement; arrival times vary.
  const arrivals=[100,175,245,330,430,525];
  for(const at of arrivals){
   const desired={x:player.x+maxSpeed*0.1,y:0};
   const decision=moveBudget(mobility,player,desired,at);
   assert.equal(decision.allowed,true,`false server correction at ${at}ms`);
   player.x=desired.x;
  }
  assert.ok(Math.abs(player.x-6*maxSpeed*0.1)<0.001);
 });
}
test('burst allowance never becomes sustainable speed-hacking',()=>{
 const player={x:0,y:0,energy:500},mobility=createMobilityState(0);
 const speed=155*0.8*Math.SQRT2;
 const first={x:speed*0.18,y:0};
 assert.equal(moveBudget(mobility,player,first,100).allowed,true);
 player.x=first.x;
 const more={x:player.x+5,y:0};
 assert.equal(moveBudget(mobility,player,more,100).allowed,false);
 assert.equal(moveBudget(mobility,player,more,200).allowed,true);
 assert.equal(moveBudget(mobility,player,{x:player.x+999,y:0},200).allowed,false);
});
test('small corrections retain the prior visual position, then converge',async()=>{
 const source=fs.readFileSync(path.join(client,'movement-correction.js'),'utf8');
 const {visualCorrectionOffset,settleVisualCorrection}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
 const offset=visualCorrectionOffset(100,40,68,31);
 assert.deepEqual(offset,{x:32,y:9});
 assert.equal(68+offset.x,100);
 assert.equal(31+offset.y,40);
 let visual=offset;
 for(let i=0;i<6;i++)visual=settleVisualCorrection(visual.x,visual.y,.05);
 assert.ok(Math.hypot(visual.x,visual.y)<0.2);
 assert.deepEqual(visualCorrectionOffset(300,0,0,0),{x:0,y:0});
 assert.deepEqual(visualCorrectionOffset(NaN,0,0,0),{x:0,y:0});
});
test('physics keeps server authority; visual smoothing is render only',()=>{
 const game=fs.readFileSync(path.join(client,'game.js'),'utf8');
 const page=fs.readFileSync(path.join(client,'index.html'),'utf8');
 assert.match(game,/state\.x=data\.x;state\.y=data\.y;state\.cameraX=data\.x\+correction\.x/);
 assert.match(game,/visualCorrectionOffset\(visualX,visualY,data\.x,data\.y\)/);
 assert.match(game,/settleVisualCorrection\(state\.visualCorrectionX,state\.visualCorrectionY,dt\)/);
 assert.match(game,/state\.socket\.emit\('echo:move',\{x:state\.x,y:state\.y/);
 assert.ok(page.includes('game.js?v=echo-camera-jitter-1'));
});

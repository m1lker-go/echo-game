'use strict';
// Server-side movement budgets: only the server's own energy changes mobility.
// Jump/boost signals are validated; client-supplied energy/velocity cannot bypass them.
const {energySpeedMultiplier,energyJumpDistance}=require('./energy-balance');
const NORMAL_SPEED=155, BOOST_SPEED=300, MAX_WORLD_PROJECTION=Math.SQRT2;
const BOOST_DURATION_MS=700, BOOST_COOLDOWN_MS=3000, JUMP_DURATION_MS=200;
const JUMP_LANDING_GRACE_MS=180, JUMP_EPSILON=32; // Up to one unsent movement tick at jump start.
const MAX_CREDIT_SECONDS=0.125;
function createMobilityState(now=Date.now()){
 return {lastAt:now,credit:0,boostUntil:0,boostCooldownUntil:0,
  jumpUntil:0,jumpGraceUntil:0,jumpReadyAt:0,
  jumpX:0,jumpY:0,jumpDx:0,jumpDy:1,jumpLength:0};
}
function beginAbility(m,player,payload,now=Date.now()){
 if(!m||!player||!payload||typeof payload!=='object')return false;
 if(payload.type==='boost'){
  if(now<m.boostCooldownUntil)return false;
  m.boostUntil=now+BOOST_DURATION_MS;
  m.boostCooldownUntil=now+BOOST_COOLDOWN_MS;
  return true;
 }
 if(payload.type==='jump'){
  if(now<m.jumpReadyAt)return false;
  const dx=Number(payload.dx),dy=Number(payload.dy),length=Math.hypot(dx,dy);
  if(!Number.isFinite(length)||Math.abs(length-1)>0.015)return false;
  m.jumpX=player.x;m.jumpY=player.y;
  m.jumpDx=dx/length;m.jumpDy=dy/length;
  m.jumpLength=energyJumpDistance(player.energy);
  m.jumpUntil=now+JUMP_DURATION_MS;
  m.jumpGraceUntil=m.jumpUntil+JUMP_LANDING_GRACE_MS;
  m.jumpReadyAt=m.jumpUntil;
  return true;
 }
 return false;
}
function moveBudget(m,player,desired,now=Date.now()){
 const elapsed=Math.max(0,Math.min(250,now-m.lastAt));
 m.lastAt=now;
 const jumping=now<=m.jumpGraceUntil;
 const multiplier=energySpeedMultiplier(player.energy);
 const maxSpeed=(now<m.boostUntil?BOOST_SPEED:NORMAL_SPEED)*multiplier*MAX_WORLD_PROJECTION;
 const creditLimit=maxSpeed*MAX_CREDIT_SECONDS;
 m.credit=Math.min(creditLimit,m.credit+maxSpeed*elapsed/1000);
 const dx=desired.x-player.x,dy=desired.y-player.y;
 const distance=Math.hypot(dx,dy);
 if(!Number.isFinite(distance))return {allowed:false,maxVelocity:maxSpeed};
 if(jumping){
  // During a jump, follow the direction announced before the movement.
  // Prevent instant arbitrary repositioning sideways or beyond jump range.
  const fromX=desired.x-m.jumpX,fromY=desired.y-m.jumpY;
  const along=fromX*m.jumpDx+fromY*m.jumpDy;
  const across=Math.abs(fromX*m.jumpDy-fromY*m.jumpDx);
  if(along>=-JUMP_EPSILON&&along<=m.jumpLength+JUMP_EPSILON&&across<=JUMP_EPSILON){
   return {allowed:true,maxVelocity:m.jumpLength/(JUMP_DURATION_MS/1000)};
  }
  // After the active jump animation, normal running can resume immediately
  // even while the final delayed jump packet still has a grace period.
  if(now<=m.jumpUntil)return {allowed:false,maxVelocity:maxSpeed};
 }
 if(distance>m.credit+0.001)return {allowed:false,maxVelocity:maxSpeed};
 m.credit=Math.max(0,m.credit-distance);
 return {allowed:true,maxVelocity:maxSpeed};
}
module.exports={createMobilityState,beginAbility,moveBudget};

'use strict';
const SHIELD_DURATION_MS=5000;
function hasSpawnShield(p,now=Date.now()){return Number.isFinite(p?.shieldUntil)&&p.shieldUntil>now;}
function chooseSafeSpawn({halfSize,isSafe,random=Math.random,margin=90,maxAttempts=1600}){
 if(!Number.isFinite(halfSize)||halfSize<=margin||typeof isSafe!=='function')throw new TypeError('Invalid spawn area');
 const limit=halfSize-margin;
 for(let i=0;i<maxAttempts;i++){
  const p={x:(random()*2-1)*limit,y:(random()*2-1)*limit};
  if(isSafe(p))return p;
 }
 // Bounded exhaustive fallback: never default to a hazardous center.
 const steps=Math.max(3,Math.ceil(2*limit/60)),offset=Math.floor(random()*steps*steps);
 for(let i=0;i<steps*steps;i++){
  const cell=(i+offset)%(steps*steps);
  const p={x:-limit+(cell%steps+.5)*2*limit/steps,y:-limit+(Math.floor(cell/steps)+.5)*2*limit/steps};
  if(isSafe(p))return p;
 }
 throw new Error('No safe spawn available');
}
module.exports={SHIELD_DURATION_MS,hasSpawnShield,chooseSafeSpawn};

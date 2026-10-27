// ECHO energy mobility: same curve on both clients and the authoritative server.
const CURVE=Object.freeze([[0,0],[100,0.05],[300,0.10],[500,0.20]]);
function energyPenalty(energy){
 const value=Math.max(0,Math.min(500,Number(energy)||0));
 for(let index=1;index<CURVE.length;index++){
  const [end,penalty]=CURVE[index], [start,previous]=CURVE[index-1];
  if(value<=end)return previous+(penalty-previous)*(value-start)/(end-start);
 }
 return 0.20;
}
function energySpeedMultiplier(energy){return 1-energyPenalty(energy);}
function energySizeMultiplier(energy){return 1+energyPenalty(energy);}
function energyJumpDistance(energy,baseDistance=420){return baseDistance*energySpeedMultiplier(energy);}

export {energyPenalty,energySpeedMultiplier,energySizeMultiplier,energyJumpDistance};

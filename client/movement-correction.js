// Visual-only smoothing for modest corrections to the authoritative player position.
// Collision, movement and outgoing packets always use the server-corrected coordinates.
const MAX_VISUAL_CORRECTION=110;
const CORRECTION_DECAY_PER_SECOND=18;

export function visualCorrectionOffset(visualX,visualY,serverX,serverY){
 const x=visualX-serverX,y=visualY-serverY;
 if(!Number.isFinite(x)||!Number.isFinite(y)||Math.hypot(x,y)>MAX_VISUAL_CORRECTION)return {x:0,y:0};
 return {x,y};
}

export function settleVisualCorrection(x,y,dt){
 const seconds=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,0.05));
 const decay=Math.exp(-CORRECTION_DECAY_PER_SECOND*seconds);
 const nextX=x*decay,nextY=y*decay;
 return {x:Math.abs(nextX)<0.05?0:nextX,y:Math.abs(nextY)<0.05?0:nextY};
}

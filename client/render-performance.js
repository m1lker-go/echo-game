// Mobile rendering budget: graphics only; server movement and PvP stay unchanged.
export function isMobilePerformanceDevice(ua='',coarse=false){
 return /Android|iPhone|iPad|iPod/i.test(ua)||Boolean(coarse);
}
export function renderPixelRatio(dpr=1,mobile=false){
 const n=Number(dpr);
 return Math.min(Number.isFinite(n)&&n>0?n:1,mobile?1.5:2);
}
export function targetFrameInterval(mobile=false){return 1000/(mobile?30:60);}
export function shouldDrawScene(inBattle,hidden){return Boolean(inBattle&&!hidden);}

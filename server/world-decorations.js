'use strict';

// Fixed, server-seeded decorations shared by all ECHO clients.
// These are visual only: NEVER add them to movement, food, damage or spawn collision checks.
const SPECS = Object.freeze([
  {model:'rocks.glb',count:75,baseRadius:64,minScale:0.3,maxScale:0.6},
  {model:'plant.glb',count:200,baseRadius:38,minScale:0.7,maxScale:1.2},
  // Logs remain x50 at base scale, with randomized size coefficients.
  {model:'tree-trunk.glb',count:50,baseRadius:15,minScale:3,maxScale:4}
]);
const EXPECTED_TOTAL = SPECS.reduce((n,spec)=>n+spec.count,0);

function seededRandom(seed) {
  let value=seed>>>0;
  return ()=>{
    value=(value+0x6D2B79F5)>>>0;
    let n=value;
    n=Math.imul(n^(n>>>15),n|1);
    n^=n+Math.imul(n^(n>>>7),n|61);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
}

function pointInPolygon(x,y,vertices) {
  let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
    const [xi,yi]=vertices[i],[xj,yj]=vertices[j];
    if((yi>y)!==(yj>y) && x<((xj-xi)*(y-yi))/((yj-yi)||Number.EPSILON)+xi)inside=!inside;
    const cross=(x-xi)*(yj-yi)-(y-yi)*(xj-xi);
    if(Math.abs(cross)<1e-7 && x>=Math.min(xi,xj)-1e-7 &&
       x<=Math.max(xi,xj)+1e-7 && y>=Math.min(yi,yj)-1e-7 &&
       y<=Math.max(yi,yj)+1e-7)return true;
  }
  return inside;
}

function distanceToSegment(x,y,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/len)):0;
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}

function overlapsWater(x,y,radius,contours) {
  for(const polygon of contours){
    if(!Array.isArray(polygon)||polygon.length<3)continue;
    if(pointInPolygon(x,y,polygon))return true;
    for(let k=0;k<polygon.length;k++){
      if(distanceToSegment(x,y,polygon[k],polygon[(k+1)%polygon.length])<radius)return true;
    }
  }
  return false;
}

function createWorldDecorations({seed,worldHalfSize,trees,waterContours}) {
  const rnd=seededRandom(seed+572189);
  const between=(a,b)=>a+rnd()*(b-a);
  const entries=[];
  // Coarse bins keep all 325 static decorations cheap to validate at server startup.
  const cellSize=180,bins=new Map();
  const cell=(x,y)=>[Math.floor(x/cellSize),Math.floor(y/cellSize)];
  const key=(a,b)=>a+':'+b;
  function nearby(x,y) {
    const [cx,cy]=cell(x,y),result=[];
    for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
      const list=bins.get(key(cx+dx,cy+dy));
      if(list)result.push(...list);
    }
    return result;
  }
  function canPlace(candidate) {
    const {x,y,radius}=candidate;
    if(Math.abs(x)>worldHalfSize-radius-38||Math.abs(y)>worldHalfSize-radius-38)return false;
    if(Math.hypot(x,y)<210+radius)return false;
    if(trees.some(tree=>Math.hypot(x-tree.x,y-tree.y) <
      radius+(Number(tree.collisionRadius)||0)+12))return false;
    if(overlapsWater(x,y,radius+12,waterContours))return false;
    return !nearby(x,y).some(other=>Math.hypot(x-other.x,y-other.y) <
      radius+other.radius+6);
  }
  for(const spec of SPECS){
    let count=0,attempts=0;
    const maxAttempts=Math.max(20000,spec.count*1200);
    while(count<spec.count && attempts++<maxAttempts) {
      const scale=between(spec.minScale,spec.maxScale);
      const radius=spec.baseRadius*scale;
      const x=between(-worldHalfSize+100,worldHalfSize-100);
      const y=between(-worldHalfSize+100,worldHalfSize-100);
      const candidate={x,y,radius};
      if(!canPlace(candidate))continue;
      const instance={
        id:'decor_'+spec.model.replace('.glb','')+'_'+String(count+1).padStart(3,'0'),
        model:spec.model,x,y,scale,rotation:between(0,Math.PI*2)
      };
      entries.push(instance);
      const [cx,cy]=cell(x,y),index=key(cx,cy);
      if(!bins.has(index))bins.set(index,[]);
      bins.get(index).push(candidate);
      count++;
    }
    if(count!==spec.count)throw new Error('Could not place all '+spec.model+' decorations: '+count+'/'+spec.count);
  }
  return entries;
}

module.exports={createWorldDecorations,SPECS,EXPECTED_TOTAL,overlapsWater};

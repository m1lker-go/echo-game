'use strict';

// Fixed, server-seeded decorations shared by all ECHO clients.
// These are visual only: NEVER add them to movement, food, damage or spawn collision checks.
const SPECS = Object.freeze([
  {model:'rocks.glb',count:75,baseRadius:64,minScale:0.3,maxScale:0.6},
  {model:'plant.glb',count:200,baseRadius:38,minScale:0.7,maxScale:1.2}
]);
const EXPECTED_TOTAL = SPECS.reduce((n,spec)=>n+spec.count,0);
const PLANT_CLUSTER_SIZES=Object.freeze([1,2,3,5]);
const PLANT_CLUSTER_MAX_OFFSET=32; // Keep existing groups of 1, 2 and 3 compact.
const PLANT_CLUSTER_MEMBER_GAP=10; // Avoid exact overlaps within small patches.
// Five-plant groups need more space to keep all five silhouettes readable.
const PLANT_CLUSTER_FIVE_MIN_OFFSET=34;
const PLANT_CLUSTER_FIVE_MAX_OFFSET=55;
const PLANT_CLUSTER_FIVE_MEMBER_GAP=24;

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
  // Bins keep plant patches and rocks apart while allowing their own members to overlap.
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
    // The spatial bins contain rocks and *completed* plant patches, not
    // members of the current patch. This is what lets grass grow close.
    return !nearby(x,y).some(other=>Math.hypot(x-other.x,y-other.y) <
      radius+other.radius+6);
  }
  function register(spec,candidate,count,clusterId){
    const {x,y,scale}=candidate;
    const instance={
      id:'decor_'+spec.model.replace('.glb','')+'_'+String(count).padStart(3,'0'),
      model:spec.model,x,y,scale,rotation:between(0,Math.PI*2)
    };
    if(clusterId)instance.clusterId=clusterId;
    entries.push(instance);
    const [cx,cy]=cell(x,y),index=key(cx,cy);
    if(!bins.has(index))bins.set(index,[]);
    bins.get(index).push(candidate);
  }
  for(const spec of SPECS){
    let count=0,attempts=0;
    const maxAttempts=Math.max(20000,spec.count*1200);
    if(spec.model==='plant.glb'){
      let groupNumber=0;
      while(count<spec.count && attempts++<maxAttempts){
        const availableSizes=PLANT_CLUSTER_SIZES.filter(n=>n<=spec.count-count);
        const groupSize=availableSizes[Math.floor(rnd()*availableSizes.length)];
        const centerX=between(-worldHalfSize+135,worldHalfSize-135);
        const centerY=between(-worldHalfSize+135,worldHalfSize-135);
        const fiveSpreadAngle=groupSize===5?between(0,Math.PI*2):0;
        const staged=[];
        for(let i=0;i<groupSize;i++){
          let member=null;
          for(let trial=0;trial<55;trial++){
            const distance=i===0?0:groupSize===5
              ? between(PLANT_CLUSTER_FIVE_MIN_OFFSET,PLANT_CLUSTER_FIVE_MAX_OFFSET)
              : between(11,PLANT_CLUSTER_MAX_OFFSET);
            // Five plants form an irregular ring around the central one,
            // instead of randomly stacking on the same side of the patch.
            const angle=groupSize===5&&i>0
              ? fiveSpreadAngle+(i-1)*Math.PI/2+between(-0.33,0.33)
              : between(0,Math.PI*2);
            const x=centerX+Math.cos(angle)*distance;
            const y=centerY+Math.sin(angle)*distance;
            const scale=between(spec.minScale,spec.maxScale);
            const candidate={x,y,scale,radius:spec.baseRadius*scale};
            if(!canPlace(candidate))continue;
            const minGap=groupSize===5?PLANT_CLUSTER_FIVE_MEMBER_GAP:PLANT_CLUSTER_MEMBER_GAP;
            if(staged.some(other=>Math.hypot(other.x-x,other.y-y)<minGap))continue;
            member=candidate;
            break;
          }
          if(!member)break;
          staged.push(member);
        }
        if(staged.length!==groupSize)continue; // Commit the group as a unit.
        const clusterId='plant_group_'+String(++groupNumber).padStart(3,'0');
        for(const member of staged)register(spec,member,++count,clusterId);
      }
    }else{
      while(count<spec.count && attempts++<maxAttempts){
        const scale=between(spec.minScale,spec.maxScale);
        const candidate={
          x:between(-worldHalfSize+100,worldHalfSize-100),
          y:between(-worldHalfSize+100,worldHalfSize-100),
          scale,radius:spec.baseRadius*scale
        };
        if(canPlace(candidate))register(spec,candidate,++count);
      }
    }
    if(count!==spec.count)throw new Error('Could not place all '+spec.model+' decorations: '+count+'/'+spec.count);
  }
  return entries;
}

module.exports={createWorldDecorations,SPECS,EXPECTED_TOTAL,overlapsWater,PLANT_CLUSTER_SIZES,PLANT_CLUSTER_MAX_OFFSET,PLANT_CLUSTER_MEMBER_GAP,PLANT_CLUSTER_FIVE_MIN_OFFSET,PLANT_CLUSTER_FIVE_MAX_OFFSET,PLANT_CLUSTER_FIVE_MEMBER_GAP};

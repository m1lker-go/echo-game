'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createWorldDecorations,SPECS,EXPECTED_TOTAL,overlapsWater}=require('../world-decorations');
const byModel=new Map(SPECS.map(spec=>[spec.model,spec]));

function sampleWorld(){
  const waterContours=[
    [[-900,-750],[-230,-750],[-230,100],[-900,100]],
    [[520,400],[900,400],[900,750],[520,750]],
    [[-250,1100],[200,1100],[200,1450],[-250,1450]]
  ];
  const trees=[];
  for(let i=0;i<56;i++){
    trees.push({
      x:-1800+(i%8)*500,
      y:-1680+Math.floor(i/8)*520,
      collisionRadius:26+(i%3)*10
    });
  }
  return {seed:847291,worldHalfSize:2100,trees,waterContours};
}

test('375 static decorations: 75 rocks, 200 plants, 100 mushrooms; no logs or random flowers',()=>{
 assert.deepEqual(Object.fromEntries(SPECS.map(s=>[s.model,s.count])),{
  'rocks.glb':75,'plant.glb':200,'mushrooms.glb':100
 });
 assert.equal(EXPECTED_TOTAL,375);
 assert.deepEqual(Object.fromEntries(SPECS.map(s=>[s.model,[s.minScale,s.maxScale]])),{
  'rocks.glb':[0.3,0.6], 'plant.glb':[0.7,1.2], 'mushrooms.glb':[0.7,1]
 });
});

test('All decorations are deterministic and outside tree collision circles and water contours',()=>{
 const source=sampleWorld();
 const objects=createWorldDecorations(source);
 assert.equal(objects.length,EXPECTED_TOTAL);
 assert.equal(objects.some(item=>item.model==='stones.glb'||item.model==='flowers-tall.glb'||item.model==='tree-trunk.glb'),false);
 assert.deepEqual(createWorldDecorations(source),objects,'The same map must be shared by all players');
 assert.equal(new Set(objects.map(x=>x.id)).size,EXPECTED_TOTAL);
 for(const obj of objects){
  const spec=byModel.get(obj.model);
  assert.ok(spec,'Only approved model names are used');
  assert.ok(obj.scale>=spec.minScale && obj.scale<=spec.maxScale);
  const radius=spec.baseRadius*obj.scale;
  assert.ok(Math.abs(obj.x)<=source.worldHalfSize-radius-38);
  assert.ok(Math.abs(obj.y)<=source.worldHalfSize-radius-38);
  assert.ok(!overlapsWater(obj.x,obj.y,radius+12,source.waterContours),
    obj.id+' must remain completely outside water');
  for(const tree of source.trees)
   assert.ok(Math.hypot(obj.x-tree.x,obj.y-tree.y)>=radius+tree.collisionRadius+12,
     obj.id+' must not enter a tree collision circle');
  assert.equal('collisionRadius' in obj,false,'New scenery must be visual only');
 }
});

test('All 200 plants grow in separate clusters of 1, 2, 3 or 5',()=>{
 const {PLANT_CLUSTER_SIZES,PLANT_CLUSTER_MAX_OFFSET,PLANT_CLUSTER_MEMBER_GAP,
  PLANT_CLUSTER_FIVE_CORE_MIN_OFFSET,PLANT_CLUSTER_FIVE_CORE_MAX_OFFSET,
  PLANT_CLUSTER_FIVE_OUTER_MIN_OFFSET,PLANT_CLUSTER_FIVE_OUTER_MAX_OFFSET,PLANT_CLUSTER_FIVE_OUTER_GAP
 }=require('../world-decorations');
 const placed=createWorldDecorations(sampleWorld()),groups=new Map();
 const rocks=placed.filter(p=>p.model==='rocks.glb');
 assert.equal(rocks.length,75);
 for(const plant of placed.filter(p=>p.model==='plant.glb')){
  assert.ok(plant.clusterId?.startsWith('plant_group_'),'Every plant belongs to a patch');
  if(!groups.has(plant.clusterId))groups.set(plant.clusterId,[]);
  groups.get(plant.clusterId).push(plant);
 }
 assert.equal([...groups.values()].reduce((n,g)=>n+g.length,0),200);
 const sizes=new Set(),groupArray=[...groups.values()];
 for(const group of groupArray){
  assert.ok(PLANT_CLUSTER_SIZES.includes(group.length),'Unsupported patch size');
  sizes.add(group.length);
  const first=group[0];
  if(group.length===5){
   const distances=group.slice(1).map(member=>Math.hypot(first.x-member.x,first.y-member.y));
   const near=distances.filter(d=>d<=PLANT_CLUSTER_FIVE_CORE_MAX_OFFSET+0.001);
   const far=distances.filter(d=>d>=PLANT_CLUSTER_FIVE_OUTER_MIN_OFFSET-0.001);
   assert.ok(near.length===1||near.length===2,'Five plants must contain a tight pair or trio');
   assert.equal(near.length+far.length,4,'No evenly spaced radial ring');
   assert.ok(near.every(d=>d>=PLANT_CLUSTER_FIVE_CORE_MIN_OFFSET-0.001));
   assert.ok(far.every(d=>d<=PLANT_CLUSTER_FIVE_OUTER_MAX_OFFSET+0.001));
   for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
    const loose=(i>=near.length+1||j>=near.length+1);
    assert.ok(Math.hypot(group[i].x-group[j].x,group[i].y-group[j].y)>=
      (loose?PLANT_CLUSTER_FIVE_OUTER_GAP:PLANT_CLUSTER_MEMBER_GAP)-0.001);
   }
  }else{
   for(const member of group.slice(1))
    assert.ok(Math.hypot(first.x-member.x,first.y-member.y)<=PLANT_CLUSTER_MAX_OFFSET+0.001,
      'Small patch spacing should not change');
   for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++)
    assert.ok(Math.hypot(group[i].x-group[j].x,group[i].y-group[j].y)>=PLANT_CLUSTER_MEMBER_GAP-0.001);
  }
 }
 assert.deepEqual([...sizes].sort((a,b)=>a-b),[1,2,3,5]);
 // Separate grass patches don't merge together; rocks remain isolated.
 for(let i=0;i<groupArray.length;i++){
  for(let j=i+1;j<groupArray.length;j++)for(const a of groupArray[i])for(const b of groupArray[j])
   assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=38*(a.scale+b.scale)+6-0.001);
  for(const a of groupArray[i])for(const b of rocks)
   assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=38*a.scale+64*b.scale+6-0.001);
 }
});


test('Mushrooms grow in close clusters of 1–4, with many near but never inside water',()=>{
 const {MUSHROOM_CLUSTER_SIZES,MUSHROOM_CLUSTER_MAX_OFFSET,MUSHROOM_CLUSTER_MEMBER_GAP,
        MUSHROOM_WATER_GROUP_CHANCE,nearestWaterDistance}=require('../world-decorations');
 const world=sampleWorld(),placed=createWorldDecorations(world);
 const groups=new Map(),mushrooms=placed.filter(p=>p.model==='mushrooms.glb');
 assert.equal(mushrooms.length,100);
 assert.equal(MUSHROOM_WATER_GROUP_CHANCE,0.45);
 for(const obj of mushrooms){
  assert.match(obj.clusterId,/^mushroom_group_\d{3}$/);
  if(!groups.has(obj.clusterId))groups.set(obj.clusterId,[]);
  groups.get(obj.clusterId).push(obj);
 }
 const sizes=new Set(),near=[];
 for(const group of groups.values()){
  assert.ok(MUSHROOM_CLUSTER_SIZES.includes(group.length));
  sizes.add(group.length);
  const origin=group[0];
  near.push(nearestWaterDistance(origin.x,origin.y,world.waterContours)<215);
  for(const member of group.slice(1)){
   const d=Math.hypot(origin.x-member.x,origin.y-member.y);
   assert.ok(d<=MUSHROOM_CLUSTER_MAX_OFFSET+0.001);
   assert.ok(d>=MUSHROOM_CLUSTER_MEMBER_GAP-0.001);
  }
  for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++)
   assert.ok(Math.hypot(group[i].x-group[j].x,group[i].y-group[j].y)>=MUSHROOM_CLUSTER_MEMBER_GAP-0.001);
 }
 assert.deepEqual([...sizes].sort((a,b)=>a-b),[1,2,3,4]);
 assert.ok(near.filter(Boolean).length>=Math.floor(near.length*0.2),
    'A meaningful fraction of mushroom patches should grow by the shore');
 assert.ok(near.some(x=>!x),'Not all mushrooms should be by the shore');
 // Clusters respect the same exclusion radii as existing rocks and plants.
 const others=placed.filter(p=>p.model!=='mushrooms.glb');
 for(const m of mushrooms)for(const o of others){
  const s=byModel.get(o.model);
  assert.ok(Math.hypot(m.x-o.x,m.y-o.y)>=26*m.scale+s.baseRadius*o.scale+6-0.001);
 }
});

test('Mushrooms GLB includes three cap height regions and stays lightweight at x50',()=>{
 const glb=fs.readFileSync(path.join(__dirname,'../../client/assets/models/objects/mushrooms.glb'));
 assert.equal(glb.toString('ascii',0,4),'glTF');
 const jsonLength=glb.readUInt32LE(12);
 const data=JSON.parse(glb.subarray(20,20+jsonLength).toString('utf8'));
 const pos=data.accessors[data.meshes[0].primitives[0].attributes.POSITION];
 assert.equal(pos.count,240);
 assert.ok(pos.max[1]>0.28);
 assert.ok(pos.min[1]<=0.001);
 const footprint=Math.hypot(
  Math.max(Math.abs(pos.min[0]),Math.abs(pos.max[0])),
  Math.max(Math.abs(pos.min[2]),Math.abs(pos.max[2])))*50;
 assert.ok(26>=footprint+5,'Keep shore and tree clearances around the whole model');
});

test('New decorations reach WebGL; stones stay removed and gameplay physics unchanged',()=>{
 const root=path.join(__dirname,'../..');
 const server=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
 const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
 const decorations=fs.readFileSync(path.join(root,'client/world-decorations.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'client/style.css'),'utf8');
 assert.match(server,/decorations:\s*WORLD_DECORATIONS/);
 assert.match(server,/waterContours:\s*WORLD_WATERS\.map\(water=>getWaterWorldContour\(water\)\)/);
 assert.match(game,/decorations\.setSnapshot\(world\.decorations\)/);
 assert.match(game,/decorations\.update\(state\.cameraX,state\.cameraY\)/);
 assert.match(game,/updatePlayerMovement\(state,dt,time,ISO,worldObjects\.trees\)/);
 assert.match(game,/function isJumpLandingBlocked\(x,y\)\{[^}]*worldObjects\.trees/);
 assert.ok(html.includes('game.js?v=echo-camera-jitter-1'));
 assert.ok(game.includes('world-decorations.js?v=echo-glowing-mushrooms-10'));
 assert.match(decorations,/new THREE\.InstancedMesh/);
 assert.match(decorations,/const BASE_SCALE=50/);
 assert.match(decorations,/material\.onBeforeCompile=shader/);
 assert.match(decorations,/frustumCulled=true/);
 assert.match(decorations,/const BACKGROUND_DEPTH=-75/);
 assert.match(decorations,/const BACKGROUND_ORDER=-5/);
 assert.match(decorations,/mesh\.renderOrder=BACKGROUND_ORDER/);
 assert.match(decorations,/material\.depthTest=true/);
 assert.match(decorations,/material\.depthWrite=false/);
 assert.match(decorations,/material\.opacity=colors\.opacity/);
 assert.match(decorations,/object\.rotation\.set\(ISOMETRIC_TILT,ISOMETRIC_YAW\+value\.rotation,0,'XYZ'\)/);
 assert.ok(!decorations.includes('collisionRadius'));
 assert.ok(!decorations.includes('stones.glb'),'Client must not request stones');
 assert.ok(!server.includes('stones.glb'),'Server must not generate stones');
 assert.ok(!server.includes('tree-trunk.glb'),'Server must not generate logs');
 assert.ok(decorations.includes("'mushrooms.glb':{min:0.7,max:1}"));
 assert.ok(decorations.includes("'mushrooms.glb':{low:0x18384a,mid:0x5d8ba5,high:0xccecff,opacity:0.5}"));
 assert.ok(decorations.includes("if(model==='mushrooms.glb')"));
 assert.ok(decorations.includes('vEchoMushroomCap=smoothstep(echoCapBase,echoCapBase+0.043,position.y)'));
 assert.ok(decorations.includes('outgoingLight += vec3(0.13,0.38,0.62)*echoBlueCap'));
 assert.ok(decorations.includes("'flowers-tall.glb':{min:0.6,max:0.8}"));
 assert.ok(!decorations.includes('tree-trunk.glb'),'Client must not load logs');
 assert.match(decorations,/deathFlowers=snapshot\.slice\(0,250\)/);
 assert.match(game,/state\.socket\.on\('echo:deathFlowers'/);
 assert.match(game,/decorations\.setDeathFlowers\(data\.flowers\)/);
 assert.match(server,/pvpFlowers\.add\(\{/);
 assert.match(server,/const memorialRooms=pvpFlowers\.reset\(\)/);
 assert.ok(decorations.includes("if(model==='flowers-tall.glb')"));
 assert.ok(decorations.includes('echoPetalGlow=smoothstep(0.62,0.92,vEchoDecorY)'));
 assert.ok(decorations.includes('outgoingLight += vec3(0.11,0.26,0.37)*echoPetalGlow'));
 assert.ok(!decorations.includes('new THREE.PointLight'),'No expensive light per flower');
 for(const spec of SPECS){
  assert.ok(decorations.includes("'"+spec.model+"':{min:"+spec.minScale+",max:"+spec.maxScale+"}"));
  const palette=decorations.split("'"+spec.model+"':{low:")[1]?.split('}')[0];
  assert.ok(palette?.includes('opacity:0.5'),spec.model+' keeps 50% opacity');
 }
 assert.ok(decorations.includes('item.scale>=SCALE_RANGES[item.model].min'));
 assert.ok(decorations.includes('item.scale<=SCALE_RANGES[item.model].max'));
 assert.match(css,/#world\s*\{\s*z-index:\s*1/);
 assert.match(css,/#models\s*\{[^}]*z-index:\s*3/);
});

test('Each clearance radius conservatively encloses the actual GLB mesh at x50 scale',()=>{
 const assetDir=path.join(__dirname,'../../client/assets/models/objects');
 for(const spec of SPECS){
  const glb=fs.readFileSync(path.join(assetDir,spec.model));
  assert.equal(glb.toString('ascii',0,4),'glTF');
  const length=glb.readUInt32LE(12);
  assert.equal(glb.toString('ascii',16,20),'JSON');
  const data=JSON.parse(glb.subarray(20,20+length).toString('utf8'));
  let extent=0,vertices=0;
  for(const mesh of data.meshes||[])for(const primitive of mesh.primitives||[]){
   const bounds=data.accessors[primitive.attributes.POSITION];
   vertices+=bounds.count;
   const x=Math.max(Math.abs(bounds.min[0]),Math.abs(bounds.max[0]));
   const z=Math.max(Math.abs(bounds.min[2]),Math.abs(bounds.max[2]));
   extent=Math.max(extent,Math.hypot(x,z)*50);
  }
  assert.ok(vertices>0 && vertices<1200,'GLB must remain lightweight: '+spec.model);
  assert.ok(spec.baseRadius>=extent+5,'Keep a safe margin around every '+spec.model+' asset');
 }
});

test('The flat GLB ground axes project at ECHO isometric slopes rather than side-on',()=>{
 // The 2.5D world axes in ECHO project to (±sqrt(3)/2,-1/2).
 // The GLB local XZ ground plane has to project to the same directions.
 const tilt=Math.asin(1/Math.sqrt(3)),yaw=-Math.PI/4;
 const sin=Math.sin(tilt),cos=Math.cos(yaw);
 const xAxis={x:cos,y:-sin*(-Math.sin(yaw))};
 const zAxis={x:Math.sin(yaw),y:-sin*Math.cos(yaw)};
 const slope=1/Math.sqrt(3);
 assert.ok(Math.abs(Math.abs(xAxis.y/xAxis.x)-slope)<1e-12);
 assert.ok(Math.abs(Math.abs(zAxis.y/zAxis.x)-slope)<1e-12);
 assert.ok(Math.sign(xAxis.x)!==Math.sign(zAxis.x));
 // The 'top' of both ground axes moves toward the background on screen.
 assert.ok(xAxis.y<0 && zAxis.y<0);
});


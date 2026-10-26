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

test('Only 325 static props are preplaced; PvP flowers are generated on death',()=>{
 assert.deepEqual(Object.fromEntries(SPECS.map(s=>[s.model,s.count])),{
  'rocks.glb':75,'plant.glb':200,
  'tree-trunk.glb':50
 });
 assert.equal(EXPECTED_TOTAL,325);
 assert.deepEqual(Object.fromEntries(SPECS.map(s=>[s.model,[s.minScale,s.maxScale]])),{
  'rocks.glb':[0.3,0.6], 'plant.glb':[0.7,1.2],
  'tree-trunk.glb':[3,4]
 });
});

test('All decorations are deterministic and outside tree collision circles and water contours',()=>{
 const source=sampleWorld();
 const objects=createWorldDecorations(source);
 assert.equal(objects.length,EXPECTED_TOTAL);
 assert.equal(objects.some(item=>item.model==='stones.glb'||item.model==='flowers-tall.glb'),false);
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
 assert.ok(html.includes('game.js?v=echo-shield-pulse-1-pvp-memorial-8'));
 assert.ok(game.includes('world-decorations.js?v=echo-pvp-memorial-8'));
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
 assert.ok(decorations.includes("'flowers-tall.glb':{min:0.6,max:0.8}"));
 assert.ok(decorations.includes("'tree-trunk.glb':{min:3,max:4}"));
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


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

test('Decorative GLBs use precisely 200 plants, 75 rocks and 150 stones',()=>{
 assert.deepEqual(Object.fromEntries(SPECS.map(s=>[s.model,s.count])),{
  'rocks.glb':75,'stones.glb':150,'plant.glb':200
 });
 assert.equal(EXPECTED_TOTAL,425);
 assert.deepEqual(Object.fromEntries(SPECS.map(x=>[x.model,[x.minScale,x.maxScale]])),{
  'rocks.glb':[0.2,0.4],
  'stones.glb':[2,4],
  'plant.glb':[0.7,1.2]
 });
});

test('All decorations are deterministic and outside tree collision circles and water contours',()=>{
 const source=sampleWorld();
 const objects=createWorldDecorations(source);
 assert.equal(objects.length,EXPECTED_TOTAL);
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

test('The arena uses the same server snapshot on reconnect without changing movement physics',()=>{
 const root=path.join(__dirname,'../..');
 const server=fs.readFileSync(path.join(root,'server/index.js'),'utf8');
 const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
 const decorations=fs.readFileSync(path.join(root,'client/world-decorations.js'),'utf8');
 assert.match(server,/decorations:\s*WORLD_DECORATIONS/);
 assert.match(server,/waterContours:\s*WORLD_WATERS\.map\(water=>getWaterWorldContour\(water\)\)/);
 assert.match(game,/decorations\.setSnapshot\(world\.decorations\)/);
 assert.match(game,/decorations\.update\(state\.cameraX,state\.cameraY\)/);
 assert.match(game,/updatePlayerMovement\(state,dt,time,ISO,worldObjects\.trees\)/);
 assert.match(game,/function isJumpLandingBlocked\(x,y\)\{[^}]*worldObjects\.trees/);
 assert.match(html,/game\.js\?v=echo-shield-pulse-1-decorations-iso-depth-scale-stones-height-4/);
 assert.match(decorations,/new THREE\.InstancedMesh/);
 assert.match(decorations,/const BASE_SCALE=50/);
 // Height is adjusted locally in Three.js; never enlarge the X/Z collision footprint.
 assert.ok(decorations.includes("const MODEL_HEIGHT_MULTIPLIERS=Object.freeze({'stones.glb':4})"));
 assert.match(decorations,/object\.scale\.setScalar\(BASE_SCALE\*value\.scale\)/);
 assert.match(decorations,/object\.scale\.y\*=MODEL_HEIGHT_MULTIPLIERS\[model\]\|\|1/);
 assert.match(decorations,/material\.onBeforeCompile=shader/);
 assert.match(decorations,/frustumCulled=true/);
 assert.match(game,/world-decorations\.js\?v=echo-iso-depth-scale-stones-height-4/);
 // The player is at z=0 in ECHO's orthographic scene. Scenery is behind
 // the character and must pass the WebGL depth test.
 assert.match(decorations,/const BACKGROUND_DEPTH=-75/);
 assert.match(decorations,/const BACKGROUND_ORDER=-5/);
 assert.match(decorations,/mesh\.renderOrder=BACKGROUND_ORDER/);
 assert.match(decorations,/material\.depthTest=true/);
 assert.match(decorations,/material\.depthWrite=false/);
 assert.match(decorations,/object\.position\.set\([^;]*BACKGROUND_DEPTH\)/);
 assert.match(decorations,/object\.rotation\.set\(ISOMETRIC_TILT,ISOMETRIC_YAW\+value\.rotation,0,'XYZ'\)/);
 assert.ok(!decorations.includes('collisionRadius'));
 // The scale ranges are mirrored on the client: stones above 1.3 must render.
 for(const spec of SPECS){
   assert.ok(decorations.includes("'"+spec.model+"':{min:"+spec.minScale+",max:"+spec.maxScale+"}"));
   assert.ok(decorations.includes("'"+spec.model+"':{") || spec.model==='stones.glb');
 }
 assert.ok(decorations.includes('item.scale>=SCALE_RANGES[item.model].min'));
 assert.ok(decorations.includes('item.scale<=SCALE_RANGES[item.model].max'));
 for(const model of ['plant.glb','rocks.glb','stones.glb']){
   const palette=decorations.split("'"+model+"':{low:")[1]?.split('}')[0];
   assert.ok(palette?.includes('opacity:0.5'),model+' must use 50% opacity');
 }
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
  assert.ok(vertices>0 && vertices<500,'GLB must remain lightweight: '+spec.model);
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

test('stones.glb is a valid but exceptionally flat 3D mesh that needs a vertical-only adjustment',()=>{
 const root=path.join(__dirname,'../..');
 const glb=fs.readFileSync(path.join(root,'client/assets/models/objects/stones.glb'));
 const jsonLength=glb.readUInt32LE(12);
 const json=JSON.parse(glb.subarray(20,20+jsonLength).toString('utf8'));
 const pos=json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
 const width=pos.max[0]-pos.min[0],depth=pos.max[2]-pos.min[2];
 const height=pos.max[1]-pos.min[1];
 assert.ok(width>0.7 && depth>0.7 && height>0,'The stones asset has real visible geometry');
 assert.ok(height<0.06,'Regression guard: stones model is unusually flat');
 // With scale 2..4 and base scale 50, height boost of 4 lifts stones
 // into the visibly raised terrain while leaving X/Z footprint untouched.
 assert.ok(height*50*2*4>19);
 assert.ok(height*50*4*4<45);
});

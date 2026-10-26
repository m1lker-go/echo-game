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
 assert.match(html,/game\.js\?v=echo-shield-pulse-1-decorations-1/);
 assert.match(decorations,/new THREE\.InstancedMesh/);
 assert.match(decorations,/const BASE_SCALE=50/);
 assert.match(decorations,/material\.onBeforeCompile=shader/);
 assert.match(decorations,/frustumCulled=true/);
 assert.ok(!decorations.includes('collisionRadius'));
});

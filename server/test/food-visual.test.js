'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('White food dots are default while WebP preview preserves authoritative pickup',()=>{
 const root=path.join(__dirname,'../..');
 const script=fs.readFileSync(path.join(root,'client/shared-food.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
 const game=fs.readFileSync(path.join(root,'client/game.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'server/food.js'),'utf8');
 assert.match(script,/FOOD_VISUAL_MODE = new URLSearchParams\(window\.location\.search\)\.get\('food'\) === 'icon' \? 'icon' : 'dots'/);
 assert.match(script,/loadAnimatedWebpFrames\('\.\/assets\/icons\/food\.webp\?v=echo-food-animated-2'\)/);
 assert.match(script,/if \(FOOD_VISUAL_MODE === 'icon' && foodAnimation\)/);
 assert.match(script,/ctx\.drawImage\(currentFrame, p\.x - iconSize \/ 2, p\.y - iconSize \/ 2, iconSize, iconSize\)/);
 assert.match(script,/\.catch\(error => \{/);
 assert.match(script,/const halo = ctx\.createRadialGradient/);
 assert.match(script,/ctx\.arc\(p\.x, p\.y, radius, 0, Math\.PI \* 2\)/);
 assert.match(script,/const FOOD_MAGNET_RADIUS = 70/);
 assert.match(script,/export function renderSharedFood\(ctx, time, cameraX, cameraY, playerX, playerY, width, height\)/);
 assert.match(script,/const anchorDx = playerX - point\.x/);
 assert.match(script,/const anchorDy = playerY - point\.y/);
 assert.match(script,/const dx = x - cx, dy = y - cy/);
 assert.doesNotMatch(script,/getBoundingClientRect|#shared-food|ctx\.clearRect/);
 assert.match(script,/worldToScreen\(point\.displayX, point\.displayY, cameraX, cameraY, width, height\)/);
 assert.doesNotMatch(script,/requestAnimationFrame\(draw\)/);
 assert.match(script,/socket\.on\('echo:food', syncFood\)/);
 assert.match(server,/point\.active = false/);
 assert.match(server,/createFoodSnapshot/);
 assert.match(html,/game\.js\?v=echo-food-world-layer-1/);
 assert.doesNotMatch(html,/id="shared-food"/);
 assert.match(game,/renderSharedFood\(ctx,time,state\.cameraX,state\.cameraY,state\.x,state\.y,state\.width,state\.height\)/);
});

test('The preview asset is animated transparent WebP and its dimensions suit a food icon',()=>{
 const filename=path.join(__dirname,'../../client/assets/icons/food.webp');
 const data=fs.readFileSync(filename);
 assert.equal(data.toString('ascii',0,4),'RIFF');
 assert.equal(data.toString('ascii',8,12),'WEBP');
 assert.equal(data.toString('ascii',12,16),'VP8X');
 assert.ok(data[20]&0x10,'Asset must support transparent pixels (no black rectangle)');
 assert.ok(data[20]&0x02,'The user supplied animation should be retained');
 const w=1+data.readUIntLE(24,3),h=1+data.readUIntLE(27,3);
 assert.ok(w>=64 && w<=512);
 assert.ok(h>=64 && h<=512);
});

test('Stationary food stays pixel-locked to the grid across camera movement, but magnet still flies to the player', () => {
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../../client/shared-food.js'),'utf8');
 const js=source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const socket={id:'self',connected:true,on(){},off(){},emit(){}};
 const mockWindow={location:{search:''},echoSocket:socket};
 const mockDocument={hidden:false,querySelector(){return {textContent:''}}};
 const {syncFood,renderSharedFood}=new Function('window','document','URLSearchParams','console',
   js+'\nreturn {syncFood,renderSharedFood}')(mockWindow,mockDocument,URLSearchParams,{debug(){}});
 const positions=[];
 const ctx={
   createRadialGradient(){return {addColorStop(){}};},
   beginPath(){},arc(x,y){positions.push({x,y});},fill(){}
 };
 const ISO_X=0.8660254, ISO_Y=0.5, width=1200, height=350;
 const projected=(x,y,cx,cy)=>({x:width/2+((x-cx)-(y-cy))*ISO_X,
   y:height/2+((x-cx)+(y-cy))*ISO_Y});
 const last=()=>positions.at(-1);
 syncFood([{id:1,x:85,y:40,size:5,pulse:0}]);
 renderSharedFood(ctx,1000,0,0,0,0,width,height);
 assert.deepEqual(last(),projected(85,40,0,0));
 positions.length=0;
 renderSharedFood(ctx,1016,80,30,0,0,width,height);
 assert.deepEqual(last(),projected(85,40,80,30));
 // In the correction window, the camera can be near food while the actual
 // player is far away: this must NOT activate a visual pickup.
 syncFood([{id:2,x:70,y:0,size:5,pulse:0}]);
 positions.length=0;
 renderSharedFood(ctx,1032,65,0,1000,1000,width,height);
 assert.deepEqual(last(),projected(70,0,65,0));
 // Real player entering the radius triggers the fast magnet movement.
 syncFood([{id:3,x:70,y:0,size:5,pulse:0}]);
 positions.length=0;
 renderSharedFood(ctx,1048,0,0,0,0,width,height);
 const near1=last();
 positions.length=0;
 renderSharedFood(ctx,1064,0,0,0,0,width,height);
 const near2=last();
 assert.ok(near1.x<projected(70,0,0,0).x);
 assert.ok(near2.x<near1.x);
});

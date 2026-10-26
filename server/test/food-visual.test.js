'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Animated food trial preserves white dot fallback and authoritative pickup',()=>{
 const root=path.join(__dirname,'../..');
 const script=fs.readFileSync(path.join(root,'client/shared-food.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
 const server=fs.readFileSync(path.join(root,'server/food.js'),'utf8');
 assert.match(script,/FOOD_VISUAL_MODE = new URLSearchParams\(window\.location\.search\)\.get\('food'\) === 'dots' \? 'dots' : 'icon'/);
 assert.match(script,/loadAnimatedWebpFrames\('\.\/assets\/icons\/food\.webp\?v=echo-food-animated-2'\)/);
 assert.match(script,/if \(FOOD_VISUAL_MODE === 'icon' && foodAnimation\)/);
 assert.match(script,/ctx\.drawImage\(currentFrame, p\.x - iconSize \/ 2, p\.y - iconSize \/ 2, iconSize, iconSize\)/);
 assert.match(script,/\.catch\(error => \{/);
 assert.match(script,/const halo = ctx\.createRadialGradient/);
 assert.match(script,/ctx\.arc\(p\.x, p\.y, radius, 0, Math\.PI \* 2\)/);
 assert.match(script,/const FOOD_MAGNET_RADIUS = 60/);
 assert.match(script,/socket\.on\('echo:food', syncFood\)/);
 assert.match(server,/point\.active = false/);
 assert.match(server,/createFoodSnapshot/);
 assert.match(html,/shared-food\.js\?v=echo-food-animated-2/);
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

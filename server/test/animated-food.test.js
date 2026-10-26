'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const project=path.resolve(__dirname,'../..');
const modulePath=pathToFileURL(path.join(project,'client/animated-webp-frames.mjs')).href;

test('Food WebP has real animated frames, not a still poster',async()=>{
 const {parseAnimatedWebp,makeStillWebp}=await import(modulePath);
 const raw=fs.readFileSync(path.join(project,'client/assets/icons/food.webp'));
 const decoded=parseAnimatedWebp(raw);
 assert.equal(decoded.width,200);
 assert.equal(decoded.height,200);
 assert.equal(decoded.frames.length,73);
 assert.equal(decoded.duration,2920);
 for(const frame of decoded.frames){
  assert.equal(frame.delay,40);
  assert.ok(frame.x>=0&&frame.y>=0);
  assert.ok(frame.x+frame.width<=decoded.width);
  assert.ok(frame.y+frame.height<=decoded.height);
  const still=makeStillWebp(frame);
  assert.equal(String.fromCharCode(...still.subarray(0,4)),'RIFF');
  assert.equal(String.fromCharCode(...still.subarray(8,12)),'WEBP');
  assert.equal(String.fromCharCode(...still.subarray(12,16)),'VP8X');
  assert.equal(still.length,(still[4]|still[5]<<8|still[6]<<16|still[7]<<24)+8);
 }
});

test('WebP frames render explicitly and the white dot fallback stays available',()=>{
 const food=fs.readFileSync(path.join(project,'client/shared-food.js'),'utf8');
 const html=fs.readFileSync(path.join(project,'client/index.html'),'utf8');
 const decoder=fs.readFileSync(path.join(project,'client/animated-webp-frames.mjs'),'utf8');
 assert.ok(food.includes('foodAnimation.frameAt(time + point.id * 37)'));
 assert.ok(food.includes("get('food') === 'dots' ? 'dots' : 'icon'"));
 assert.ok(food.includes("foodAnimation = null"));
 assert.ok(food.includes('ctx.createRadialGradient'),'Old white food dots stay intact');
 assert.ok(food.includes('FOOD_VISUAL_MODE === \'icon\' && foodAnimation'));
 assert.ok(food.includes('loadAnimatedWebpFrames'));
 assert.ok(html.includes('shared-food.js?v=echo-food-animated-2'));
 assert.ok(decoder.includes("if(last?.dispose)ctx.clearRect"));
 assert.ok(decoder.includes("if(!frame.blend)ctx.clearRect"));
 assert.ok(decoder.includes("const snapshot=document.createElement('canvas')"));
 assert.ok(!food.includes('ctx.drawImage(foodIcon,'));
});

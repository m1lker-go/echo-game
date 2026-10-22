'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const client=path.join(__dirname,'../../client');
const css=fs.readFileSync(path.join(client,'pack-card-fan.css'),'utf8');
const js=fs.readFileSync(path.join(client,'pack-card-fan.js'),'utf8');
const html=fs.readFileSync(path.join(client,'index.html'),'utf8');

test('all opened fan cards scale 1.75x including their art and labels',()=>{
 const finalRule=css.lastIndexOf('#echo-pack-3d .echo-fan-card.is-launched{');
 assert.ok(finalRule>0);
 const body=css.slice(finalRule,css.indexOf('}',finalRule));
 assert.match(body,/rotate\(var\(--angle\)\).*scale\(1\.75\)!important/);
 // The final override must supersede legacy mobile variants of the fan.
 assert.ok(finalRule>css.lastIndexOf('@media(max-width:620px)'));
 assert.match(css,/transform-origin:50% 100%!important/);
 assert.match(css,/#echo-pack-3d \.echo-pack-card-fan\{\s*left:0;top:0;width:100%;height:100%/);
});

test('larger five-card fan stays within pack artwork at supported stage widths',()=>{
 assert.match(js,/card\.style\.setProperty\('--angle',\(-34\+i\*17\)\+'deg'\)/);
 // Stage-relative card width is 22%, final zoom is 175%, card aspect 2:3.
 // The fan is pivoted at the bottom and offset -3cqw above its pivot.
 for(const stageWidth of [180,240,320,420,600,800]){
  const width=stageWidth*0.22*1.75;
  const height=width*1.5;
  for(let i=0;i<5;i++){
   const angle=Math.abs(-34+i*17)*Math.PI/180;
   const horizontalExtent=height*Math.sin(angle)
      +(width/2)*Math.cos(angle)+stageWidth*0.03*Math.sin(angle);
   assert.ok(horizontalExtent<=stageWidth/2,
     'Card '+i+' exceeds foil at stage width '+stageWidth);
  }
 }
});

test('card fan stylesheet and script are both cache-busted for every client',()=>{
 assert.match(html,/pack-card-fan\.css\?v=echo-fan-labels-075-tap-1/);
 assert.match(html,/pack-card-fan\.js\?v=echo-fan-labels-075-tap-1/);
});

test('rarity plate, name and fragment counter are 75% of the original size before scaling',()=>{
 const rarity=css.slice(css.lastIndexOf('/* The shared .echo-pack-stage'));
 assert.match(css,/left:25\.25%;\s*width:49\.5%;\s*height:7\.5%;\s*padding:\.75px 6\.75%/);
 assert.match(rarity,/\.echo-fan-rarity\{\s*font-size:clamp\(5\.25px,1\.125cqw,9\.75px\)/);
 assert.match(rarity,/\.echo-fan-name\{\s*font-size:clamp\(5\.25px,1\.0875cqw,9px\)/);
 assert.match(rarity,/\.echo-fan-count\{[\s\S]*?padding:\.1875cqw \.4875cqw;[\s\S]*?font-size:clamp\(6\.75px,1\.275cqw,10\.5px\)/);
 // The artwork itself must retain its 1.75 enlargement and original 22% base width.
 assert.match(rarity,/width:22%;top:65%!important/);
 assert.match(rarity,/scale\(1\.75\)!important/);
});

test('one click anywhere inside pack modal reveals next card without stealing control clicks',()=>{
 assert.match(js,/root\?\.addEventListener\('click',event=>/);
 assert.doesNotMatch(js,/fan\?\.addEventListener\('click',launchNext\)/);
 assert.match(js,/root\.hidden\|\|!fan\?\.classList\.contains\('is-visible'\)\|\|nextIndex===0/);
 assert.match(js,/event\.target\?\.closest\?\.\('button, a, input, select, textarea, \[contenteditable="true"\]'\)/);
 assert.match(js,/fan\?\.addEventListener\('keydown'/);
});

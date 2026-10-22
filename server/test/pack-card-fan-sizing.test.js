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
 assert.match(html,/pack-card-fan\.css\?v=echo-fan-175-1/);
 assert.match(html,/pack-card-fan\.js\?v=echo-fan-175-1/);
});

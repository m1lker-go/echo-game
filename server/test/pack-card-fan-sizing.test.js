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

test('large cards recreate the earlier wide fan while staying inside narrow viewports',()=>{
 assert.match(css,/width:min\(32%,calc\(22\.8vw - \.8cqw - 4px\)\);top:65%!important/);
 assert.match(js,/card\.style\.setProperty\('--angle',\(-34\+i\*17\)\+'deg'\)/);
 // Rotated 2:3 cards still have 1.75x animation scale. A 32% base
 // deliberately overlaps the foil; narrow viewports cap the base width.
 for(const [viewport,stage] of [[360,336],[392,245],[640,400],[920,540],[1280,540],[1920,540]]){
  const cardWidth=Math.min(stage*.32, viewport*.228-stage*.008-4);
  const enlarged=cardWidth*1.75;
  const theta=34*Math.PI/180;
  const extent=enlarged*(1.5*Math.sin(theta)+.5*Math.cos(theta))
    +stage*.03*Math.sin(theta);
  assert.ok(extent <= viewport/2-6,
   'The fan would be cut off by the viewport '+viewport+' stage '+stage);
 }
});

test('card fan stylesheet and script are both cache-busted for every client',()=>{
 assert.match(html,/pack-card-fan\.css\?v=echo-fan-restored-32-1/);
 assert.match(html,/pack-card-fan\.js\?v=echo-fan-restored-32-1/);
});

test('readable wide rarity plate supports long Russian text without oversized counter',()=>{
 const stage=css.slice(css.lastIndexOf('/* The shared .echo-pack-stage'));
 assert.match(css,/left:10%;\s*width:80%;\s*height:9%;\s*padding:1px 4%/);
 assert.match(css,/clip-path:polygon\(9% 0,91% 0,100% 50%,91% 100%,9% 100%,0 50%\)/);
 assert.match(stage,/\.echo-fan-rarity\{\s*font-size:clamp\(6px,1\.25cqw,10\.5px\)/);
 assert.match(stage,/\.echo-fan-name\{\s*font-size:clamp\(6px,1\.2cqw,10px\)/);
 assert.match(stage,/\.echo-fan-count\{[\s\S]*?font-size:clamp\(6\.75px,1\.275cqw,10\.5px\)/);
 // The image and character keep their existing 1.75x zoom.
 assert.match(stage,/scale\(1\.75\)!important/);
 assert.match(css,/\.echo-fan-portrait\{\s*position:absolute;left:7%;top:5%;width:86%;height:67%/);
});

test('one click anywhere inside pack modal reveals next card without stealing control clicks',()=>{
 assert.match(js,/root\?\.addEventListener\('click',event=>/);
 assert.doesNotMatch(js,/fan\?\.addEventListener\('click',launchNext\)/);
 assert.match(js,/root\.hidden\|\|!fan\?\.classList\.contains\('is-visible'\)\|\|nextIndex===0/);
 assert.match(js,/event\.target\?\.closest\?\.\('button, a, input, select, textarea, \[contenteditable="true"\]'\)/);
 assert.match(js,/fan\?\.addEventListener\('keydown'/);
});

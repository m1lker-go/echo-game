'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const client=path.join(__dirname,'../../client');
const fullscreen=fs.readFileSync(path.join(client,'fullscreen.css'),'utf8');
const pack=fs.readFileSync(path.join(client,'pack-shop-3d.css'),'utf8');
const html=fs.readFileSync(path.join(client,'index.html'),'utf8');

function style(css,selector){
 const start=css.indexOf(selector+'{');
 assert.ok(start!==-1,'Missing CSS rule: '+selector);
 const body=css.slice(start+selector.length+1);
 return body.slice(0,body.indexOf('}'));
}

test('pack fullscreen and Close controls share nav coordinates instead of fixed offsets',()=>{
 const fullscreenRule=style(fullscreen,'#game:has(#echo-pack-3d:not([hidden])) > #echo-fullscreen-toggle');
 const closeRule=style(pack,'#game #echo-pack-3d #echo-pack-3d-close');
 assert.match(fullscreenRule,/right:\s*calc\(var\(--echo-nav-right\)\s*\+\s*var\(--echo-nav-size\)\s*\+\s*var\(--echo-nav-gap\)\)/);
 assert.doesNotMatch(fullscreenRule,/55px/);
 assert.match(closeRule,/right:\s*var\(--echo-nav-right/);
 assert.match(closeRule,/width:\s*var\(--echo-nav-size/);
 assert.match(closeRule,/height:\s*var\(--echo-nav-size/);
 const common=style(fullscreen,'#game > #echo-fullscreen-toggle,\n#game > #game-exit');
 assert.match(common,/top:\s*max\(5px,env\(safe-area-inset-top/);
 assert.match(closeRule,/top:\s*max\(5px,env\(safe-area-inset-top/);
});

test('new fullscreen stylesheet version is loaded in both browser and VK Mini Apps',()=>{
 assert.match(html,/fullscreen\.css\?v=echo-pack-toolbar-align-1/);
 assert.match(html,/id="echo-pack-3d-close"/);
 assert.match(html,/id="echo-fullscreen-toggle"/);
});

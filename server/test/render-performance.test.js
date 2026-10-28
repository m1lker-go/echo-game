'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const client=path.join(__dirname,'../../client');
const read=name=>fs.readFileSync(path.join(client,name),'utf8');
test('mobile power budget and desktop budget are independent of physics',async()=>{
 const module=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(read('render-performance.js')));
 assert.equal(module.isMobilePerformanceDevice('Mozilla iPhone'),true);
 assert.equal(module.isMobilePerformanceDevice('Mozilla Android'),true);
 assert.equal(module.isMobilePerformanceDevice('Mozilla Windows',true),true);
 assert.equal(module.isMobilePerformanceDevice('Mozilla Windows',false),false);
 assert.equal(module.renderPixelRatio(3,true),1.5);
 assert.equal(module.renderPixelRatio(3,false),2);
 assert.equal(module.renderPixelRatio(1,true),1);
 assert.equal(module.renderPixelRatio(undefined,true),1);
 assert.equal(module.targetFrameInterval(true),1000/30);
 assert.equal(module.targetFrameInterval(false),1000/60);
 assert.equal(module.shouldDrawScene(false,false),false);
 assert.equal(module.shouldDrawScene(true,true),false);
 assert.equal(module.shouldDrawScene(true,false),true);
});
test('world render loop suspends in menu and background and resumes on battle entry',()=>{
 const g=read('game.js');
 assert.match(g,/if\(!shouldDrawScene\(inActiveGame\(\),document\.hidden\)\)/);
 assert.match(g,/cancelAnimationFrame\(renderRequest\)/);
 assert.match(g,/addEventListener\('visibilitychange',syncGameRender\)/);
 assert.match(g,/addEventListener\('echo:returned-to-menu',syncGameRender\)/);
 assert.match(g,/addEventListener\('echo:game-started',syncGameRender\)/);
 assert.match(g,/time-previousRenderedAt<ECHO_FRAME_INTERVAL-1/);
 assert.match(g,/renderPixelRatio\(devicePixelRatio,ECHO_MOBILE_RENDER\)/);
 assert.match(g,/update\(dt,time\);draw\(time\)/);
});
test('unseen hero previews and menu particle canvas do no drawing',()=>{
 const m=read('menu.js');
 assert.match(m,/document\.hidden\|\|menu\.classList\.contains\('is-hidden'\)\|\|characterScreen\.hidden/);
 assert.match(m,/time-lastPreviewTime<ECHO_PREVIEW_INTERVAL-1/);
 assert.match(m,/document\.hidden\|\|menu\.classList\.contains\('is-hidden'\)\|\|mainScreen\.hidden/);
 assert.match(m,/time-lastMenuFoodAt<ECHO_MENU_INTERVAL-1/);
});
test('aura and shared food never render behind menu or when hidden',()=>{
 const a=read('player-aura.js'),f=read('shared-food.js');
 assert.match(a,/document\.hidden \|\| !game\.classList\.contains\('echo-in-battle'\)/);
 assert.match(a,/time-lastAuraAt<auraFrameInterval-1/);
 assert.match(f,/!isConnected\)\{/);
 assert.match(f,/time-lastFoodFrame<ECHO_FOOD_INTERVAL-1/);
 assert.match(f,/setTimeout\(findSocket,250\)/);
 assert.match(f,/socket\.on\('echo:food', syncFood\)/);
});
test('client cache versions updated for mobile without gameplay changes',()=>{
 const h=read('index.html');
 for(const file of ['menu','shared-food','player-aura'])assert.ok(h.includes(file+'.js?v=echo-render-budget-1'));
 assert.ok(h.includes('game.js?v=echo-camera-jitter-1'));
 assert.match(read('game.js'),/state\.socket\.emit\('echo:move'/);
 assert.match(read('shared-food.js'),/FOOD_MAGNET_RADIUS = 60/);
});

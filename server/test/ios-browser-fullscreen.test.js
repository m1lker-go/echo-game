'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const client=path.join(__dirname,'../../client');
const script=fs.readFileSync(path.join(client,'fullscreen.js'),'utf8');
const html=fs.readFileSync(path.join(client,'index.html'),'utf8');

function harness({userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',standalone=false,hasFullscreen=false,isVK=false}={}){
 let modal=null,fullscreenCalls=0,toasts=[],click=null,hidden=null;
 const button={
  classList:{toggle(){}},setAttribute(){},addEventListener(type,cb){if(type==='click')click=cb},
  get hidden(){return hidden},set hidden(value){hidden=value}
 };
 const game={
  classList:{contains:()=>true},
  requestFullscreen:hasFullscreen?()=>{fullscreenCalls++;return Promise.resolve()}:undefined,
  addEventListener(){},
 };
 const context={
  navigator:{userAgent,standalone},
  window:{isVKMobileMiniApp:isVK,matchMedia:()=>({matches:false,addEventListener(){}}),
   ECHOModal:{open(options){modal=options}},
   ECHOToast:{show(msg){toasts.push(msg)}}},
  document:{getElementById:k=>k==='game'?game:button,
   fullscreenElement:null,webkitFullscreenElement:null,addEventListener(){},
   createElement(tag){return {nodeName:tag,children:[],textContent:'',append(v){this.children.push(v)}}}},
  sessionStorage:{getItem:()=>null,setItem(){}},
  console:{warn(){}},
 };
 vm.runInNewContext(script,context);
 return {click:()=>click?.(),modal:()=>modal,toasts,fullscreenCalls:()=>fullscreenCalls,hidden:()=>hidden};
}

test('Browser fullscreen button still requests native fullscreen where supported',async()=>{
 const h=harness({userAgent:'Mozilla/5.0 (Linux; Android 15)',hasFullscreen:true});
 await h.click();
 assert.equal(h.fullscreenCalls(),1);
 assert.equal(h.modal(),null);
});
test('On iPhone Safari unsupported fullscreen opens actionable native ECHO modal instead of a broken action',async()=>{
 const h=harness();
 await h.click();
 assert.equal(h.fullscreenCalls(),0);
 assert.equal(h.modal().title,'НА ВЕСЬ ЭКРАН НА IPHONE');
 assert.ok(h.modal().contentElement.children.some(x=>x.textContent.includes('На экран Домой')));
});
test('Standalone iPhone PWA hides browser fullscreen control; VK Mini Apps keeps it disabled',async()=>{
 assert.equal(harness({standalone:true}).hidden(),true);
 const vk=harness({isVK:true});
 await vk.click();
 assert.equal(vk.modal(),null);
});
test('ECHO is installable as a stand-alone iPhone web app, without changing VK Android fullscreen policy',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(client,'manifest.webmanifest'),'utf8'));
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.start_url,'/echo/');
 assert.equal(manifest.scope,'/echo/');
 assert.equal(manifest.orientation,'landscape');
 assert.match(html,/rel="manifest" href="\.\/manifest\.webmanifest"/);
 assert.match(html,/apple-mobile-web-app-capable" content="yes"/);
 assert.match(html,/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
 assert.match(html,/fullscreen\.js\?v=echo-ios-install-1/);
 assert.match(script,/const allowFullscreenButton=!window\.isVKMobileMiniApp/);
 for(const lang of ['ru','en']){
  const dic=JSON.parse(fs.readFileSync(path.join(client,'locales',lang+'.json'),'utf8'));
  for(const k of ['fullscreen_ios_title','fullscreen_ios_button','fullscreen_ios_step_one','fullscreen_ios_step_two','fullscreen_ios_step_three','fullscreen_ios_step_four'])assert.ok(dic.game[k],lang+' missing '+k);
 }
});

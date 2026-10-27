'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../../client');
const toastSource=fs.readFileSync(path.join(root,'toast.js'),'utf8');
const questsSource=fs.readFileSync(path.join(root,'daily-quests.js'),'utf8');

function makeHarness(){
 const events=new Map(),timers=new Map();
 let timerId=0;
 const makeNode=()=>({
  parentNode:null,children:[],textContent:'',className:'',
  attributes:{},
  setAttribute(key,value){this.attributes[key]=value},
  classList:{values:new Set(),add(key){this.values.add(key)},remove(key){this.values.delete(key)},contains(key){return this.values.has(key)}},
  appendChild(child){
   if(child.parentNode&&child.parentNode!==this){
    child.parentNode.children=child.parentNode.children.filter(item=>item!==child);
   }
   if(!this.children.includes(child))this.children.push(child);
   child.parentNode=this;return child;
  },
  replaceChildren(...children){this.children=children;for(const child of children)child.parentNode=this}
 });
 const body=makeNode(),game=makeNode();
 const document={body,fullscreenElement:null,webkitFullscreenElement:null,
  createElement:makeNode,addEventListener(type,fn){events.set(type,fn)}};
 const window={};
 vm.runInNewContext(toastSource,{
  window,document,Node:Object,
  setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},
  clearTimeout(id){timers.delete(id)}
 },{filename:'toast.js'});
 return {window,document,body,game,events,timers};
}
test('Quest reward toast renders in normal browsers and accepts a coin-icon node',()=>{
 const h=makeHarness(),reward={textContent:'Получено: 10',nodeType:1};
 h.window.ECHOToast.show(reward);
 assert.equal(h.body.children.length,1);
 assert.equal(h.body.children[0].classList.contains('is-visible'),true);
 assert.equal(h.body.children[0].children[0],reward);
 assert.match(questsSource,/if\(data\.claimedNow\)\{/);
 assert.match(questsSource,/window\.ECHOToast\?\.show\(message\)/);
});
test('In fullscreen, the toast mounts inside the #game top layer',()=>{
 const h=makeHarness();
 h.document.fullscreenElement=h.game;
 h.window.ECHOToast.show('Получено: 10');
 assert.equal(h.game.children.length,1);
 assert.equal(h.body.children.length,0);
 assert.equal(h.game.children[0].textContent,'Получено: 10');
});
test('Toast follows fullscreen transitions without creating duplicate nodes',()=>{
 const h=makeHarness();
 h.window.ECHOToast.show('First reward');
 const toast=h.body.children[0];
 h.document.fullscreenElement=h.game;
 h.events.get('fullscreenchange')();
 assert.equal(h.game.children[0],toast);
 assert.equal(h.body.children.length,0);
 h.window.ECHOToast.show('Second reward');
 assert.equal(h.game.children.length,1);
 h.document.fullscreenElement=null;
 h.events.get('fullscreenchange')();
 assert.equal(h.body.children[0],toast);
 assert.equal(h.game.children.length,0);
});
test('Safari WebKit-prefixed fullscreen also keeps notifications visible',()=>{
 const h=makeHarness();
 h.document.webkitFullscreenElement=h.game;
 h.window.ECHOToast.show('Reward');
 assert.equal(h.game.children.length,1);
 h.document.webkitFullscreenElement=null;
 h.events.get('webkitfullscreenchange')();
 assert.equal(h.body.children.length,1);
});
test('Toast script version refreshes PWA/Android WebView/browser caches',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/toast\.js\?v=echo-fullscreen-rewards-1/);
 assert.match(html,/daily-quests\.js\?v=echo-quest-status-sort-1/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const client=path.join(__dirname,'../../client');
const source=fs.readFileSync(path.join(client,'daily-quests.js'),'utf8');

function createRender(){
 const nodes=new Map();
 function element(){
  return {textContent:'',className:'',hidden:false,style:{},dataset:{},children:[],
   setAttribute(){},addEventListener(){},append(...items){this.children.push(...items)},
   replaceChildren(...items){this.children=items},
   classList:{contains(){return false},toggle(){},add(){},remove(){}}
  };
 }
 for(const id of ['#quests-list','#quests-status','#quests-reset','#menu-quests-screen',
   '#echo-quest-hud','#echo-quest-hud-name','#echo-quest-hud-action','#main-menu'])
  nodes.set(id,element());
 const document={
  hidden:false,querySelector:key=>nodes.get(key),
  createElement:element,createElementNS:(_ns,_tag)=>element(),
  createTextNode:text=>({textContent:text}),addEventListener(){}
 };
 const window={addEventListener(){},$t:(_key,fallback)=>fallback};
 const context={document,window,localStorage:{getItem:()=>null},Date,Math,
  console,URL,location:{origin:'https://cat-fight.ru'},setInterval(){}};
 vm.runInNewContext(source+
  '\n'+'globalThis.testRender=quests=>{current={quests};render();return list.children.map(e=>({id:e.dataset.questId,classes:e.className}));};',
  context,{filename:'daily-quests.js'});
 return quests=>Array.from(context.testRender(quests));
}

test('claimable quests first, active quests next, fully claimed quests last',()=>{
 const render=createRender();
 const quests=[
  {id:'play',level:2,levels:5,target:300,progress:30,available:true,claimed:false,reward:4},
  {id:'pack_coin',level:1,levels:1,target:1,progress:1,available:true,claimed:true,reward:5},
  {id:'food',level:2,levels:5,target:200,progress:200,available:true,claimed:false,reward:4},
  {id:'pvp',level:1,levels:5,target:3,progress:1,available:true,claimed:false,reward:2},
  {id:'video',level:1,levels:5,target:1,progress:1,available:true,claimed:false,reward:10},
  {id:'pack_premium',level:1,levels:1,target:1,progress:1,available:true,claimed:true,reward:50}
 ];
 const original=quests.map(q=>q.id);
 const ordered=render(quests);
 assert.deepEqual(ordered.map(q=>q.id),['food','video','play','pvp','pack_coin','pack_premium']);
 assert.deepEqual(quests.map(q=>q.id),original,'do not mutate the server snapshot');
 assert.ok(ordered.slice(0,2).every(q=>q.classes.includes('is-ready')));
 assert.ok(ordered.slice(-2).every(q=>q.classes.includes('is-complete')));
});

test('after claiming a tier the quest moves, but only the last claim greys it',()=>{
 const render=createRender();
 const active={id:'play',level:1,levels:5,target:300,progress:0,available:true,claimed:false,reward:2};
 const ready={id:'food',level:1,levels:5,target:50,progress:50,available:true,claimed:false,reward:2};
 assert.deepEqual(render([active,ready]).map(q=>q.id),['food','play']);
 const next={...ready,level:2,target:200,progress:50,reward:4};
 const after=render([active,next]);
 assert.deepEqual(after.map(q=>q.id),['play','food']);
 assert.ok(!after[1].classes.includes('is-complete'));
 const claimed={...ready,level:5,target:2000,progress:2000,claimed:true,reward:10};
 const fully=render([claimed,active]);
 assert.deepEqual(fully.map(q=>q.id),['play','food']);
 assert.ok(fully[1].classes.includes('is-complete'));
});

test('claimed cards have grayscale rewards, grey bars, nonpulsing level dots',()=>{
 const daily=fs.readFileSync(path.join(client,'daily-quests.css'),'utf8');
 const special=fs.readFileSync(path.join(client,'special-quests.css'),'utf8');
 const html=fs.readFileSync(path.join(client,'index.html'),'utf8');
 assert.match(daily,/\.echo-quest\.is-complete \.echo-quest-track>div\{background:#626a73\}/);
 assert.match(daily,/\.echo-quest\.is-complete \.echo-quest-reward img\{[^}]*grayscale\(1\)/s);
 assert.match(daily,/\.echo-quest\.is-complete \.echo-quest-dot\{[^}]*animation:none/s);
 assert.doesNotMatch(special,/\.echo-special-card\.is-complete \.echo-special-logo-image\{[^}]*grayscale\(1\)/s);
 assert.match(special,/\.echo-special-card\.is-complete \{ border-color: rgba\(255, 255, 255, \.8\); \}/);
 assert.match(html,/special-quests\.css\?v=6-claimed-color-1/);
 assert.match(html,/daily-quests\.js\?v=echo-quest-status-sort-1/);
 assert.match(html,/daily-quests\.css\?v=echo-quest-status-sort-1/);
});

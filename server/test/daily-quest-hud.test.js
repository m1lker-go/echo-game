'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../client/daily-quests.js'), 'utf8');

function createHarness() {
  const elements=new Map();
  const documentEvents=new Map();
  const intervals=new Map();
  let sessionToken=null;
  let playing=false;
  const requests=[];
  const makeElement=()=>({
    hidden:false,textContent:'',className:'',dataset:{},children:[],
    classList:{toggle(){},add(){},remove(){},contains:()=>playing},
    addEventListener(){},setAttribute(){},
    append(...children){this.children.push(...children)},
    replaceChildren(...children){this.children=children},
  });
  for(const selector of [
    '#quests-list','#quests-status','#quests-reset','#menu-quests-screen',
    '#echo-quest-hud','#echo-quest-hud-name','#echo-quest-hud-action','#main-menu'
  ])elements.set(selector,makeElement());
  elements.get('#menu-quests-screen').hidden=true;
  const document={
    hidden:false,
    querySelector:selector=>elements.get(selector)||null,
    createElement:makeElement,
    addEventListener(type,fn){const e=documentEvents.get(type)||[];e.push(fn);documentEvents.set(type,e)},
    dispatchEvent(event){for(const fn of documentEvents.get(event.type)||[])fn(event)}
  };
  const window={addEventListener(){},$t:(_key,fallback)=>fallback};
  const localStorage={getItem:key=>key==='echo.authToken'?sessionToken:null};
  const fetch=async(url,options)=>{
    requests.push({url:String(url),auth:options.headers.Authorization});
    return {ok:true,json:async()=>({
      quests:[
        {id:'play',level:1,levels:5,progress:40,target:300,claimed:false,available:true},
        {id:'food',level:1,levels:5,progress:10,target:50,claimed:false,available:true},
        {id:'pvp',level:1,levels:5,progress:0,target:3,claimed:false,available:true}
      ]
    })};
  };
  vm.runInNewContext(source,{document,window,localStorage,location:{origin:'https://cat-fight.ru'},URL,
    fetch,console,Date,queueMicrotask,setInterval(fn,ms){intervals.set(ms,fn)}},{filename:'daily-quests.js'});
  return {elements,document,intervals,requests,
    enterGame(){playing=true},
    exitGame(){playing=false},
    signIn(token){sessionToken=token;document.dispatchEvent({type:'echo:auth-changed',detail:{authenticated:true}})},
    signOut(){sessionToken=null;document.dispatchEvent({type:'echo:auth-changed',detail:{authenticated:false}})},
    async flush(){await new Promise(resolve=>setImmediate(resolve))},
  };
}

test('VK delayed login initializes quest HUD after the game already started',async()=>{
  const h=createHarness();
  h.elements.get('#echo-quest-hud').hidden=true;
  assert.deepEqual([...h.intervals.keys()].sort(),[1000,5000]);
  assert.equal(h.requests.length,0);
  h.enterGame();
  h.signIn('vk-authorized-token');
  await h.flush();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].auth,'Bearer vk-authorized-token');
  assert.equal(h.elements.get('#echo-quest-hud').hidden,false);
  assert.equal(h.elements.get('#echo-quest-hud-name').children[0].children[0].textContent,'food');
  assert.match(h.elements.get('#echo-quest-hud-action').textContent,/Осталось:/);
});

test('game starts after login and polls without requiring a page reload',async()=>{
  const h=createHarness();
  h.elements.get('#echo-quest-hud').hidden=true;
  h.signIn('vk-authorized-token');
  await h.flush();
  assert.equal(h.requests.length,0,'menu should not fetch the in-game HUD');
  h.enterGame();
  h.intervals.get(5000)();
  await h.flush();
  assert.equal(h.requests.length,1);
  assert.equal(h.elements.get('#echo-quest-hud').hidden,false);
  h.exitGame();
  h.document.dispatchEvent({type:'echo:returned-to-menu'});
  assert.equal(h.elements.get('#echo-quest-hud').hidden,true);
  h.intervals.get(5000)();
  await h.flush();
  assert.equal(h.requests.length,1,'menu should not poll server');
});

test('VK logout hides stale quest progress and stops authenticated requests',async()=>{
  const h=createHarness();
  h.elements.get('#echo-quest-hud').hidden=true;
  h.enterGame();
  h.signIn('vk-authorized-token');
  await h.flush();
  assert.equal(h.elements.get('#echo-quest-hud').hidden,false);
  h.signOut();
  assert.equal(h.elements.get('#echo-quest-hud').hidden,true);
  h.intervals.get(5000)();
  await h.flush();
  assert.equal(h.requests.length,1);
});

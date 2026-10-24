'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../../client/battle-entry-ads.js'),'utf8');
function harness(){
 const entries=new Map();
 const localStorage={
  getItem:k=>entries.get(k)??null,
  setItem:(k,v)=>entries.set(k,String(v))
 };
 const window={isVKMiniApp:false};
 const ctx={window,localStorage,Date,Intl,Math,JSON,Promise,Error,console,setTimeout,clearTimeout};
 vm.runInNewContext(source.replaceAll('export async function','async function').replaceAll('export const','const')+
  '\nglobalThis.adTest = {battleAdSchedule,showAdBeforeBattle};',ctx);
 return {localStorage,window,schedule:ctx.adTest.battleAdSchedule.scheduleBattleEntry,day:ctx.adTest.battleAdSchedule.moscowDay};
}

test('guest sees scheduled ads at 3,5,7,9 and no other entry',()=>{
 const h=harness();
 const seq=Array.from({length:11},()=>h.schedule({storage:h.localStorage,token:null,date:'2026-10-24'}));
 assert.deepEqual(seq.filter(x=>x.showAd).map(x=>x.count),[3,5,7,9,11]);
 assert.ok(seq.every(x=>x.registered===false));
});
test('signed-in profile first sees ad at fifth entry, then every other',()=>{
 const h=harness();
 const seq=Array.from({length:11},()=>h.schedule({storage:h.localStorage,token:'user-auth-token',date:'2026-10-24'}));
 assert.deepEqual(seq.filter(x=>x.showAd).map(x=>x.count),[5,7,9,11]);
 assert.ok(seq.every(x=>x.registered===true));
});
test('guests and distinct registered identities count independently',()=>{
 const h=harness();
 h.schedule({storage:h.localStorage,token:null,date:'2026-10-24'});
 h.schedule({storage:h.localStorage,token:'account1',date:'2026-10-24'});
 assert.equal(h.schedule({storage:h.localStorage,token:null,date:'2026-10-24'}).count,2);
 assert.equal(h.schedule({storage:h.localStorage,token:'account1',date:'2026-10-24'}).count,2);
 assert.equal(h.schedule({storage:h.localStorage,token:'account2',date:'2026-10-24'}).count,1);
});
test('a new Moscow calendar day resets per-account counters',()=>{
 const h=harness();
 for(let i=0;i<6;i++)h.schedule({storage:h.localStorage,token:'account',date:'2026-10-24'});
 const next=h.schedule({storage:h.localStorage,token:'account',date:'2026-10-25'});
 assert.equal(next.count,1);
 assert.equal(next.showAd,false);
});
test('Moscow date boundary is 21:00 UTC (winter)',()=>{
 const h=harness();
 assert.equal(h.day(new Date('2026-10-24T20:59:59.000Z')),'2026-10-24');
 assert.equal(h.day(new Date('2026-10-24T21:00:00.000Z')),'2026-10-25');
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createVideoBonus,REWARDS,PLACEMENT_ID}=require('../video-bonus');

function harness(){
 const routes={};
 const days=new Map();
 let date='2026-10-24',clock=Date.parse('2026-10-24T12:00:00.000Z'),balance=0;
 const key=(id,day)=>id+':'+day;
 const query=async(sql,args=[])=>{
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('BEGIN')||sql.startsWith('COMMIT')||
     sql.startsWith('ROLLBACK')||sql.startsWith('SELECT pg_advisory'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO echo_daily_video_bonus')){
   if(!days.has(key(args[0],args[1])))days.set(key(args[0],args[1]),{watched:0,claimed:0,attempt_id:null,started_at:null});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT watched,claimed')){
   const r=days.get(key(args[0],args[1]));
   return {rows:r?[{...r}]:[],rowCount:r?1:0};
  }
  if(sql.startsWith('UPDATE echo_daily_video_bonus SET attempt_id')){
   Object.assign(days.get(key(args[0],args[1])),{attempt_id:args[2],started_at:new Date(clock)});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE echo_daily_video_bonus SET watched=')){
   const r=days.get(key(args[0],args[1]));r.watched=r.claimed+1;r.attempt_id=null;r.started_at=null;
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE echo_daily_video_bonus SET claimed=')){
   days.get(key(args[0],args[1])).claimed++;
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('INSERT INTO echo_wallets')){balance+=args[1];return {rowCount:1,rows:[]};}
  throw Error('Unexpected SQL: '+sql);
 };
 const db={query,connect:async()=>({query,release(){}})};
 const api=createVideoBonus({
  pool:db,sessionUser:async req=>req.auth?{id:'account-a'}:null,
  dailyDateKey:()=>date,now:()=>clock,createRouter:()=>({
   post:(url,handler)=>{routes[url]=handler;}
  })
 });
 const call=async (url,{auth=true,body={}}={})=>{
  let responseStatus=200,data;
  const res={
   set(){return this},
   status(n){responseStatus=n;return this},
   json(v){data=v;return this}
  };
  await routes[url]({auth,body},res);
  return {status:responseStatus,data};
 };
 return {api,call,get balance(){return balance},advance:n=>{clock+=n},
  nextDay:()=>{date='2026-10-25'},state:()=>days.get(key('account-a',date))};
}

test('ad block and tier rewards are fixed',()=>{
 assert.equal(PLACEMENT_ID,2096987);
 assert.deepEqual(REWARDS,[10,15,20,25,30]);
 assert.equal(REWARDS.reduce((sum,n)=>sum+n,0),100);
});

test('unauthenticated players cannot claim rewarded coins',async()=>{
 const h=harness();await h.api.initialize();
 assert.equal((await h.call('/start',{auth:false})).status,401);
 assert.equal((await h.call('/complete',{auth:false})).status,401);
 assert.equal((await h.call('/claim',{auth:false})).status,401);
 assert.equal(h.balance,0);
});

test('a user must complete an issued attempt before claiming; replay is rejected',async()=>{
 const h=harness();await h.api.initialize();
 assert.equal((await h.call('/claim')).status,409);
 const start=await h.call('/start');assert.equal(start.status,200);
 assert.equal(start.data.level,1);
 assert.equal(start.data.placementId,2096987);
 assert.equal((await h.call('/complete',{body:{attemptId:start.data.attemptId}})).status,409);
 assert.equal(h.balance,0);
 h.advance(5000);
 assert.equal((await h.call('/complete',{body:{attemptId:start.data.attemptId}})).status,200);
 assert.equal((await h.call('/complete',{body:{attemptId:start.data.attemptId}})).status,409);
 const ready=await h.api.getQuest('account-a');
 assert.equal(ready.adWatched,true);
 assert.equal(ready.progress,1);
 assert.equal((await h.call('/start')).status,409);
 const claim=await h.call('/claim');
 assert.equal(claim.status,200);
 assert.equal(claim.data.reward,10);
 assert.equal(h.balance,10);
 assert.equal((await h.call('/claim')).status,409);
 assert.equal(h.balance,10);
 const next=await h.api.getQuest('account-a');
 assert.equal(next.level,2);
 assert.equal(next.reward,15);
 assert.equal(next.progress,0);
});

test('five successive ad+claim steps cap at 100 and reset next Moscow day',async()=>{
 const h=harness();await h.api.initialize();
 for(const reward of [10,15,20,25,30]){
  const start=await h.call('/start');
  assert.equal(start.status,200);
  h.advance(6000);
  assert.equal((await h.call('/complete',{body:{attemptId:start.data.attemptId}})).status,200);
  const claim=await h.call('/claim');
  assert.equal(claim.status,200);
  assert.equal(claim.data.reward,reward);
 }
 assert.equal(h.balance,100);
 assert.equal((await h.call('/start')).status,409);
 assert.equal((await h.call('/claim')).status,409);
 assert.equal((await h.api.getQuest('account-a')).claimed,true);
 h.nextDay();
 const next=await h.api.getQuest('account-a');
 assert.equal(next.level,1);
 assert.equal(next.progress,0);
 assert.equal(next.reward,10);
 assert.equal((await h.call('/start')).status,200);
});

test('an attempt from a previous date cannot be completed after reset',async()=>{
 const h=harness();await h.api.initialize();
 const start=await h.call('/start');
 h.nextDay();h.advance(5000);
 assert.equal((await h.call('/complete',{body:{attemptId:start.data.attemptId}})).status,409);
 assert.equal(h.balance,0);
});

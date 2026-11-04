'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAdFree}=require('../ad-free');
const {createVideoBonus}=require('../video-bonus');
const ACCOUNT='123e4567-e89b-42d3-a456-426614174000';
function router(){
 const routes={};
 return {routes,get:(p,h)=>routes['GET '+p]=h,post:(p,h)=>routes['POST '+p]=h};
}
function response(){
 return {statusCode:200,data:null,headers:{},
  set(k,v){this.headers[k]=v;return this},
  status(n){this.statusCode=n;return this},
  json(v){this.data=v;return this}};
}
test('ad-free entitlement follows verified receipts, not a browser flag',async()=>{
 const receipts=[];
 const pool={async query(sql,args=[]){
  if(sql.startsWith('CREATE')||sql.startsWith('CREATE INDEX'))return {rows:[]};
  if(sql.includes('SELECT EXISTS'))return {rows:[{active:receipts.some(r=>r.account===args[0]&&!r.revoked&&(!r.isTest||args[1]))}]};
  if(sql.startsWith('INSERT INTO echo_ad_free_receipts')){
   if(!receipts.some(r=>r.provider===args[1]&&r.orderId===args[2]&&r.isTest===args[3]))
    receipts.push({account:args[0],provider:args[1],orderId:args[2],isTest:args[3],revoked:false});
   return {rows:[]};
  }
  if(sql.startsWith('UPDATE echo_ad_free_receipts')){
   for(const r of receipts)if(r.provider===args[0]&&r.orderId===args[1]&&r.isTest===args[2])r.revoked=true;
   return {rows:[]};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
 const r=router(), service=createAdFree({pool,sessionUser:async()=>({id:ACCOUNT}),createRouter:()=>r});
 await service.initialize();
 const before=response();
 await r.routes['GET /status']({},before);
 assert.equal(before.data.active,false);
 await service.grant(pool,ACCOUNT,'robokassa','2000000001',false);
 await service.grant(pool,ACCOUNT,'robokassa','2000000001',false);
 assert.equal(receipts.length,1,'duplicate callbacks must not create a new receipt');
 const after=response();
 await r.routes['GET /status']({},after);
 assert.equal(after.data.active,true);
 await service.refund(pool,'robokassa','2000000001',false);
 assert.equal(await service.has(pool,ACCOUNT),false);
 await service.grant(pool,ACCOUNT,'vk','100',true);
 assert.equal(await service.has(pool,ACCOUNT),false,'test purchases do not enable production entitlements');
});
test('paid account claims the 5 daily video tiers instantly and atomically',async()=>{
 const state={claimed:0,watched:0,coins:0,active:true,commits:0};
 const client={async query(sql,args=[]){
  if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[]};
  if(sql==='COMMIT'){state.commits++;return {rows:[]};}
  if(sql.startsWith('SELECT pg_advisory')||sql.startsWith('INSERT INTO echo_daily_video_bonus'))return {rows:[]};
  if(sql.includes('FOR UPDATE'))return {rows:[{claimed:state.claimed,watched:state.watched}]};
  if(sql.startsWith('UPDATE echo_daily_video_bonus')){state.claimed++;state.watched++;return {rows:[]};}
  if(sql.startsWith('INSERT INTO echo_wallets')){state.coins+=args[1];return {rows:[]};}
  throw Error('Unexpected SQL: '+sql);
 },release(){}};
 const pool={connect:async()=>client},r=router();
 const video=createVideoBonus({pool,sessionUser:async()=>({id:ACCOUNT}),
   dailyDateKey:()=> '2026-11-04',hasAdFree:async()=>state.active,createRouter:()=>r});
 const claim=r.routes['POST /ad-free-claim'];
 state.active=false;
 const denied=response();await claim({},denied);
 assert.equal(denied.statusCode,403);assert.equal(state.coins,0);
 state.active=true;
 for(let i=0;i<5;i++){
  const result=response();await claim({},result);
  assert.equal(result.data.claimedNow,true);
  assert.equal(result.data.level,i+1);
 }
 assert.equal(state.coins,100);
 assert.equal(state.commits,5);
 const exhausted=response();await claim({},exhausted);
 assert.equal(exhausted.statusCode,409);
 assert.equal(state.coins,100);
});

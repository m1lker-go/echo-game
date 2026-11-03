'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTutorialProgress}=require('../tutorial-progress');
const id='123e4567-e89b-42d3-a456-426614174000';
function setup({signedIn=true,failGrant=false}={}){
 const routes={},calls=[],state={record:null,credits:0,oldEnough:false,transactions:0};
 let snapshot=null;
 const sql=async(q,args=[],inTransaction=false)=>{
   calls.push(q);
   if(q.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};
   if(q.startsWith('SELECT completed_at IS NOT NULL AS completed FROM'))
     return {rows:state.record?[{completed:!!state.record.completed}]:[],rowCount:state.record?1:0};
   if(q.startsWith('INSERT INTO echo_tutorial_progress')){
     if(!state.record)state.record={completed:false,hash:args[1]};
     else if(!state.record.completed)state.record.hash=args[1];
     return {rows:[{completed:state.record.completed}],rowCount:1};
   }
   if(q.startsWith('SELECT completed_at IS NOT NULL AS completed,attempt_hash'))
     return {rows:state.record?[{completed:state.record.completed,attempt_hash:state.record.hash,
       old_enough:state.oldEnough}]:[],rowCount:state.record?1:0};
   if(q.startsWith('UPDATE echo_tutorial_progress')){
     state.record.completed=true;state.record.hash=null;
     return {rows:[],rowCount:1};
   }
   if(q==='BEGIN'){snapshot={record:state.record?{...state.record}:null,credits:state.credits};state.transactions++;return {rows:[]};}
   if(q==='COMMIT'){snapshot=null;return {rows:[]};}
   if(q==='ROLLBACK'){if(snapshot){state.record=snapshot.record;state.credits=snapshot.credits;}snapshot=null;return {rows:[]};}
   throw Error('Unexpected SQL: '+q);
 };
 const pool={
  query:(...args)=>sql(...args),
  async connect(){return {query:(...args)=>sql(...args,true),release(){}};}
 };
 const controller=createTutorialProgress({
   pool,
   sessionUser:async()=>signedIn?{id}:null,
   async grantPack(account,pack,quantity,transaction){
     assert.equal(account,id);assert.equal(pack,'coin');assert.equal(quantity,3);
     assert.ok(transaction,'reward must use SQL transaction');
     if(failGrant)throw Error('forced grant failure');
     state.credits+=quantity;return state.credits;
   },
   createRouter:()=>({
     get(path,handler){routes['GET '+path]=handler;},
     post(path,handler){routes['POST '+path]=handler;}
   })
 });
 async function request(method,path,body={}){
   let payload,status=200;
   const res={
     status(n){status=n;return this},
     set(){return this},
     json(x){payload=x;return this}
   };
   await routes[method+' '+path]({body,headers:{}},res);
   return {status,payload};
 }
 return {controller,request,state,calls};
}
test('tutorial status is per-account and begins incomplete',async()=>{
 const h=setup();await h.controller.initialize();
 assert.ok(h.calls.some(q=>q.includes('REFERENCES echo_accounts(id) ON DELETE CASCADE')));
 assert.deepEqual((await h.request('GET','/status')).payload,{completed:false});
});
test('claim needs a server attempt and does not complete before final click',async()=>{
 const h=setup();
 const empty=await h.request('POST','/claim',{attempt:'a'.repeat(64)});
 assert.equal(empty.status,409);
 const start=(await h.request('POST','/start')).payload;
 assert.match(start.attempt,/^[a-f0-9]{64}$/);
 assert.deepEqual((await h.request('GET','/status')).payload,{completed:false});
 const early=await h.request('POST','/claim',{attempt:start.attempt});
 assert.equal(early.status,409);
 assert.equal(h.state.credits,0);
 h.state.oldEnough=true;
 const wrong=await h.request('POST','/claim',{attempt:'b'.repeat(64)});
 assert.equal(wrong.status,409);
 const claim=await h.request('POST','/claim',{attempt:start.attempt});
 assert.deepEqual(claim.payload,{completed:true,alreadyClaimed:false,rewarded:true,packs:3});
 assert.equal(h.state.credits,3);
 assert.equal(h.state.record.completed,true);
 const again=await h.request('POST','/claim',{attempt:start.attempt});
 assert.equal(again.payload.alreadyClaimed,true);
 assert.equal(h.state.credits,3);
 assert.deepEqual((await h.request('GET','/status')).payload,{completed:true});
 const anotherStart=await h.request('POST','/start');
 assert.deepEqual(anotherStart.payload,{completed:true,attempt:null});
});
test('grant failure rolls back both completion and packs',async()=>{
 const h=setup({failGrant:true});
 const a=(await h.request('POST','/start')).payload.attempt;
 h.state.oldEnough=true;
 assert.equal((await h.request('POST','/claim',{attempt:a})).status,500);
 assert.equal(h.state.record.completed,false);
 assert.equal(h.state.credits,0);
 assert.ok(h.calls.includes('ROLLBACK'));
});
test('guests cannot start, claim, get status or obtain packs',async()=>{
 const h=setup({signedIn:false});
 for(const [verb,path] of [['GET','/status'],['POST','/start'],['POST','/claim']]){
   const res=await h.request(verb,path,{attempt:'c'.repeat(64)});
   assert.equal(res.status,401);
 }
 assert.equal(h.state.credits,0);
});

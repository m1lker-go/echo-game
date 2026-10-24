'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.VK_MINI_APP_ID='54838920';
process.env.VK_MINI_APP_SECRET='this-is-a-fake-protected-test-key';
const {createVKPayments,verifyNotification,checkVKOrderProduct,PREMIUM_PRICE}=require('../vk-payments');
const accountId='123e4567-e89b-42d3-a456-426614174000';
function sign(fields={}) {
 const body={notification_type:'get_item_test',app_id:'54838920',user_id:'12345',item:'1',...fields};
 const payload=Object.keys(body).sort().map(k=>k+'='+body[k]).join('');
 return {...body,sig:crypto.createHash('md5').update(payload+process.env.VK_MINI_APP_SECRET).digest('hex')};
}
function harness() {
 const routes={};
 const paid=new Map();
 const intents=new Map();
 let grants=0;
 let questPremium=0;
 let connectionCount=0;
 const sql=[];
 const pool={
  async query(query,params=[]) {
   sql.push(query);
   if(query.startsWith('CREATE TABLE')||query.startsWith('ALTER TABLE'))return {rowCount:0,rows:[]};
   if(query.startsWith('SELECT provider_id FROM echo_accounts'))return {rowCount:1,rows:[{provider_id:'12345'}]};
   if(query.startsWith('UPDATE echo_vk_payments p')) {
     const order=paid.get(params[0]+':'+params[1]);
     if(!order||params[2]!=='12345')return {rowCount:0,rows:[]};
     order.status='refunded';order.refunded_at=new Date();
     return {rowCount:1,rows:[{app_order_id:order.app_order_id}]};
   }
   if(query.startsWith('INSERT INTO echo_vk_payment_intents')) {
     intents.set(params[0],{status:'pending',cards:null});
     return {rowCount:1,rows:[]};
   }
   if(query.startsWith('SELECT i.status, p.cards FROM echo_vk_payment_intents')) {
     const i=intents.get(params[0]);
     return i?{rowCount:1,rows:[i]}:{rowCount:0,rows:[]};
   }
   throw Error('Unexpected pool query '+query.slice(0,90));
  },
  async connect() {
   connectionCount++;
   return {release(){},async query(query,params=[]) {
    sql.push(query);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(query))return {rowCount:0,rows:[]};
    if(query.startsWith('SELECT id::text AS id FROM echo_accounts'))
      return {rowCount:params[0]==='12345'?1:0,rows:params[0]==='12345'?[{id:accountId}]:[]};
    if(query.startsWith('SELECT app_order_id,account_id FROM echo_vk_payments')) {
      const order=paid.get(params[0]+':'+params[1]);
      return order?{rowCount:1,rows:[order]}:{rowCount:0,rows:[]};
    }
    if(query.startsWith('SELECT id FROM echo_vk_payment_intents')) {
      const last=[...intents.entries()].reverse().find(([,value])=>value.status==='pending');
      return {rowCount:last?1:0,rows:last?[{id:last[0]}]:[]};
    }
    if(query.startsWith('INSERT INTO echo_vk_payments')) {
      const key=params[0]+':'+params[1];
      if(paid.has(key))return {rowCount:0,rows:[]};
      const order={app_order_id:'42',account_id:params[3]};
      paid.set(key,order);
      if(params[2])intents.get(params[2]).cards=JSON.parse(params[5]);
      return {rowCount:1,rows:[order]};
    }
    if(query.startsWith('INSERT INTO echo_hero_collection')){grants++;return {rowCount:1,rows:[]}};
    if(query.startsWith('INSERT INTO echo_daily_activity(')){
      assert.match(query,/pack_premium_opened/);
      questPremium++;return {rowCount:1,rows:[]};
    }
    if(query.startsWith('UPDATE echo_vk_payment_intents')){intents.get(params[0]).status='paid';return {rowCount:1,rows:[]}};
    throw Error('Unexpected client query '+query.slice(0,100));
   }};
  }
 };
 const controller=createVKPayments({
  pool,sessionUser:async()=>({id:accountId}),
  rollSecurePack:()=>Array.from({length:5},(_,i)=>({model:'character-female-a.glb',count:i+1})),
  createRouter:()=>({get(path,handler){routes['GET '+path]=handler},post(path,handler){routes['POST '+path]=handler}})
 });
 async function call(type,fields={}) {
  const req={body:sign({notification_type:type,...fields})};
  let result;
  const res={json(data){result=data;return this},status(){return this}};
  await routes['POST /'](req,res);
  return result;
 }
 async function intent() {
  let result;
  const res={json(data){result=data;return this},status(){return this}};
  await routes['POST /intent']({body:{}},res);
  return result;
 }
 return {controller,call,intent,routes,sql,intents,paid,get grants(){return grants},get questPremium(){return questPremium},get connections(){return connectionCount}};
}
test('catalog calls mirror Cat Fighting: item 1, fixed price, 3600s expiration',async()=>{
 const h=harness();
 await h.controller.initialize();
 const response=await h.call('get_item_test');
 assert.equal(response.response.item_id,'1');
 assert.equal(response.response.title,'ECHO — элитный пак');
 assert.equal(response.response.price,40);
 assert.equal(response.response.expiration,3600);
 assert.match(response.response.photo_url,/specialcardpic\.webp$/);
 assert.ok(h.sql.some(q=>q.includes('ALTER COLUMN intent_id DROP NOT NULL')));
 assert.equal(h.connections,0,'catalog lookup must not depend on a pending attempt');
});
test('both real and test catalog requests reject unknown SKUs',async()=>{
 const h=harness();
 assert.equal((await h.call('get_item',{item:'2'})).error.error_code,20);
 assert.equal((await h.call('get_item_test',{item:'echo_premium_pack_old'})).error.error_code,20);
 assert.equal(h.connections,0);
});
test('intent for card animation never changes the VK catalog item ID',async()=>{
 const h=harness();
 const i=await h.intent();
 assert.equal(i.item,'1');
 assert.equal(i.price,40);
 assert.match(i.intentId,/^[a-f0-9]{32}$/);
});
test('chargeable order awards five cards, returns stable order ID, and ignores retries',async()=>{
 const h=harness();
 const i=await h.intent();
 const fields={order_id:'9876',status:'chargeable',item_price:'40',item_id:'1'};
 const first=await h.call('order_status_change_test',fields);
 assert.deepEqual(first,{response:{order_id:9876,app_order_id:42}});
 assert.equal(h.grants,5);
 assert.equal(h.intents.get(i.intentId).status,'paid');
 const duplicate=await h.call('order_status_change_test',fields);
 assert.deepEqual(duplicate,first);
 assert.equal(h.grants,5);
 assert.equal(h.questPremium,1,'VK retry cannot count premium mission twice');
 assert.equal(h.paid.size,1);
});
test('valid signed charges grant rewards even if browser never created an intent',async()=>{
 const h=harness();
 const result=await h.call('order_status_change',{status:'chargeable',order_id:'8888',item_price:'40.00'});
 assert.equal(result.response.app_order_id,42);
 assert.equal(h.grants,5);
 assert.equal(h.questPremium,1);
});
test('invalid signature, product, price or status never give rewards',async()=>{
 const h=harness();
 const bads=[
  {status:'chargeable',order_id:'1',item_price:'41'},
  {status:'chargeable',order_id:'1',item_price:'40',item_id:'3'},
  {status:'chargeable',order_id:'1',item_price:'40',item:'2'},
  {status:'chargeable',order_id:'1'},
  {status:'reserved',order_id:'1',item_price:'40'}
 ];
 for(const b of bads)assert.ok((await h.call('order_status_change_test',b)).error);
 const forged=sign();
 forged.user_id='54321';
 assert.equal(verifyNotification(forged),false);
 assert.equal(h.grants,0);
 assert.equal(h.questPremium,0);
});
test('VK order test and live order IDs are separate and refund acknowledges without a grant',async()=>{
 const h=harness();
 assert.equal((await h.call('order_status_change_test',{order_id:'300',item_price:'40',status:'chargeable'})).response.order_id,300);
 assert.equal((await h.call('order_status_change',{order_id:'300',item_price:'40',status:'chargeable'})).response.order_id,300);
 assert.equal(h.grants,10);
 assert.equal(h.questPremium,2);
 assert.equal((await h.call('order_status_change_test',{order_id:'300',status:'refunded'})).response.order_id,300);
 assert.equal(h.grants,10);
 assert.equal(h.questPremium,2);
 assert.equal(h.paid.get('300:true').status,'refunded');
 assert.equal(h.paid.get('300:false').status,undefined,'live charge remains paid');
});
test('VK callback signature checks correct app ID and secret',()=>{
 const x=sign();
 assert.equal(verifyNotification(x),true);
 assert.equal(verifyNotification(x,'54671077',process.env.VK_MINI_APP_SECRET),false);
 assert.equal(verifyNotification(x,'54838920','fake-secret'),false);
 assert.equal(verifyNotification({...x,price:1}),false);
});
test('item_id in callback is optional but signed price and item are mandatory',()=>{
 for(const item_price of ['40','40.0','40.00',40])
  assert.equal(checkVKOrderProduct({item:'1',item_price}).ok,true);
 for(const fields of [
  {item:'1',item_price:'39'},
  {item:'1',item_price:'41'},
  {item:'2',item_price:'40'},
  {item:'1'},
  {item:'1',item_price:'40',item_id:'2'}
 ])assert.equal(checkVKOrderProduct(fields).ok,false);
});

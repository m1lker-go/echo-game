'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.VK_MINI_APP_ID='54838920';
process.env.VK_MINI_APP_SECRET='this-is-a-fake-protected-test-key';
const {createVKPayments}=require('../vk-payments');
const {createRobokassaPayments,signatureForResult,toInvoice,AD_FREE_PRODUCT}=require('../robokassa-payments');
const ACCOUNT='123e4567-e89b-42d3-a456-426614174000';
function router(){
 const routes={get:{},post:{}};
 return {routes,get(k,fn){routes.get[k]=fn},post(k,fn){routes.post[k]=fn}};
}
function res(){
 return {code:200,data:null,status(n){this.code=n;return this},
   set(){return this},type(){return this},
   json(v){this.data=v;return this},send(v){this.data=v;return this}};
}
test('Robokassa ad-free invoice grants receipt once only for exact 490 RUB signed ResultURL',async()=>{
 const r=router(),invoice=toInvoice(1);
 const row={account_id:ACCOUNT,status:'pending',amount:'490.00',is_test:false,product:'ad_free'};
 let grants=0,cards=0;
 const query=async(sql,args=[])=>{
  if(sql.startsWith('INSERT INTO echo_robokassa_orders'))return {rows:[{id:1}],rowCount:1};
  if(sql.startsWith('SELECT account_id,status'))return {rows:[{...row}],rowCount:1};
  if(sql.startsWith('UPDATE echo_robokassa_orders')){row.status='paid';return {rows:[],rowCount:1}};
  return {rows:[],rowCount:0};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const config={merchant:'echo-demo',password1:'demo-password-one',password2:'demo-password-two',enabled:true,test:false};
 const payment=createRobokassaPayments({
   pool,sessionUser:async()=>({id:ACCOUNT}),rollSecurePack:()=>{cards++;return []},
   adFree:{has:async()=>false,grant:async()=>{grants++}},
   getConfig:()=>config,createRouter:()=>r});
 await payment.initialize();
 const created=res();
 await r.routes.post['/create-ad-free']({},created);
 assert.equal(created.data.price,'490.00');
 assert.equal(new URL(created.data.checkoutUrl).searchParams.get('Shp_type'),AD_FREE_PRODUCT);
 const callback=(sum='490.00')=>({body:{
  OutSum:sum,InvId:invoice,Shp_type:AD_FREE_PRODUCT,
  SignatureValue:signatureForResult(sum,invoice,config.password2,AD_FREE_PRODUCT)
 }});
 const invalid=res();
 await r.routes.post['/result'](callback('489.00'),invalid);
 assert.equal(invalid.code,400);
 const first=res();
 await r.routes.post['/result'](callback(),first);
 assert.equal(first.data,'OK'+invoice);
 const retry=res();
 await r.routes.post['/result'](callback(),retry);
 assert.equal(retry.data,'OK'+invoice);
 assert.equal(grants,1);
 assert.equal(cards,0,'a no-ads purchase must never grant a premium pack');
});
test('VK ad-free SKU 2 requires signed 100-vote charge, does not grant pack and accepts refund',async()=>{
 const r=router();let grants=0,refunds=0,packs=0,paid=false;
 const query=async(sql,args=[])=>{
  if(sql.startsWith('UPDATE echo_vk_payments p'))return {rowCount:paid?1:0,rows:paid?[{app_order_id:1,product:'ad_free'}]:[]};
  return {rowCount:0,rows:[]};
 };
 const client={async query(sql,args=[]){
  if(sql.startsWith('SELECT id::text AS id'))return {rowCount:1,rows:[{id:ACCOUNT}]};
  if(sql.startsWith('SELECT app_order_id,account_id FROM echo_vk_payments'))return {rowCount:paid?1:0,rows:paid?[{app_order_id:1,account_id:ACCOUNT}]:[]};
  if(sql.startsWith('SELECT id FROM echo_vk_payment_intents'))return {rowCount:0,rows:[]};
  if(sql.startsWith('INSERT INTO echo_vk_payments')){paid=true;return {rowCount:1,rows:[{app_order_id:1}]}};
  if(sql.startsWith('INSERT INTO echo_hero_collection')){packs++;return {rowCount:1,rows:[]}};
  return {rowCount:0,rows:[]};
 },release(){}};
 const payment=createVKPayments({
   pool:{query,connect:async()=>client},
   sessionUser:async()=>({id:ACCOUNT}),
   rollSecurePack:()=>{packs++;return []},
   adFree:{has:async()=>false,grant:async()=>{grants++},refund:async()=>{refunds++}},
   createRouter:()=>r});
 await payment.initialize();
 const signed=fields=>{
  const b={notification_type:'order_status_change',app_id:'54838920',user_id:'12345',
   item:'2',order_id:'40001',status:'chargeable',item_id:'2',item_price:'100',...fields};
  const payload=Object.keys(b).sort().map(k=>k+'='+b[k]).join('');
  return {...b,sig:crypto.createHash('md5').update(payload+process.env.VK_MINI_APP_SECRET).digest('hex')};
 };
 const wrong=res();
 await r.routes.post['/']({body:signed({item_price:'40'})},wrong);
 assert.equal(wrong.data.error.error_code,20);
 const first=res();await r.routes.post['/']({body:signed({})},first);
 assert.equal(first.data.response.order_id,40001);
 const again=res();await r.routes.post['/']({body:signed({})},again);
 assert.equal(again.data.response.app_order_id,1);
 assert.equal(grants,1);
 assert.equal(packs,0);
 const refund=res();
 await r.routes.post['/']({body:signed({status:'refunded'})},refund);
 assert.equal(refunds,1);
});

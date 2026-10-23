'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createRobokassaPayments, toCents, signatureForCheckout,
  signatureForResult, secureSameSignature, PRICE_RUB
}=require('../robokassa-payments');

const creds={
  merchant:'echo-demo',password1:'test-pay-password-one',
  password2:'test-pay-password-two',test:true,enabled:true
};
function fakeRouter(){
  const routes={get:new Map(),post:new Map()};
  return {routes,get:(p,h)=>routes.get.set(p,h),post:(p,h)=>routes.post.set(p,h)};
}
function response(){
  return {
    statusCode:200, data:null, headers:{},
    status(n){this.statusCode=n;return this;},
    set(k,v){this.headers[k]=v;return this;},
    type(x){this.contentType=x;return this;},
    json(v){this.data=v;return this;},
    send(v){this.data=v;return this;}
  };
}
function harness(){
  const router=fakeRouter(),events=[];
  const row={account_id:'b54828c7-946d-4c25-b1b9-67d171abd001',
    status:'pending',amount:PRICE_RUB,is_test:true,product:'premium_pack'};
  const fakeQuery=async(sql,args=[])=>{
    events.push({sql,args});
    if(sql.startsWith('INSERT INTO echo_robokassa_orders'))return {rows:[{id:'1'}],rowCount:1};
    if(sql.startsWith('SELECT account_id,status'))return {rows:[{...row}],rowCount:1};
    if(sql.startsWith('SELECT status,cards'))return {rows:[{status:row.status,cards:row.cards}],rowCount:1};
    if(sql.startsWith('UPDATE echo_robokassa_orders')){
      row.status='paid';row.cards=JSON.parse(args[1]);return {rowCount:1};
    }
    return {rows:[],rowCount:0};
  };
  const pool={query:fakeQuery,connect:async()=>({
    query:fakeQuery,release(){}
  })};
  const rollSecurePack=()=>Array.from({length:5},(_,i)=>({
    model:'character-zombie.glb',rarity:'epic',count:i+1
  }));
  const handlers=createRobokassaPayments({
    pool,sessionUser:async req=>req.user||null,rollSecurePack,
    createRouter:()=>router,getConfig:()=>creds
  });
  const user={id:row.account_id};
  const result=(outSum='250.000000', signature=signatureForResult(outSum,'1',creds.password2))=>({
    body:{InvId:'1',OutSum:outSum,SignatureValue:signature}
  });
  return {router,events,row,handlers,user,result};
}
test('robokassa amount accepts six-decimal real-world form and rejects fractions',()=>{
  assert.equal(toCents('250.000000'),25000);
  assert.equal(toCents('250.00'),25000);
  assert.equal(toCents('250'),25000);
  assert.equal(toCents('249.999999'),null);
  assert.equal(toCents('250.000001'),null);
  assert.equal(toCents('-250'),null);
});
test('checkout signature is not accepted as callback signature',()=>{
  const checkout=signatureForCheckout(creds.merchant,'250.00','1',creds.password1);
  const result=signatureForResult('250.00','1',creds.password2);
  assert.equal(secureSameSignature(result,checkout),false);
  assert.equal(secureSameSignature(result,result.toLowerCase()),true);
});
test('Robokassa creates orders only for signed-in ECHO users at server-owned price',async()=>{
  const h=harness();await h.handlers.initialize();
  const create=h.router.routes.post.get('/create');
  const unauthorized=response();await create({},unauthorized);
  assert.equal(unauthorized.statusCode,401);
  const valid=response();await create({user:h.user,body:{amount:'1',cards:999}},valid);
  assert.equal(valid.data.price,'250.00');
  assert.equal(new URL(valid.data.checkoutUrl).hostname,'auth.robokassa.ru');
  const inserted=h.events.find(e=>e.sql.startsWith('INSERT INTO echo_robokassa_orders'));
  assert.equal(inserted.args[1],'250.00');
  assert.equal(inserted.args[2],true);
});
test('bad callback signature cannot grant reward',async()=>{
  const h=harness();await h.handlers.initialize();
  const cb=h.router.routes.post.get('/result'),res=response();
  await cb(h.result('250.00','00000000000000000000000000000000'),res);
  assert.equal(res.statusCode,400);
  assert.equal(h.events.filter(e=>e.sql.includes('echo_hero_collection')).length,0);
});
test('verified ResultURL grants exactly once even when callback is retried',async()=>{
  const h=harness();await h.handlers.initialize();
  const cb=h.router.routes.post.get('/result');
  const first=response();await cb(h.result(),first);
  assert.equal(first.data,'OK1');
  assert.equal(h.row.status,'paid');
  assert.equal(h.events.filter(e=>e.sql.includes('echo_hero_collection')).length,5);
  const again=response();await cb(h.result(),again);
  assert.equal(again.data,'OK1');
  assert.equal(h.events.filter(e=>e.sql.includes('echo_hero_collection')).length,5);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPurchaseHistory,recordPackOpening}=require('../purchase-history');
const USER='123e4567-e89b-42d3-a456-426614174000';
const OTHER='123e4567-e89b-42d3-a456-426614174001';
function harness(loggedIn=true,rows=[]) {
 const routes={}; const calls=[];
 const pool={query:async (sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('CREATE '))return {rowCount:0,rows:[]};
  return {rowCount:rows.length,rows};
 }};
 const api=createPurchaseHistory({
  pool,
  sessionUser:async()=>loggedIn?{id:USER}:null,
  createRouter:()=>({get:(url,cb)=>{routes[url]=cb;}})
 });
 const list=async(query={})=>{
  let result,status=200,cache;
  const res={
   set(k,v){if(k==='Cache-Control')cache=v;return this},
   status(n){status=n;return this},
   json(v){result=v;return this}
  };
  await routes['/']({query},res);
  return {result,status,cache};
 };
 return {api,pool,calls,list};
}
test('purchase history schema retains each coin/free opening and index',async()=>{
 const h=harness();
 await h.api.initialize();
 assert.match(h.calls[0].sql,/echo_pack_openings/);
 assert.match(h.calls[0].sql,/account_id UUID NOT NULL/);
 assert.match(h.calls[0].sql,/cards JSONB NOT NULL/);
 assert.match(h.calls[1].sql,/CREATE INDEX IF NOT EXISTS/);
});
test('no authentication means no payment history, regardless of requested account',async()=>{
 const h=harness(false);
 const res=await h.list({accountId:OTHER,limit:'20'});
 assert.equal(res.status,401);
 assert.equal(res.cache,'no-store');
 assert.equal(h.calls.length,0);
});
test('every historical VK/Robokassa payment belongs to the signed-in account',async()=>{
 const h=harness(true,[{
  provider:'vk',order_id:'876',pack_type:'premium',amount:'40',
  currency:'VK_VOTES',status:'refunded',is_test:false,
  created_at:'2026-10-24T00:00:00Z',completed_at:'2026-10-24T00:00:00Z',
  card_models:5
 }]);
 const res=await h.list({accountId:OTHER,limit:'20',offset:'0'});
 assert.equal(res.status,200);
 assert.equal(res.result.purchases[0].status,'refunded');
 assert.equal(res.result.purchases[0].amount,'40');
 assert.equal(res.result.purchases[0].orderId,'876');
 assert.equal(res.result.purchases[0].testMode,false);
 assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0].args,[USER,21,0]);
 const sql=h.calls[0].sql;
 assert.match(sql,/echo_vk_payments/);
 assert.match(sql,/echo_robokassa_orders/);
 assert.match(sql,/echo_pack_openings/);
 assert.equal((sql.match(/account_id=\$1/g)||[]).length,3);
 assert.ok(!sql.includes(OTHER));
});
test('pagination is bounded and no arbitrary SQL input accepted',async()=>{
 const h=harness(true,[]);
 const bad=[{limit:'0'},{limit:'51'},{offset:'-1'}, {offset:'0;DROP TABLE'}, {limit:'2 OR 1=1'}];
 for(const q of bad)assert.equal((await h.list(q)).status,400);
 assert.equal(h.calls.length,0);
 assert.equal((await h.list({limit:'50',offset:'120'})).status,200);
 assert.deepEqual(h.calls[0].args,[USER,51,120]);
});
test('pack ledger entries accept only fixed coin/free prices and 5 server cards',async()=>{
 const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args})}};
 const cards=Array.from({length:5},(_,i)=>({model:'character-female-a.glb',count:i+1}));
 await recordPackOpening(db,USER,'coin','coin',cards);
 await recordPackOpening(db,USER,'free','premium',cards);
 assert.equal(calls[0].args[3],50);
 assert.equal(calls[0].args[4],'ECHO_COIN');
 assert.equal(calls[1].args[3],0);
 assert.equal(calls[1].args[4],'FREE');
 assert.match(calls[0].sql,/VALUES\(\$1,\$2,\$3,\$4,\$5,\$6::jsonb\)/);
 await assert.rejects(recordPackOpening(db,USER,'robokassa','premium',cards),TypeError);
 await assert.rejects(recordPackOpening(db,USER,'coin','coin',cards.slice(0,3)),TypeError);
 assert.equal(calls.length,2);
});

test('shop has a single working purchase history entrypoint with localized labels',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const client=path.join(__dirname,'../../client');
 const html=fs.readFileSync(path.join(client,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(client,'purchase-history.js'),'utf8');
 const css=fs.readFileSync(path.join(client,'shop.css'),'utf8');
 assert.match(html,/id="echo-purchase-history"/);
 assert.match(html,/purchase-history\.js/);
 assert.match(js,/\/echo\/api\/purchases\?limit=20&offset=/);
 assert.match(js,/Authorization: 'Bearer ' \+ token/);
 assert.match(js,/ECHOModal\?\.open/);
 assert.match(js,/fiscal receipt/);
 assert.match(css,/\.echo-history-record/);
 for(const language of ['ru','en']){
  const data=JSON.parse(fs.readFileSync(path.join(client,'locales',language+'.json'),'utf8'));
  for(const key of ['purchase_title','purchase_status','purchase_number','purchase_refunded','purchase_disclaimer'])
   assert.equal(typeof data.menu[key],'string');
 }
});

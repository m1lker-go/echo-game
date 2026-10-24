'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createFreePacks}=require('../free-packs');
const account='123e4567-e89b-42d3-a456-426614174000';
const cards=type=>Array.from({length:5},(_,i)=>({
 model:'character-female-'+String.fromCharCode(97+i)+'.glb',
 rarity:'common',count:type==='premium'?3:1
}));
function harness(start={coin:0,premium:0},signedIn=true){
 const counts={...start},granted=[],history=[],sql=[],routes={},quests={coin:0,premium:0};
 let failGrant=false;
 const pool={
  async query(query,params=[]){
   sql.push(query);
   if(query.startsWith('CREATE TABLE'))return {rowCount:0,rows:[]};
   if(query.startsWith('SELECT pack_type,quantity'))
    return {rowCount:2,rows:Object.entries(counts).map(([pack_type,quantity])=>({pack_type,quantity}))};
   if(query.startsWith('INSERT INTO echo_free_packs')){
    counts[params[1]]+=params[2];
    return {rowCount:1,rows:[{quantity:counts[params[1]]}]};
   }
   throw Error('Unknown pool SQL: '+query.slice(0,80));
  },
  async connect(){
   let snapshot=null;
   return {release(){},async query(query,params=[]){
    sql.push(query);
    if(query==='BEGIN'){snapshot={counts:{...counts},quests:{...quests}};return {rowCount:0,rows:[]}};
    if(query==='ROLLBACK'){if(snapshot){Object.assign(counts,snapshot.counts);Object.assign(quests,snapshot.quests);}snapshot=null;return {rowCount:0,rows:[]}};
    if(query==='COMMIT'){snapshot=null;return {rowCount:0,rows:[]}};
    if(query.startsWith('UPDATE echo_free_packs')){
     const type=params[1];
     if(!counts[type])return {rowCount:0,rows:[]};
     counts[type]--;return {rowCount:1,rows:[{quantity:counts[type]}]};
    }
    if(query.startsWith('INSERT INTO echo_pack_openings')){history.push(params);return {rowCount:1,rows:[]};}
    if(query.startsWith('INSERT INTO echo_hero_collection')){
     if(failGrant)throw Error('Forced fragment failure');
     granted.push(params);return {rowCount:1,rows:[]};
    }
    if(query.startsWith('INSERT INTO echo_daily_activity(')){
     const type=query.includes('pack_coin_opened')?'coin':'premium';
     quests[type]++;return {rowCount:1,rows:[]};
    }
    throw Error('Unknown transaction SQL '+query.slice(0,90));
   }};
  }
 };
 const p=createFreePacks({
  pool,sessionUser:async()=>signedIn?{id:account}:null,
  rollSecurePack:cards,
  createRouter:()=>({get(url,fn){routes['GET '+url]=fn},post(url,fn){routes['POST '+url]=fn}})
 });
 async function request(method,url,body={}){
  let payload,statusCode=200;
  const res={status(code){statusCode=code;return this},json(value){payload=value;return this}};
  await routes[method+' '+url]({body},res);
  return {statusCode,payload};
 }
 return {p,request,counts,granted,history,sql,quests,fail:v=>{failGrant=v}};
}
test('server initializes account-bound free pack table with UUID and checks',async()=>{
 const h=harness();await h.p.initialize();
 assert.match(h.sql[0],/account_id UUID NOT NULL REFERENCES echo_accounts\(id\)/);
 assert.match(h.sql[0],/quantity>=0/);
 assert.deepEqual((await h.request('GET','/')).payload.packs,{coin:0,premium:0});
});
test('admin/quest grants accumulate separately for coin and premium types',async()=>{
 const h=harness();
 assert.equal(await h.p.grant(account,'coin',2),2);
 assert.equal(await h.p.grant(account,'coin',3),5);
 assert.equal(await h.p.grant(account,'premium',1),1);
 assert.deepEqual((await h.request('GET','/')).payload.packs,{coin:5,premium:1});
 await assert.rejects(h.p.grant(account,'unknown',1),RangeError);
 await assert.rejects(h.p.grant(account,'coin',0),RangeError);
});
test('opening free coin pack uses one quantity and grants five cards without wallet charges',async()=>{
 const h=harness({coin:1,premium:2});
 const opened=await h.request('POST','/open',{packType:'coin'});
 assert.equal(opened.statusCode,200);
 assert.equal(opened.payload.remaining,0);
 assert.equal(opened.payload.cards.length,5);
 assert.deepEqual(h.counts,{coin:0,premium:2});
 assert.equal(h.granted.length,5);
 assert.deepEqual(h.quests,{coin:1,premium:0});
 assert.equal(h.history.length,1,'Each free pack must leave one purchase-history record');
 assert.equal(h.history[0][1],'free');
 assert.equal(h.history[0][2],'coin');
 assert.ok(h.sql.some(q=>q.includes('quantity=quantity-1')));
 assert.ok(!h.sql.some(q=>q.includes('echo_wallets')||q.includes('echo_vk_payments')));
 assert.equal((await h.request('POST','/open',{packType:'coin'})).statusCode,409);
 assert.equal(h.granted.length,5);
 assert.equal(h.quests.coin,1,'failed extra opening never credits a mission');
});
test('premium free pack gives fifteen fragments across five distinct characters',async()=>{
 const h=harness({coin:0,premium:1});
 const opened=await h.request('POST','/open',{packType:'premium'});
 assert.equal(opened.statusCode,200);
 assert.equal(opened.payload.remaining,0);
 assert.equal(opened.payload.cards.reduce((n,c)=>n+c.count,0),15);
 assert.equal(new Set(h.granted.map(x=>x[1])).size,5);
 assert.deepEqual(h.quests,{coin:0,premium:1});
 assert.equal(h.history.length,1);
 assert.equal(h.history[0][2],'premium');
});
test('failed fragment insertion rolls back the free inventory decrement',async()=>{
 const h=harness({coin:1,premium:0});h.fail(true);
 assert.equal((await h.request('POST','/open',{packType:'coin'})).statusCode,500);
 assert.equal(h.counts.coin,1);
 assert.deepEqual(h.quests,{coin:0,premium:0});
 assert.ok(h.sql.includes('ROLLBACK'));
});
test('guests and invalid pack type cannot claim free rewards',async()=>{
 const h=harness({coin:1,premium:1},false);
 assert.equal((await h.request('GET','/')).statusCode,401);
 assert.equal((await h.request('POST','/open',{packType:'coin'})).statusCode,401);
 assert.equal((await h.request('POST','/open',{packType:'custom'})).statusCode,400);
 assert.equal(h.granted.length,0);
 assert.deepEqual(h.counts,{coin:1,premium:1});
});
test('free badges and price fallback exist for both packs',()=>{
 const client=path.join(__dirname,'../../client');
 const html=fs.readFileSync(path.join(client,'index.html'),'utf8');
 const css=fs.readFileSync(path.join(client,'shop.css'),'utf8');
 const pack=fs.readFileSync(path.join(client,'pack-animation.js'),'utf8');
 for(const type of ['coin','premium']){
  assert.ok(html.includes('data-echo-free-badge="'+type+'"'));
  assert.ok(html.includes('data-echo-preview-pack="'+type+'"'));
 }
 assert.ok(html.includes('data-echo-paid-price'));
 assert.ok(html.includes('data-echo-free-label'));
 assert.match(css,/\.echo-shop-free-badge/);
 assert.match(pack,/refreshFreePackCounts\(\)/);
 assert.ok(pack.includes('/echo/api/packs/free/open'));
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const original=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='express')return {Router(){
  const routes={};
  return {routes,get(p,fn){routes['GET '+p]=fn},post(p,fn){routes['POST '+p]=fn}};
 }};
 return original.call(this,request,parent,isMain);
};
let exchange;
try{exchange=require('../hero-exchange');}
finally{Module._load=original;}
const {createHeroExchange,summarizeExcess,PRICES}=exchange;
const RARITIES={
 'starter.glb':'common','owned-common.glb':'common','owned-uncommon.glb':'uncommon',
 'owned-rare.glb':'rare','owned-epic.glb':'epic','owned-legendary.glb':'legendary',
 'locked.glb':'rare','character-female-b.glb':'common'
};
const user='123e4567-e89b-42d3-a456-426614174000';

function harness(initial=[]){
 const fragments=new Map(initial.map(row=>[row.model,{...row}]));
 const wallet=new Map(),sql=[],commits=[];
 let failWallet=false;
 const copy=()=>new Map([...fragments].map(([k,v])=>[k,{...v}]));
 const db={
  async query(q,args=[]){
   sql.push(q);
   if(q.startsWith('SELECT model,fragments,claimed FROM echo_hero_collection'))
    return {rows:[...fragments.values()].map(x=>({...x})),rowCount:fragments.size};
   if(q.startsWith('UPDATE echo_hero_collection SET fragments=')){
    fragments.get(args[1]).fragments=args[2];return {rowCount:1,rows:[]};
   }
   if(q.startsWith('INSERT INTO echo_wallets')){
    if(failWallet)throw Error('Simulated wallet failure');
    wallet.set(args[0],(wallet.get(args[0])||0)+args[1]);
    return {rows:[{coins:wallet.get(args[0])}],rowCount:1};
   }
   throw Error('Unexpected SQL '+q);
  },
  async connect(){
   let snapshot;
   return {release(){},async query(q,a){
    if(q==='BEGIN'){snapshot={fragments:copy(),wallet:new Map(wallet)};commits.push(q);return {rows:[],rowCount:0};}
    if(q==='COMMIT'){snapshot=null;commits.push(q);return {rows:[],rowCount:0};}
    if(q==='ROLLBACK'){if(snapshot){
      fragments.clear();for(const [k,v] of snapshot.fragments)fragments.set(k,v);
      wallet.clear();for(const [k,v] of snapshot.wallet)wallet.set(k,v);
     }snapshot=null;commits.push(q);return {rows:[],rowCount:0};}
    return db.query(q,a);
   }}
  }
 };
 const router=createHeroExchange({pool:db,heroRarities:RARITIES,
  sessionUser:async req=>req.authorized?{id:user}:null,
  createRouter:()=>({routes:{},get(p,fn){this.routes['GET '+p]=fn;},post(p,fn){this.routes['POST '+p]=fn;}})
 }).router;
 async function request(method,p,authorized=true){
  let status=200,payload;
  const res={status(code){status=code;return this},set(){return this},json(v){payload=v;return this}};
  await router.routes[method+' '+p]({authorized},res);
  return {status,payload};
 }
 return {request,fragments,wallet,sql,commits,failWallet:v=>{failWallet=v}};
}

test('Hero exchange rates match ECHO economy',()=>{
 assert.deepEqual(PRICES,{common:2,uncommon:3,rare:5,epic:7,legendary:10});
});
test('claimed heroes retain the assembly requirement; starters exchange all drops',()=>{
 const rows=[
  {model:'owned-common.glb',fragments:30,claimed:true},
  {model:'owned-uncommon.glb',fragments:32,claimed:true},
  {model:'owned-rare.glb',fragments:43,claimed:true},
  {model:'owned-epic.glb',fragments:55,claimed:true},
  {model:'owned-legendary.glb',fragments:61,claimed:true},
  {model:'locked.glb',fragments:300,claimed:false},
  {model:'character-female-b.glb',fragments:0,claimed:false}
 ];
 const s=summarizeExcess(rows,RARITIES);
 assert.deepEqual(s.counts,{common:5,uncommon:2,rare:3,epic:5,legendary:1});
 assert.equal(s.totalCards,16);
 assert.equal(s.totalCoins,76);
 assert.ok(!s.changes.some(x=>x.model==='locked.glb'));
 const starter=summarizeExcess([{model:'character-female-b.glb',fragments:4,claimed:false}],RARITIES);
 assert.equal(starter.counts.common,4);
 assert.equal(starter.totalCoins,8);
});
test('only logged in players receive a quote and can exchange',async()=>{
 const h=harness([{model:'owned-common.glb',fragments:30,claimed:true}]);
 assert.equal((await h.request('GET','/excess',false)).status,401);
 assert.equal((await h.request('POST','/exchange',false)).status,401);
 assert.equal(h.wallet.size,0);
});
test('exchange is atomic and cannot pay twice for the same cards',async()=>{
 const h=harness([
  {model:'owned-common.glb',fragments:30,claimed:true},
  {model:'owned-uncommon.glb',fragments:32,claimed:true},
  {model:'owned-rare.glb',fragments:43,claimed:true},
  {model:'owned-epic.glb',fragments:55,claimed:true},
  {model:'owned-legendary.glb',fragments:61,claimed:true},
  {model:'locked.glb',fragments:300,claimed:false}
 ]);
 const p=await h.request('GET','/excess');
 assert.equal(p.payload.totalCoins,76);
 const x=await h.request('POST','/exchange');
 assert.equal(x.status,200);
 assert.equal(x.payload.coinsGranted,76);
 assert.equal(x.payload.balance,76);
 assert.equal(h.fragments.get('owned-common.glb').fragments,25);
 assert.equal(h.fragments.get('owned-legendary.glb').fragments,60);
 assert.equal(h.fragments.get('locked.glb').fragments,300);
 const second=await h.request('POST','/exchange');
 assert.equal(second.payload.exchanged,false);
 assert.equal(second.payload.coinsGranted,0);
 assert.equal(h.wallet.get(user),76);
 assert.equal((await h.request('GET','/excess')).payload.totalCards,0);
 assert.ok(h.sql.some(x=>x.includes('ORDER BY model FOR UPDATE')));
});
test('a failed wallet credit rolls back fragment removal',async()=>{
 const h=harness([{model:'owned-common.glb',fragments:30,claimed:true}]);
 h.failWallet(true);
 const failed=await h.request('POST','/exchange');
 assert.equal(failed.status,500);
 assert.equal(h.fragments.get('owned-common.glb').fragments,30);
 assert.equal(h.wallet.size,0);
 assert.ok(h.commits.includes('ROLLBACK'));
 h.failWallet(false);
 assert.equal((await h.request('POST','/exchange')).payload.coinsGranted,10);
});
test('Web exchange uses ECHO modal and displays counts, coin icon and refresh events',()=>{
 const root=path.join(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const js=read('client/hero-exchange.js'),menu=read('client/menu.js'),index=read('client/index.html');
 assert.match(menu,/void offerExcessCards\(\)/);
 assert.match(menu,/import \{ offerExcessCards, invalidateOffer \}/);
 assert.match(js,/ECHOModal\?\.open/);
 assert.match(js,/assets\/icons\/coin\.webp/);
 assert.match(js,/echo:shop-balance-refresh/);
 assert.match(js,/echo:hero-collection-refresh/);
 assert.match(js,/Не сейчас/);
 assert.match(js,/Exchange preview HTTP/);
 assert.match(index,/hero-exchange\.css\?v=1/);
 for(const lang of ['ru','en']){
  const dict=JSON.parse(read('client/locales/'+lang+'.json'));
  assert.ok(dict.menu.excess_title);
  assert.ok(dict.menu.excess_received);
 }
});

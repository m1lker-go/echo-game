'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPromoCodes,PromoError,validatePromo,normalizeCode}=require('../promo-codes');
const {parseArguments}=require('../scripts/create-promo');
const A='aaaa0000-0000-4000-8000-000000000001';
const B='bbbb0000-0000-4000-8000-000000000002';
const C='cccc0000-0000-4000-8000-000000000003';
function harness({type='premium_pack',amount=1,limit=2,expiresAt=null,active=true}={}){
 const code='GIFT2026';
 const records=new Map([[code,{code,reward_type:type,reward_amount:amount,max_activations:limit,activations:0,expires_at:expiresAt,active}]]);
 const claims=new Set(),wallets=new Map(),packs=new Map(),queries=[];
 let grantError=false;
 const db={
  async query(q){if(q.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};throw Error('Unexpected pool query '+q)},
  async connect(){
   let snapshot=null;
   return {release(){},async query(sql,args=[]){
    queries.push({sql,args});
    if(sql==='BEGIN'){snapshot={claims:new Set(claims),wallets:new Map(wallets),packs:new Map(packs),activations:records.get(code).activations};return {rows:[],rowCount:0};}
    if(sql==='COMMIT'){snapshot=null;return {rows:[],rowCount:0};}
    if(sql==='ROLLBACK'){
     if(snapshot){
      claims.clear();for(const x of snapshot.claims)claims.add(x);
      wallets.clear();for(const [k,v] of snapshot.wallets)wallets.set(k,v);
      packs.clear();for(const [k,v] of snapshot.packs)packs.set(k,v);
      records.get(code).activations=snapshot.activations;
     }
     snapshot=null;return {rows:[],rowCount:0};
    }
    if(sql.startsWith('SELECT code,reward_type,reward_amount')){
     const row=records.get(args[0]);return {rows:row?[{...row}]:[],rowCount:row?1:0};
    }
    if(sql.startsWith('SELECT 1 FROM echo_promo_redemptions')){
     const yes=claims.has(args.join(':'));return {rows:yes?[{one:1}]:[],rowCount:yes?1:0};
    }
    if(sql.startsWith('INSERT INTO echo_wallets')){
     wallets.set(args[0],(wallets.get(args[0])||0)+Number(args[1]));return {rows:[],rowCount:1};
    }
    if(sql.startsWith('INSERT INTO echo_promo_redemptions')){claims.add(args.join(':'));return {rows:[],rowCount:1};}
    if(sql.startsWith('UPDATE echo_promo_codes SET activations=')){records.get(args[0]).activations++;return {rows:[],rowCount:1};}
    throw Error('Unexpected SQL '+sql);
   }};
  }
 };
 const promo=createPromoCodes({
  pool:db,
  grantPack:async(account,packType,quantity,client)=>{
   assert.ok(client);
   if(grantError)throw Error('Test grant failure');
   assert.ok(['coin','premium'].includes(packType));
   packs.set(account,(packs.get(account)||0)+quantity);
  },
  now:()=>new Date('2026-11-01T00:00:00Z')
 });
 return {promo,records,claims,wallets,packs,queries,breakGrant:()=>grantError=true,code};
}
async function errorIs(promise,code,status){await assert.rejects(promise,e=>e instanceof PromoError&&e.code===code&&e.status===status);}
test('Promo schema holds unique per-account claims, caps and reward types',async()=>{
 const h=harness();
 await h.promo.initialize();
 assert.match(fs.readFileSync(path.join(__dirname,'../promo-codes.js'),'utf8'),/PRIMARY KEY \(code, account_id\)/);
 assert.match(fs.readFileSync(path.join(__dirname,'../promo-codes.js'),'utf8'),/FOR UPDATE/);
 assert.equal(normalizeCode('  gift2026  '),'GIFT2026');
});
test('The same player gets exactly one premium pack and an already activated error',async()=>{
 const h=harness();
 const first=await h.promo.redeem(A,'gift2026');
 assert.deepEqual(first,{success:true,type:'promo',reward:{type:'premium_pack',quantity:1}});
 assert.equal(h.packs.get(A),1);
 await errorIs(h.promo.redeem(A,'GIFT2026'),'PROMO_ALREADY_CLAIMED',409);
 assert.equal(h.packs.get(A),1);
 assert.equal(h.records.get(h.code).activations,1);
});
test('Global limit counts distinct players and previously claimed code stays reported as claimed',async()=>{
 const h=harness({limit:1});
 await h.promo.redeem(A,h.code);
 await errorIs(h.promo.redeem(B,h.code),'PROMO_EXHAUSTED',409);
 await errorIs(h.promo.redeem(A,h.code),'PROMO_ALREADY_CLAIMED',409);
 assert.equal(h.packs.get(B),undefined);
});
test('Expired, disabled, and missing codes never grant rewards',async()=>{
 const expired=harness({expiresAt:new Date('2026-10-01T00:00:00Z')});
 await errorIs(expired.promo.redeem(A,expired.code),'PROMO_EXPIRED',410);
 const inactive=harness({active:false});
 await errorIs(inactive.promo.redeem(A,inactive.code),'PROMO_INACTIVE',410);
 const missing=harness();
 await errorIs(missing.promo.redeem(A,'NOPE2026'),'PROMO_NOT_FOUND',404);
 assert.equal(expired.packs.size+inactive.packs.size+missing.packs.size,0);
});
test('Coins go to ECHO wallet and basic packs to existing free inventory',async()=>{
 const coins=harness({type:'coins',amount:250,limit:4});
 assert.deepEqual((await coins.promo.redeem(A,coins.code)).reward,{type:'coins',quantity:250});
 assert.equal(coins.wallets.get(A),250);
 const basic=harness({type:'basic_pack',amount:2});
 await basic.promo.redeem(B,basic.code);
 assert.equal(basic.packs.get(B),2);
});
test('Grant failure rolls back claimed row and slot count, allowing safe retry',async()=>{
 const h=harness();
 h.breakGrant();
 await assert.rejects(()=>h.promo.redeem(A,h.code),/Test grant failure/);
 assert.equal(h.claims.size,0);assert.equal(h.packs.size,0);
 assert.equal(h.records.get(h.code).activations,0);
 assert.ok(h.queries.some(x=>x.sql==='ROLLBACK'));
});
test('CLI validates expiry and limits; no public endpoint creates codes',()=>{
 assert.equal(parseArguments(['--code','gift2027','--type','premium_pack','--amount','1','--limit','100']).code,'GIFT2027');
 assert.equal(parseArguments(['--code','coin2027','--type','coins','--amount','100','--expires','2030-01-01T00:00:00Z']).quantity,100);
 assert.throws(()=>parseArguments(['--code','nolimit','--type','coins','--amount','5']),/at least/);
 assert.throws(()=>parseArguments(['--code','REF-BADCODE','--type','coins','--amount','5','--limit','2']),/reserved/);
 assert.throws(()=>parseArguments(['--code','PAST2026','--type','coins','--amount','5','--expires','2020-01-01T00:00:00Z']),/future/);
 assert.throws(()=>validatePromo({code:'SAFE2026',type:'premium_pack',quantity:0,limit:1}),/quantity/);
 assert.throws(()=>validatePromo({code:'SAFE2026',type:'coins',quantity:1,limit:0}),/limit/);
 const cli=fs.readFileSync(path.join(__dirname,'../scripts/create-promo.js'),'utf8');
 assert.match(cli,/require\.main===module/);
 assert.match(cli,/INSERT INTO echo_promo_codes/);
});

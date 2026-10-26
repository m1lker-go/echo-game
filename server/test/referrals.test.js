'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createReferrals,generateCode,CODE_PATTERN,ReferralError}=require('../referrals');

const inviter='b7042f81-037a-4051-b983-7990e0cacabc';
const user=n=>'05b777a0-ac46-46cf-9d2a-'+String(n).padStart(12,'0');

function harness(){
 const codes=new Map(),referrals=new Map(),packs=new Map(),sql=[],transactions=[];
 let failGrants=false;
 function snapshot(){
  return {referrals:new Map([...referrals].map(([key,value])=>[key,{...value}])),packs:new Map(packs)};
 }
 function restore(s){
  referrals.clear();for(const [k,v] of s.referrals)referrals.set(k,v);
  packs.clear();for(const [k,v] of s.packs)packs.set(k,v);
 }
 async function execute(query,args=[]){
  sql.push(query);
  if(query.startsWith('CREATE '))return {rows:[],rowCount:0};
  if(query.startsWith('INSERT INTO echo_referral_codes')){
   if(!codes.has(args[0]))codes.set(args[0],args[1]);
   return {rows:[],rowCount:1};
  }
  if(query.startsWith('SELECT code FROM echo_referral_codes')){
   const code=codes.get(args[0]);
   return {rows:code?[{code}]:[],rowCount:code?1:0};
  }
  if(query.startsWith('SELECT COUNT(*)::int AS total')){
   const values=[...referrals.values()].filter(x=>x.inviter===args[0]);
   return {rows:[{total:values.length,pending:values.filter(x=>!x.claimed).length}],rowCount:1};
  }
  if(query.startsWith('SELECT account_id FROM echo_referral_codes')){
   const account=[...codes].find(([_,code])=>code===args[0])?.[0];
   return {rows:account?[{account_id:account}]:[],rowCount:account?1:0};
  }
  if(query.startsWith('INSERT INTO echo_referrals')){
   if(referrals.has(args[1]))return {rows:[],rowCount:0};
   referrals.set(args[1],{inviter:args[0],claimed:false});
   return {rows:[{invited_account_id:args[1]}],rowCount:1};
  }
  if(query.startsWith('UPDATE echo_referrals SET claimed_at=')){
   const rows=[];
   for(const [id,ref] of referrals){
    if(ref.inviter!==args[0]||ref.claimed)continue;
    ref.claimed=true;rows.push({invited_account_id:id});
   }
   return {rows,rowCount:rows.length};
  }
  throw new Error('Unexpected SQL '+query.slice(0,100));
 }
 const pool={
  query:execute,
  async connect(){
   let before=null;
   return {release(){},async query(q,a){
    if(q==='BEGIN'){before=snapshot();transactions.push('BEGIN');return {rowCount:0,rows:[]}}
    if(q==='COMMIT'){before=null;transactions.push('COMMIT');return {rowCount:0,rows:[]}}
    if(q==='ROLLBACK'){if(before)restore(before);before=null;transactions.push('ROLLBACK');return {rowCount:0,rows:[]}}
    return execute(q,a);
   }};
  }
 };
 const routes={};
 const referralsModule=createReferrals({
  pool,sessionUser:async req=>req.account?{id:req.account}:null,
  createRouter:()=>({get(p,fn){routes['GET '+p]=fn},post(p,fn){routes['POST '+p]=fn}}),
  grantPack:async(id,type,amount,db)=>{
   assert.equal(type,'coin');
   assert.ok(db&&typeof db.query==='function','grant is in a DB transaction');
   if(failGrants)throw new Error('Forced free-pack insert failure');
   packs.set(id,(packs.get(id)||0)+amount);
  }
 });
 async function call(method,endpoint,account){
  let payload,statusCode=200;
  const res={set(){return this},status(n){statusCode=n;return this},json(value){payload=value;return this}};
  await routes[method+' '+endpoint]({account},res);
  return {statusCode,payload};
 }
 return {p:referralsModule,call,codes,referrals,packs,sql,transactions,fail:v=>{failGrants=v}};
}

test('personal referral codes are random, stable, and stored per authorized account',async()=>{
 const values=Array.from({length:32},generateCode);
 assert.equal(new Set(values).size,values.length);
 for(const value of values)assert.match(value,CODE_PATTERN);
 const h=harness();
 await h.p.initialize();
 const code=(await h.call('GET','/',inviter)).payload.code;
 assert.match(code,CODE_PATTERN);
 assert.equal((await h.call('GET','/',inviter)).payload.code,code);
 assert.equal((await h.call('GET','/')).statusCode,401);
 assert.match(h.sql.join(' '),/invited_account_id UUID PRIMARY KEY/);
 assert.match(h.sql.join(' '),/CHECK \(inviter_account_id <> invited_account_id\)/);
 assert.match(h.sql.join(' '),/claimed_at IS NULL/);
});

test('friend receives exactly two basic packs, self-invites and second codes are blocked',async()=>{
 const h=harness();
 const code=(await h.call('GET','/',inviter)).payload.code;
 const other=(await h.call('GET','/',user(90))).payload.code;
 await assert.rejects(h.p.redeem(inviter,code),e=>e instanceof ReferralError&&e.status===409&&e.code==='REFERRAL_SELF');
 await assert.rejects(h.p.redeem(user(1),'REF-AAAAAAAAAAAA'),e=>e.status===404);
 const result=await h.p.redeem(user(1),code);
 assert.equal(result.success,true);
 assert.equal(result.type,'referral');
 assert.deepEqual(result.reward,{packType:'coin',quantity:2});
 assert.equal(h.packs.get(user(1)),2);
 await assert.rejects(h.p.redeem(user(1),code),e=>e.status===409);
 await assert.rejects(h.p.redeem(user(1),other),e=>e.status===409);
 assert.equal(h.packs.get(user(1)),2,'No repeated guest pack grants');
 assert.equal(h.packs.get(inviter),undefined,'Inviter cannot receive packs before claim');
});

test('ten accepted friends accumulate 20 packs, and claim pays out only once',async()=>{
 const h=harness();
 const code=(await h.call('GET','/',inviter)).payload.code;
 for(let i=1;i<=10;i++)await h.p.redeem(user(i),code);
 let state=(await h.call('GET','/',inviter)).payload;
 assert.deepEqual({total:state.totalFriends,pending:state.pendingFriends,packs:state.pendingPacks},
  {total:10,pending:10,packs:20});
 assert.equal(h.packs.get(inviter),undefined);
 let claim=await h.call('POST','/claim',inviter);
 assert.deepEqual(claim.payload,{claimedNow:true,claimedFriends:10,packsGranted:20});
 assert.equal(h.packs.get(inviter),20);
 claim=await h.call('POST','/claim',inviter);
 assert.deepEqual(claim.payload,{claimedNow:false,claimedFriends:0,packsGranted:0});
 assert.equal(h.packs.get(inviter),20);
 assert.equal((await h.call('GET','/',inviter)).payload.pendingFriends,0);
 await h.p.redeem(user(11),code);
 assert.equal((await h.call('POST','/claim',inviter)).payload.packsGranted,2);
 assert.equal(h.packs.get(inviter),22);
 assert.equal((await h.call('POST','/claim')).statusCode,401);
});

test('failed free pack grant rolls back both referral acceptance and claim state',async()=>{
 const h=harness();const code=(await h.call('GET','/',inviter)).payload.code;
 h.fail(true);
 await assert.rejects(h.p.redeem(user(1),code),/Forced free-pack/);
 assert.equal(h.referrals.size,0);
 assert.equal(h.packs.get(user(1)),undefined);
 h.fail(false);await h.p.redeem(user(1),code);
 h.fail(true);
 const failed=await h.call('POST','/claim',inviter);
 assert.equal(failed.statusCode,500);
 assert.equal(h.referrals.get(user(1)).claimed,false);
 assert.equal(h.packs.get(inviter),undefined);
 h.fail(false);
 assert.equal((await h.call('POST','/claim',inviter)).payload.packsGranted,2);
 assert.equal(h.packs.get(inviter),2);
 assert.ok(h.transactions.includes('ROLLBACK'));
});

test('client integrates referral quest into special tab and authenticated code modal',()=>{
 const root=path.join(__dirname,'../..');
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const html=read('client/index.html');
 const ui=read('client/referrals-ui.js');
 const codes=read('client/code-entry.js');
 const serverCodes=read('server/code-redemption.js');
 assert.match(html,/id="quests-referral"/);
 assert.match(html,/referrals-ui\.js\?v=2/);
 assert.match(ui,/\/echo\/api\/referrals\/claim/);
 assert.match(ui,/echo-special-card echo-referral-card/);
 assert.match(ui,/icon_echocard_basic\.webp/);
 assert.match(ui,/×'\+pending/);
 assert.match(ui,/echo:shop-balance-refresh/);
 assert.match(ui,/stats\.style\.whiteSpace='pre-line'/);
 assert.match(ui,/Наград собрано:/);
 assert.match(codes,/data\.type==='referral'/);
 assert.match(codes,/icon_echocard_basic\.webp/);
 assert.match(serverCodes,/REF_CODE\.test\(code\)/);
 assert.match(serverCodes,/referralRedeem\(user\.id,code\)/);
 for(const lang of ['ru','en']){
  const data=JSON.parse(read('client/locales/'+lang+'.json'));
  assert.ok(data.menu.referral_title);
  assert.ok(data.menu.referral_claim);
  assert.equal(data.menu.referral_pending,lang==='ru'?'Наград собрано:':'Rewards earned:');
 }
});

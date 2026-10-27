'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const crypto=require('node:crypto');

const A='a1000000-0000-4000-8000-000000000001';
const B='b1000000-0000-4000-8000-000000000002';
const C='c1000000-0000-4000-8000-000000000003';
const bearer='a'.repeat(64);
const identities=new Map();
const attempts=[];
let account=A, verifiedVK='242000001',vkResponseOk=true;
const router={get(){},post(path,handler){this[path]=handler},delete(){}};
const pool={
 async query(sql,args){
  if(sql.startsWith('SELECT a.id,a.nickname,w.coins FROM echo_auth_sessions')){
   return {rows:account?[{id:account,nickname:'KeepProgress',coins:123}]:[],rowCount:account?1:0};
  }
  throw Error('Unexpected pool SQL: '+sql);
 },
 async connect(){
  return {release(){},async query(sql,args=[]){
   attempts.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
   if(sql.includes("FROM echo_accounts WHERE id=$1 AND provider IN ('google','yandex')")){
    return {rows:account===C?[]:[{id:account}],rowCount:account===C?0:1};
   }
   if(sql.includes("FROM echo_auth_identities WHERE account_id=$1 AND provider='vkid'")){
    const entry=[...identities.entries()].find(([,owner])=>owner===args[0]);
    return {rows:entry?[{provider_id:entry[0]}]:[],rowCount:entry?1:0};
   }
   if(sql.includes("FROM echo_auth_identities WHERE provider='vkid' AND provider_id=$1")){
    const owner=identities.get(args[0]);
    return {rows:owner?[{account_id:owner}]:[],rowCount:owner?1:0};
   }
   if(sql.startsWith('INSERT INTO echo_auth_identities')){
    const [owner,uid]=args;
    if(identities.has(uid)){const e=Error('Conflict');e.code='23505';throw e;}
    identities.set(uid,owner);return {rows:[],rowCount:1};
   }
   throw Error('Unexpected tx SQL: '+sql);
  }};
 }
};
const originalLoad=Module._load;
const priorApp=process.env.VK_ID_APP_ID;
process.env.VK_ID_APP_ID='54832804';
try{
 Module._load=function(request,parent,isMain){
  if(request==='express'&&parent?.filename?.endsWith('/server/auth.js'))return {Router:()=>router};
  if(request==='./db'&&parent?.filename?.endsWith('/server/auth.js'))return {pool};
  if(request==='./oauth'&&parent?.filename?.endsWith('/server/auth.js'))return {hasCredentials:()=>false};
  if(request==='./account-deletion'&&parent?.filename?.endsWith('/server/auth.js'))return {deleteAccount:async()=>null};
  return originalLoad.call(this,request,parent,isMain);
 };
 require('../auth');
} finally {
 Module._load=originalLoad;
 if(priorApp===undefined)delete process.env.VK_ID_APP_ID;
 else process.env.VK_ID_APP_ID=priorApp;
}
async function post({token=bearer,accessToken='vk-access-token-just-for-unit-test'}={}){
 const response={
  statusCode:200,body:null,
  status(n){this.statusCode=n;return this},
  json(d){this.body=d;return this},
  set(){return this}
 };
 await router['/vk/link']({headers:{authorization:token?'Bearer '+token:''},body:{accessToken}},response);
 return response;
}
const oldFetch=global.fetch;
function mockVK(){
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://id.vk.com/oauth2/user_info?client_id=54832804');
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('access_token'),'vk-access-token-just-for-unit-test');
  return {ok:vkResponseOk,json:async()=>({user:{user_id:verifiedVK}})};
 };
}
test('Google/Yandex VK linking requires an authenticated ECHO session and a verified VK token',async()=>{
 mockVK();
 try{
  account=null;
  assert.equal((await post({token:null})).statusCode,401);
  account=A;vkResponseOk=false;
  assert.equal((await post()).statusCode,502);
  vkResponseOk=true;
  assert.equal(identities.size,0);
 }finally{global.fetch=oldFetch;}
});
test('Linking VK preserves ECHO account session and progress and is idempotent',async()=>{
 mockVK();
 try{
  account=A; verifiedVK='242000001';
  const first=await post();
  assert.equal(first.statusCode,200);
  assert.equal(first.body.linked,true);
  assert.equal(identities.get('242000001'),A);
  const second=await post();
  assert.equal(second.statusCode,200);
  assert.equal(identities.size,1);
  assert.ok(!attempts.some(x=>x.sql.includes('echo_accounts SET')||x.sql.includes('echo_wallets')));
  assert.equal((await post({token:null})).statusCode,401);
 }finally{global.fetch=oldFetch;}
});
test('A VK already owned by another ECHO profile never merges accounts',async()=>{
 mockVK();
 try{
  account=B;verifiedVK='242000001';
  const result=await post();
  assert.equal(result.statusCode,409);
  assert.equal(result.body.code,'vk_already_linked');
  assert.equal(identities.size,1);
 }finally{global.fetch=oldFetch;}
});
test('Accounts outside Google/Yandex cannot use the linking endpoint',async()=>{
 mockVK();
 try{
  account=C;verifiedVK='242000009';
  const result=await post();
  assert.equal(result.statusCode,403);
  assert.equal(result.body.code,'vk_link_not_allowed');
  assert.equal(identities.has('242000009'),false);
 }finally{global.fetch=oldFetch;}
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {resolveIdentity,hasCredentials} = require('../oauth');
function mockDb({existingId=null,linkFound=true,alreadyLinked=false}={}){
 const calls=[];
 const client={
  async query(sql,args=[]){
   calls.push({sql,args});
   if(sql.includes('FROM echo_auth_identities WHERE provider=$1'))return {
    rowCount:existingId?1:0,rows:existingId?[{account_id:existingId}]:[]
   };
   if(sql.includes('FROM echo_accounts WHERE id=$1 FOR UPDATE'))
    return {rowCount:linkFound?1:0,rows:linkFound?[{id:args[0]}]:[]};
   if(sql.includes('FROM echo_auth_identities WHERE account_id=$1'))
    return {rowCount:alreadyLinked?1:0,rows:alreadyLinked?[{provider_id:'old'}]:[]};
   return {rowCount:1,rows:[]};
  },
  release(){calls.push({sql:'RELEASE'})}
 };
 return {calls,db:{async connect(){return client}}};
}
test('Google creates its own ECHO account without merging by email',async()=>{
 const h=mockDb();
 const id=await resolveIdentity('google','sub-google-1',null,h.db);
 assert.match(id,/^[a-f0-9-]{36}$/);
 assert.ok(h.calls.some(x=>x.sql.includes('INSERT INTO echo_accounts')));
 assert.ok(h.calls.some(x=>x.sql.includes('INSERT INTO echo_auth_identities')));
 assert.ok(!h.calls.some(x=>/email|user_connections/.test(x.sql)));
 assert.ok(h.calls.some(x=>x.sql==='COMMIT'));
});
test('Yandex sign-in restores the existing game ID and progress',async()=>{
 const uuid='00000000-0000-4000-8000-000000000123';
 const h=mockDb({existingId:uuid});
 assert.equal(await resolveIdentity('yandex','provider-id',null,h.db),uuid);
 assert.ok(!h.calls.some(x=>x.sql.includes('INSERT INTO echo_accounts')));
});
test('an existing VK player explicitly links Yandex identity without a new account',async()=>{
 const uuid='00000000-0000-4000-8000-000000000123';
 const h=mockDb();
 assert.equal(await resolveIdentity('yandex','id',uuid,h.db),uuid);
 assert.ok(!h.calls.some(x=>x.sql.includes('INSERT INTO echo_accounts')));
 assert.ok(h.calls.some(x=>x.sql.includes('INSERT INTO echo_auth_identities')));
});
test('cannot steal identity already linked to another player',async()=>{
 const h=mockDb({existingId:'00000000-0000-4000-8000-000000000001'});
 await assert.rejects(
  resolveIdentity('google','sub','00000000-0000-4000-8000-000000000002',h.db),
  error=>error.status===409
 );
 assert.ok(h.calls.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!h.calls.some(x=>x.sql==='COMMIT'));
});
test('cannot relink another identity over an existing provider association',async()=>{
 const h=mockDb({alreadyLinked:true});
 await assert.rejects(
  resolveIdentity('google','sub','00000000-0000-4000-8000-000000000002',h.db),
  error=>error.status===409
 );
 assert.ok(h.calls.some(x=>x.sql==='ROLLBACK'));
});
test('OAuth is disabled until new ECHO-only credentials exist',()=>{
 const old={...process.env};
 try{
  delete process.env.ECHO_GOOGLE_CLIENT_ID;
  delete process.env.ECHO_GOOGLE_CLIENT_SECRET;
  delete process.env.ECHO_YANDEX_CLIENT_ID;
  delete process.env.ECHO_YANDEX_CLIENT_SECRET;
  assert.equal(hasCredentials('google'),false);
  assert.equal(hasCredentials('yandex'),false);
 }finally{
  for(const key of ['ECHO_GOOGLE_CLIENT_ID','ECHO_GOOGLE_CLIENT_SECRET','ECHO_YANDEX_CLIENT_ID','ECHO_YANDEX_CLIENT_SECRET']){
   if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
  }
 }
});
test('server never puts bearer session or provider access tokens in OAuth redirects',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../oauth.js'),'utf8');
 assert.match(src,/res\.json\(\{token:session,nickname:/);
 assert.match(src,/echogame:\/\/oauth\?ticket=/);
 assert.match(src,/crypto\.createHash\('sha256'\)\.update\(verifier\)/);
 assert.match(src,/linked_account_id UUID REFERENCES echo_accounts\(id\) ON DELETE CASCADE/);
 assert.match(src,/cookieOpts = \{httpOnly:true,secure:true,sameSite:'lax'/);
});

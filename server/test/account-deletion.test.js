'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {initialize,deleteAccount}=require('../account-deletion');

const ACCOUNT='00000000-1111-4222-8333-444444444444';
function harness({authorized=true,failOn}={}){
 const calls=[];
 const client={
  async query(sql,args=[]){
   calls.push({sql,args});
   if(failOn && sql.includes(failOn))throw Error('forced db failure');
   if(sql.includes('SELECT a.id FROM echo_auth_sessions')) {
    return authorized?{rowCount:1,rows:[{id:ACCOUNT}]}:{rowCount:0,rows:[]};
   }
   if(sql.includes('DELETE FROM echo_accounts WHERE'))return {rowCount:1,rows:[{id:ACCOUNT}]};
   return {rowCount:1,rows:[]};
  },
  release(){calls.push({sql:'RELEASE'})}
 };
 return {calls,pool:{async connect(){return client},async query(sql){calls.push({sql});return {}}}};
}

test('deletes ECHO profile with all progress, revoking sessions, but anonymizes receipts',async()=>{
 const h=harness();
 assert.equal(await deleteAccount(h.pool,'hashed-session'),ACCOUNT);
 const stmts=h.calls.map(c=>c.sql);
 assert.equal(stmts[0],'BEGIN');
 assert.ok(stmts[1].includes('s.token_hash=$1'));
 assert.deepEqual(h.calls[1].args,['hashed-session']);
 assert.ok(stmts.some(sql=>sql.includes('UPDATE echo_vk_payments SET account_id=NULL, intent_id=NULL')));
 assert.ok(stmts.some(sql=>sql.includes('UPDATE echo_robokassa_orders')&&sql.includes("THEN 'cancelled'")));
 for (const table of ['echo_pack_openings','echo_hero_collection','echo_wallets',
  'echo_daily_activity','echo_daily_quest_claims','echo_daily_video_bonus',
  'echo_round_account_awards','echo_round_scores','echo_coin_ledger'])
  assert.ok(stmts.some(sql=>sql.includes('DELETE FROM '+table+' ')),table);
 assert.deepEqual(h.calls.find(c=>c.sql.includes('DELETE FROM echo_coin_ledger')).args,
   ['account:'+ACCOUNT]);
 assert.ok(stmts.indexOf('COMMIT')>stmts.findIndex(sql=>sql.includes('DELETE FROM echo_accounts')));
 assert.equal(stmts.at(-1),'RELEASE');
});

test('invalid or expired session never deletes data',async()=>{
 const h=harness({authorized:false});
 assert.equal(await deleteAccount(h.pool,'wrong-hash'),null);
 assert.deepEqual(h.calls.map(x=>x.sql).slice(-2),['ROLLBACK','RELEASE']);
 assert.ok(!h.calls.some(x=>x.sql.includes('DELETE FROM')));
});

test('transaction rollback protects account and paid records on partial failure',async()=>{
 const h=harness({failOn:'DELETE FROM echo_hero_collection'});
 await assert.rejects(deleteAccount(h.pool,'hashed-session'),/forced db failure/);
 const stmts=h.calls.map(c=>c.sql);
 assert.ok(stmts.includes('ROLLBACK'));
 assert.ok(!stmts.includes('COMMIT'));
 assert.ok(!stmts.some(s=>s.includes('DELETE FROM echo_accounts WHERE')));
 assert.equal(stmts.at(-1),'RELEASE');
});

test('initialization drops NOT NULL only for anonymous payment ownership',async()=>{
 const h=harness();
 await initialize(h.pool);
 const queries=h.calls.map(x=>x.sql);
 assert.deepEqual(queries,[
  'ALTER TABLE echo_vk_payments ALTER COLUMN account_id DROP NOT NULL',
  'ALTER TABLE echo_robokassa_orders ALTER COLUMN account_id DROP NOT NULL'
 ]);
});

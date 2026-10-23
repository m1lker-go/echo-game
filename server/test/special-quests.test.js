'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// CI validates the source before npm install. Stub only Express's Router here.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return { Router() {
    const router = { stack: [] };
    for (const method of ['get', 'post']) router[method] = (path, handler) => {
      router.stack.push({ route: { path, methods: { [method]: true }, stack: [{ handle: handler }] } });
    };
    return router;
  } };
  return originalLoad.call(this, request, parent, isMain);
};
let specialModule;
try {
  specialModule = require('../special-quests');
} finally {
  Module._load = originalLoad;
}
const { createSpecialQuests, generateCode, CODE_PATTERN, CODE_LIFETIME_MS, partnerAuthorized } = specialModule;

const SHARED_SECRET = 'local-test-secret-must-be-at-least-thirty-two-characters-long';
const A = 'b7042f81-037a-4051-b983-7990e0cacabc';
const B = '05b777a0-ac46-46cf-9d2a-46a155d89aa6';

function harness(rewardCoins = 50) {
  const clock = { time: Date.parse('2026-10-23T12:00:00.000Z') };
  const records = new Map();
  const wallet = new Map();
  const database = {
    async query(sql, args = []) {
      const command = sql.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK|CREATE)/.test(command)) return { rows: [], rowCount: 0 };
      if (command.startsWith('SELECT * FROM echo_partner_quest_codes WHERE account_id=')) {
        const row = records.get(args[0]); return { rows: row ? [{...row}] : [], rowCount: row ? 1 : 0 };
      }
      if (command.startsWith('INSERT INTO echo_partner_quest_codes')) {
        if (!records.has(args[0])) records.set(args[0], {
          account_id: args[0], code: args[1], expires_at: args[2],
          redeemed_at: null, redeemed_by: null, claimed_at: null
        });
        return { rows: [], rowCount: 1 };
      }
      if (command.startsWith('UPDATE echo_partner_quest_codes SET code=')) {
        const row = records.get(args[0]);
        Object.assign(row, {code:args[1],created_at:args[2],expires_at:args[3]});
        return { rows: [{...row}], rowCount: 1 };
      }
      if (command.startsWith('SELECT * FROM echo_partner_quest_codes WHERE code=')) {
        const row = [...records.values()].find(r=>r.code===args[0]);
        return { rows: row ? [{...row}] : [], rowCount: row ? 1 : 0 };
      }
      if (command.startsWith('UPDATE echo_partner_quest_codes SET redeemed_by=')) {
        const row = records.get(args[0]);
        if ([...records.values()].some(r => r.account_id !== args[0] && r.redeemed_by === args[1])) {
          const e = new Error('unique'); e.code = '23505'; throw e;
        }
        row.redeemed_by = args[1];
        row.redeemed_at = new Date(clock.time);
        return {rows:[], rowCount:1};
      }
      if (command.startsWith('UPDATE echo_partner_quest_codes SET claimed_at=')) {
        records.get(args[0]).claimed_at = new Date(clock.time);
        return { rows: [], rowCount: 1 };
      }
      if (command.startsWith('INSERT INTO echo_wallets')) {
        wallet.set(args[0], (wallet.get(args[0]) || 0) + args[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error('Unexpected SQL: ' + command);
    },
    async connect() {
      return {query:(sql,args)=>database.query(sql,args),release(){}};
    }
  };
  const special = createSpecialQuests({
    pool: database, sessionUser: async req => req.account ? {id:req.account} : null,
    partnerSecret: SHARED_SECRET, rewardCoins, now:()=>new Date(clock.time)
  });
  async function call(method,path,{account,body={},secret}={}) {
    const layer = special.router.stack.find(l=>l.route?.path===path&&l.route.methods[method.toLowerCase()]);
    assert.ok(layer, 'Route exists: '+method+' '+path);
    const response = {
      statusCode: 200, payload: null, status(n){this.statusCode=n;return this},
      json(v){this.payload=v;return this}, set(){return this}
    };
    const request = {
      account,body,
      get(key){return key==='x-echo-partner-secret'?secret:undefined}
    };
    await layer.route.stack[0].handle(request,response);
    return response;
  }
  return {call,clock,records,wallet,initialize:special.initialize};
}

test('Personal codes are cryptographically generated and use the allowed alphabet',()=>{
  const values = Array.from({length:40},generateCode);
  assert.equal(new Set(values).size,40);
  for(const value of values)assert.match(value,CODE_PATTERN);
  assert.equal(CODE_LIFETIME_MS,1800000);
  assert.ok(partnerAuthorized(SHARED_SECRET,SHARED_SECRET));
  assert.ok(!partnerAuthorized('wrong',SHARED_SECRET));
  assert.ok(!partnerAuthorized(SHARED_SECRET,'short'));
});

test('Codes rotate after 30 minutes, without daily quest resets',async()=>{
  const h=harness();
  await h.initialize();
  const first = await h.call('GET','/',{account:A});
  assert.equal(first.statusCode,200);
  const code=first.payload.quest.code;
  const repeat=await h.call('GET','/',{account:A});
  assert.equal(repeat.payload.quest.code,code);
  const another=await h.call('GET','/',{account:B});
  assert.notEqual(another.payload.quest.code,code);
  h.clock.time+=CODE_LIFETIME_MS+1;
  const next=await h.call('GET','/',{account:A});
  assert.notEqual(next.payload.quest.code,code);
  assert.equal(next.payload.quest.claimed,false);
});

test('Only the trusted partner may confirm, once per Cat Fighting account',async()=>{
  const h=harness();
  const a=(await h.call('GET','/',{account:A})).payload.quest.code;
  const b=(await h.call('GET','/',{account:B})).payload.quest.code;
  assert.equal((await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:17}})).statusCode,403);
  const good=await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:17},secret:SHARED_SECRET});
  assert.equal(good.payload.verified,true);
  assert.equal((await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:17},secret:SHARED_SECRET})).payload.alreadyRedeemed,true);
  assert.equal((await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:18},secret:SHARED_SECRET})).statusCode,409);
  assert.equal((await h.call('POST','/partner/redeem',{body:{code:b,catFightUserId:17},secret:SHARED_SECRET})).statusCode,409);
});

test('Checking cannot pay twice and does not pay without partner verification',async()=>{
  const h=harness();
  const a=(await h.call('GET','/',{account:A})).payload.quest.code;
  assert.equal((await h.call('POST','/check',{account:A})).payload.status,'waiting');
  assert.equal(h.wallet.get(A),undefined);
  await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:31},secret:SHARED_SECRET});
  const paid=await h.call('POST','/check',{account:A});
  assert.equal(paid.payload.claimedNow,true);
  assert.equal(paid.payload.quest.claimed,true);
  assert.equal(h.wallet.get(A),50);
  const second=await h.call('POST','/check',{account:A});
  assert.equal(second.payload.claimedNow,false);
  assert.equal(h.wallet.get(A),50);
  assert.equal((await h.call('GET','/',{account:A})).payload.quest.code,null);
});

test('No reward is silently claimed before its value is configured',async()=>{
  const h=harness(0);
  const a=(await h.call('GET','/',{account:A})).payload.quest.code;
  await h.call('POST','/partner/redeem',{body:{code:a,catFightUserId:31},secret:SHARED_SECRET});
  const claim=await h.call('POST','/check',{account:A});
  assert.equal(claim.payload.status,'reward_unconfigured');
  assert.equal(claim.payload.quest.claimed,false);
  assert.equal(h.wallet.size,0);
});

test('Requests without verified ECHO login cannot issue or check a code',async()=>{
  const h=harness();
  assert.equal((await h.call('GET','/')).statusCode,401);
  assert.equal((await h.call('POST','/check')).statusCode,401);
});

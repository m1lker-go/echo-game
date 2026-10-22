'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {recordPackOpened,dailyPackDate,PACK_COLUMNS}=require('../pack-quest-progress');
const index=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');

test('pack openings use the same Moscow calendar day as daily quests',()=>{
 assert.equal(dailyPackDate(new Date('2026-10-22T20:59:59Z')),'2026-10-22');
 assert.equal(dailyPackDate(new Date('2026-10-22T21:00:00Z')),'2026-10-23');
});

test('a confirmed coin pack and a confirmed premium pack increment separate server counters',async()=>{
 const writes=[];
 const tx={query:async(sql,params)=>{writes.push({sql,params});return {rowCount:1,rows:[]}}};
 await recordPackOpened(tx,'a-uuid','coin',new Date('2026-10-22T12:00:00Z'));
 await recordPackOpened(tx,'a-uuid','premium',new Date('2026-10-22T12:00:00Z'));
 assert.equal(writes.length,2);
 assert.match(writes[0].sql,/INSERT INTO echo_daily_activity\(profile_id,activity_date,pack_coin_opened\)/);
 assert.match(writes[1].sql,/INSERT INTO echo_daily_activity\(profile_id,activity_date,pack_premium_opened\)/);
 assert.deepEqual(writes[0].params,['a-uuid','2026-10-22']);
 assert.deepEqual(writes[1].params,['a-uuid','2026-10-22']);
 assert.deepEqual(Object.keys(PACK_COLUMNS),['coin','premium']);
});

test('no arbitrary client-provided quest column can be written',async()=>{
 const writes=[];
 const tx={query:async(sql,params)=>writes.push([sql,params])};
 await assert.rejects(recordPackOpened(tx,'account','evil'),TypeError);
 await assert.rejects(recordPackOpened(tx,'','coin'),TypeError);
 assert.equal(writes.length,0);
});

test('both pack missions are unlocked and display the intended 5/50 coin rewards',()=>{
 assert.match(index,/id: 'pack_coin', column: 'pack_coin_opened', targets: \[1\], reward: 5/);
 assert.match(index,/id: 'pack_premium', column: 'pack_premium_opened', targets: \[1\], reward: 50/);
 assert.match(index,/const reward = quest\.reward \?\? QUEST_LEVEL_REWARDS\[levelIndex\]/);
 assert.match(index,/SELECT play_seconds, food_collected, pvp_wins, pack_coin_opened, pack_premium_opened FROM echo_daily_activity/);
 assert.match(index,/ALTER TABLE echo_daily_activity ADD COLUMN IF NOT EXISTS pack_coin_opened/);
 assert.match(index,/ADD COLUMN IF NOT EXISTS pack_premium_opened/);
});

test('paid coin pack writes its quest in the same transaction as card fragments',()=>{
 const start=index.indexOf("app.post('/api/packs/coin/open'");
 const end=index.indexOf('// Server-authoritative character collection',start);
 const route=index.slice(start,end);
 assert.ok(start>=0);
 const cards=route.indexOf('INSERT INTO echo_hero_collection');
 const mission=route.indexOf("await recordPackOpened(client,accountId,'coin')");
 const commit=route.indexOf("client.query('COMMIT')");
 assert.ok(cards>=0&&cards<mission&&mission<commit);
});

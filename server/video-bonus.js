'use strict';

// Five-step Moscow-day video quest, modeled after Cat Fighting's ad tasks.
// VK Bridge callbacks are client attestations, not cryptographic provider SSV.
// DB locking prevents duplicate coins; provider-side proof is a future hardening.
const crypto=require('node:crypto');
const REWARDS=Object.freeze([10,15,20,25,30]);
const PLACEMENT_ID=2096987;
function createVideoBonus({pool,sessionUser,dailyDateKey,createRouter=()=>require('express').Router(),now=()=>Date.now()}){
 const router=createRouter();
 async function initialize(){
  await pool.query([
   'CREATE TABLE IF NOT EXISTS echo_daily_video_bonus (',
   'profile_id TEXT NOT NULL, quest_date DATE NOT NULL,',
   'watched SMALLINT NOT NULL DEFAULT 0 CHECK(watched BETWEEN 0 AND 5),',
   'claimed SMALLINT NOT NULL DEFAULT 0 CHECK(claimed BETWEEN 0 AND 5),',
   'attempt_id UUID, started_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
   'PRIMARY KEY(profile_id,quest_date),',
   'CONSTRAINT echo_video_order_check CHECK(claimed<=watched AND watched<=claimed+1))'
  ].join(' '));
 }
 async function getQuest(accountId,date=dailyDateKey()){
  const r=await pool.query('SELECT watched,claimed FROM echo_daily_video_bonus WHERE profile_id=$1 AND quest_date=$2::date',[accountId,date]);
  const claimed=Math.min(5,Math.max(0,Number(r.rows[0]?.claimed||0)));
  const watched=Math.min(5,Math.max(claimed,Number(r.rows[0]?.watched||0)));
  const done=claimed>=5,level=done?5:claimed+1;
  return {id:'video',level,levels:5,target:1,progress:done||watched>claimed?1:0,
   reward:REWARDS[level-1],claimed:done,available:true,adWatched:!done&&watched>claimed};
 }
 async function account(req,res){
  const user=await sessionUser(req);
  if(!user){res.status(401).json({error:'Unauthorized'});return null;}
  return user.id;
 }
 async function lock(client,id,date){
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(id),date]);
  await client.query('INSERT INTO echo_daily_video_bonus(profile_id,quest_date) VALUES($1,$2::date) ON CONFLICT DO NOTHING',[id,date]);
  const r=await client.query('SELECT watched,claimed,attempt_id,started_at FROM echo_daily_video_bonus WHERE profile_id=$1 AND quest_date=$2::date FOR UPDATE',[id,date]);
  return r.rows[0];
 }
 const unavailable=res=>res.status(409).json({error:'Video bonus unavailable or already processed'});
 router.post('/start',async(req,res)=>{
  res.set('Cache-Control','no-store');
  let client;
  try{
   const id=await account(req,res);if(!id)return;
   const date=dailyDateKey();
   client=await pool.connect();await client.query('BEGIN');
   const row=await lock(client,id,date);
   if(Number(row.claimed)>=5||Number(row.watched)>Number(row.claimed)){
    await client.query('ROLLBACK');return unavailable(res);
   }
   const attemptId=crypto.randomUUID();
   await client.query('UPDATE echo_daily_video_bonus SET attempt_id=$3,started_at=NOW(),updated_at=NOW() WHERE profile_id=$1 AND quest_date=$2::date',[id,date,attemptId]);
   await client.query('COMMIT');
   return res.json({attemptId,date,level:Number(row.claimed)+1,placementId:PLACEMENT_ID});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('[video bonus] start failed',e.message);
   res.status(500).json({error:'Video unavailable'});
  }finally{client?.release();}
 });
 router.post('/complete',async(req,res)=>{
  res.set('Cache-Control','no-store');
  let client;
  try{
   const id=await account(req,res);if(!id)return;
   const attemptId=req.body?.attemptId;
   if(typeof attemptId!=='string'||!/^[a-f0-9-]{36}$/i.test(attemptId))
    return res.status(400).json({error:'Invalid attempt'});
   const date=dailyDateKey();
   client=await pool.connect();await client.query('BEGIN');
   const row=await lock(client,id,date);
   const elapsed=row.started_at?now()-new Date(row.started_at).getTime():-1;
   if(row.attempt_id!==attemptId||Number(row.claimed)>=5||
      Number(row.watched)!==Number(row.claimed)||elapsed<4000||elapsed>600000){
    await client.query('ROLLBACK');return unavailable(res);
   }
   // A VKWebAppShowNativeAds "result:true" is reported by the client here.
   // This is rate/uniqueness protected but not equivalent to provider-signed proof.
   await client.query('UPDATE echo_daily_video_bonus SET watched=claimed+1,attempt_id=NULL,started_at=NULL,updated_at=NOW() WHERE profile_id=$1 AND quest_date=$2::date',[id,date]);
   await client.query('COMMIT');
   return res.json({success:true,readyToClaim:true});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('[video bonus] complete failed',e.message);
   res.status(500).json({error:'Video unavailable'});
  }finally{client?.release();}
 });
 router.post('/claim',async(req,res)=>{
  res.set('Cache-Control','no-store');
  let client;
  try{
   const id=await account(req,res);if(!id)return;
   const date=dailyDateKey();
   client=await pool.connect();await client.query('BEGIN');
   const row=await lock(client,id,date);
   const index=Number(row.claimed);
   if(index>=5||Number(row.watched)!==index+1){
    await client.query('ROLLBACK');return unavailable(res);
   }
   const reward=REWARDS[index];
   await client.query('UPDATE echo_daily_video_bonus SET claimed=claimed+1,updated_at=NOW() WHERE profile_id=$1 AND quest_date=$2::date',[id,date]);
   await client.query('INSERT INTO echo_wallets(profile_id,coins) VALUES($1,$2) ON CONFLICT(profile_id) DO UPDATE SET coins=echo_wallets.coins+EXCLUDED.coins',[id,reward]);
   await client.query('COMMIT');
   return res.json({claimedNow:true,reward,level:index+1});
  }catch(e){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('[video bonus] claim failed',e.message);
   res.status(500).json({error:'Video reward unavailable'});
  }finally{client?.release();}
 });
 return {initialize,getQuest,router};
}
module.exports={createVideoBonus,REWARDS,PLACEMENT_ID};

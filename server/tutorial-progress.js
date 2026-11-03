'use strict';
// Account-bound training completion: server-only and exactly-once 3 free packs.
const crypto=require('node:crypto');
const ATTEMPT_MIN_SECONDS=20;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const tokenOk=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

function createTutorialProgress({pool,sessionUser,grantPack,createRouter=()=>require('express').Router()}){
 const router=createRouter();
 async function initialize(){
   await pool.query("CREATE TABLE IF NOT EXISTS echo_tutorial_progress (account_id UUID PRIMARY KEY REFERENCES echo_accounts(id) ON DELETE CASCADE, started_at TIMESTAMPTZ, attempt_hash TEXT, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 }
 router.get('/status',async(req,res)=>{
   try{
     const user=await sessionUser(req);
     if(!user)return res.status(401).json({error:'Unauthorized'});
     const result=await pool.query('SELECT completed_at IS NOT NULL AS completed FROM echo_tutorial_progress WHERE account_id=$1',[user.id]);
     res.set('Cache-Control','no-store');
     return res.json({completed:result.rows[0]?.completed===true});
   }catch(error){console.error('[tutorial] status failed',error.message);return res.status(500).json({error:'Tutorial unavailable'});}
 });
 router.post('/start',async(req,res)=>{
   try{
     const user=await sessionUser(req);
     if(!user)return res.status(401).json({error:'Unauthorized'});
     const attempt=crypto.randomBytes(32).toString('hex');
     const row=await pool.query("INSERT INTO echo_tutorial_progress(account_id,started_at,attempt_hash) VALUES($1,NOW(),$2) ON CONFLICT(account_id) DO UPDATE SET started_at=CASE WHEN echo_tutorial_progress.completed_at IS NULL THEN NOW() ELSE echo_tutorial_progress.started_at END, attempt_hash=CASE WHEN echo_tutorial_progress.completed_at IS NULL THEN EXCLUDED.attempt_hash ELSE echo_tutorial_progress.attempt_hash END,updated_at=NOW() RETURNING completed_at IS NOT NULL AS completed",[user.id,hash(attempt)]);
     res.set('Cache-Control','no-store');
     return res.json({completed:row.rows[0].completed===true,attempt:row.rows[0].completed===true?null:attempt});
   }catch(error){console.error('[tutorial] start failed',error.message);return res.status(500).json({error:'Tutorial unavailable'});}
 });
 router.post('/claim',async(req,res)=>{
   const attempt=req.body?.attempt;
   if(!tokenOk(attempt))return res.status(400).json({error:'Invalid tutorial attempt'});
   let db;
   try{
     const user=await sessionUser(req);
     if(!user)return res.status(401).json({error:'Unauthorized'});
     db=await pool.connect();
     await db.query('BEGIN');
     // Lock serializes claims across tabs/devices; grant and completion commit together.
     const row=await db.query("SELECT completed_at IS NOT NULL AS completed,attempt_hash,started_at,(started_at<=NOW()-INTERVAL '20 seconds') AS old_enough FROM echo_tutorial_progress WHERE account_id=$1 FOR UPDATE",[user.id]);
     const record=row.rows[0];
     if(!record){
       await db.query('ROLLBACK');
       return res.status(409).json({error:'TUTORIAL_NOT_STARTED'});
     }
     if(record.completed){
       await db.query('COMMIT');
       return res.json({completed:true,alreadyClaimed:true,rewarded:false});
     }
     if(record.attempt_hash!==hash(attempt)||record.old_enough!==true){
       await db.query('ROLLBACK');
       return res.status(409).json({error:'TUTORIAL_ATTEMPT_INVALID'});
     }
     await db.query('UPDATE echo_tutorial_progress SET completed_at=NOW(),attempt_hash=NULL,updated_at=NOW() WHERE account_id=$1',[user.id]);
     await grantPack(user.id,'coin',3,db);
     await db.query('COMMIT');
     res.set('Cache-Control','no-store');
     return res.json({completed:true,alreadyClaimed:false,rewarded:true,packs:3});
   }catch(error){
     if(db)await db.query('ROLLBACK').catch(()=>{});
     console.error('[tutorial] claim failed',error.message);
     return res.status(500).json({error:'Tutorial claim unavailable'});
   }finally{db?.release();}
 });
 return {router,initialize};
}
module.exports={createTutorialProgress,ATTEMPT_MIN_SECONDS};

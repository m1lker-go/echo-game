'use strict';
const {recordPackOpened}=require('./pack-quest-progress');
// Free ECHO packs are account-bound, independent of coins and VK payments.
const types=new Set(['coin','premium']);
function createFreePacks({pool,sessionUser,rollSecurePack,createRouter=()=>require('express').Router()}){
 const router=createRouter();
 async function initialize(){
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_free_packs (
   account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
   pack_type TEXT NOT NULL CHECK(pack_type IN ('coin','premium')),
   quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(account_id,pack_type)
  )`);
 }
 async function getCounts(accountId,db=pool){
  const r=await db.query('SELECT pack_type,quantity FROM echo_free_packs WHERE account_id=$1 AND quantity>0',[accountId]);
  const counts={coin:0,premium:0};
  for(const row of r.rows)if(types.has(row.pack_type))counts[row.pack_type]=Math.max(0,Number(row.quantity)||0);
  return counts;
 }
 // Reuse this to issue future quest rewards. Admins may also INSERT via psql.
 async function grant(accountId,packType,quantity=1,db=pool){
  if(!types.has(packType)||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)throw new RangeError('Invalid free-pack grant');
  const r=await db.query(`INSERT INTO echo_free_packs(account_id,pack_type,quantity) VALUES($1,$2,$3)
   ON CONFLICT(account_id,pack_type) DO UPDATE
   SET quantity=echo_free_packs.quantity+EXCLUDED.quantity,updated_at=NOW()
   RETURNING quantity`,[accountId,packType,quantity]);
  return Number(r.rows[0].quantity);
 }
 router.get('/',async(req,res)=>{
  try{
   const user=await sessionUser(req);
   if(!user)return res.status(401).json({error:'Unauthorized'});
   return res.json({packs:await getCounts(user.id)});
  }catch(error){console.error('[free-packs] list failed:',error.message);return res.status(500).json({error:'Free packs unavailable'});}
 });
 router.post('/open',async(req,res)=>{
  const packType=req.body?.packType;
  if(!types.has(packType))return res.status(400).json({error:'Unknown pack type'});
  let client;
  try{
   const user=await sessionUser(req);
   if(!user)return res.status(401).json({error:'Unauthorized'});
   client=await pool.connect();
   await client.query('BEGIN');
   // This conditional UPDATE is atomic across simultaneous browser/VK requests.
   const row=await client.query(`UPDATE echo_free_packs
    SET quantity=quantity-1,updated_at=NOW()
    WHERE account_id=$1 AND pack_type=$2 AND quantity>0 RETURNING quantity`,[user.id,packType]);
   if(!row.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'NO_FREE_PACKS'});}
   const cards=rollSecurePack(packType);
   if(!Array.isArray(cards)||cards.length!==5)throw new Error('Invalid free-pack roll');
   for(const card of cards)await client.query(`INSERT INTO echo_hero_collection(account_id,model,fragments)
    VALUES($1,$2,$3) ON CONFLICT(account_id,model)
    DO UPDATE SET fragments=echo_hero_collection.fragments+EXCLUDED.fragments`,
    [String(user.id),card.model,card.count]);
   await recordPackOpened(client,user.id,packType);
   await client.query('COMMIT');
   return res.json({packType,cards,remaining:Number(row.rows[0].quantity)});
  }catch(error){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   console.error('[free-packs] open failed:',error.message);
   return res.status(500).json({error:'Free pack opening failed'});
  }finally{client?.release();}
 });
 return {router,initialize,getCounts,grant};
}
module.exports={createFreePacks};

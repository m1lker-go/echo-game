'use strict';

// A permanent, account-bound entitlement. Only signed provider callbacks may
// insert receipts; browsers cannot activate it with a client-side flag.
function createAdFree({pool,sessionUser,createRouter=()=>require('express').Router()}){
 const router=createRouter();
 let ready=false;
 async function initialize(){
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_ad_free_receipts (
   account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
   provider TEXT NOT NULL CHECK(provider IN ('vk','robokassa')),
   provider_order_id TEXT NOT NULL,
   is_test BOOLEAN NOT NULL DEFAULT FALSE,
   granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   revoked_at TIMESTAMPTZ,
   UNIQUE(provider,provider_order_id,is_test)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS echo_ad_free_account_idx ON echo_ad_free_receipts(account_id) WHERE revoked_at IS NULL');
  ready=true;
 }
 async function has(conn,accountId){
  if(!ready||!accountId)return false;
  const r=await conn.query(`SELECT EXISTS (
   SELECT 1 FROM echo_ad_free_receipts WHERE account_id=$1
    AND revoked_at IS NULL AND (is_test=FALSE OR $2::boolean)
  ) AS active`,[accountId,process.env.ECHO_ALLOW_TEST_AD_FREE==='true']);
  return r.rows[0]?.active===true;
 }
 async function grant(conn,accountId,provider,orderId,isTest=false){
  // ON CONFLICT DO NOTHING ensures a refunded receipt cannot be resurrected by
  // a duplicate payment notification; the buyer can make a new order instead.
  await conn.query(`INSERT INTO echo_ad_free_receipts
   (account_id,provider,provider_order_id,is_test)
   VALUES($1,$2,$3,$4) ON CONFLICT(provider,provider_order_id,is_test) DO NOTHING`,
   [accountId,provider,String(orderId),Boolean(isTest)]);
 }
 async function refund(conn,provider,orderId,isTest=false){
  await conn.query(`UPDATE echo_ad_free_receipts SET revoked_at=COALESCE(revoked_at,NOW())
   WHERE provider=$1 AND provider_order_id=$2 AND is_test=$3`,
   [provider,String(orderId),Boolean(isTest)]);
 }
 router.get('/status',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const user=await sessionUser(req);
   if(!user)return res.status(401).json({error:'Unauthorized'});
   res.json({active:await has(pool,user.id),product:'ad_free_lifetime',priceRub:490,priceVotes:100});
  }catch(error){
   console.error('[echo ad-free] status failed:',error.message);
   res.status(503).json({error:'Subscription status unavailable'});
  }
 });
 return {router,initialize,has,grant,refund};
}
module.exports={createAdFree};

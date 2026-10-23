'use strict';
// Unified read-only financial history from the ORIGINAL VK/Robokassa order tables.
// Non-cash pack openings are recorded in a small transactional ledger.
const express=require('express');
const SOURCES=new Set(['coin','free']), PACKS=new Set(['coin','premium']);
async function recordPackOpening(db,accountId,source,packType,cards) {
  if(!db?.query || !accountId || !SOURCES.has(source) || !PACKS.has(packType) ||
     !Array.isArray(cards) || cards.length!==5)
    throw new TypeError('Invalid pack opening record');
  await db.query(
    "INSERT INTO echo_pack_openings(account_id,source,pack_type,amount,currency,cards) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [String(accountId),source,packType,source==='coin'?50:0,
     source==='coin'?'ECHO_COIN':'FREE',JSON.stringify(cards)]
  );
}
function createPurchaseHistory({pool,sessionUser,createRouter=()=>express.Router()}){
 const router=createRouter();
 async function initialize(){
  await pool.query("CREATE TABLE IF NOT EXISTS echo_pack_openings (id BIGSERIAL PRIMARY KEY, account_id UUID NOT NULL REFERENCES echo_accounts(id), source TEXT NOT NULL CHECK(source IN ('coin','free')), pack_type TEXT NOT NULL CHECK(pack_type IN ('coin','premium')), amount INTEGER NOT NULL CHECK(amount>=0), currency TEXT NOT NULL CHECK(currency IN ('ECHO_COIN','FREE')), cards JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query('CREATE INDEX IF NOT EXISTS echo_pack_openings_by_user ON echo_pack_openings (account_id,created_at DESC,id DESC)');
 }
 router.get('/',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const user=await sessionUser(req);
   if(!user)return res.status(401).json({error:'Unauthorized'});
   const rawLimit=String(req.query?.limit??'20');
   const rawOffset=String(req.query?.offset??'0');
   if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)||
      !/^(?:0|[1-9]\d{0,4})$/.test(rawOffset))
    return res.status(400).json({error:'Invalid pagination'});
   const limit=Number(rawLimit),offset=Number(rawOffset);
   const sql=[
    'SELECT provider,order_id,pack_type,amount,currency,status,is_test,',
    '  created_at,completed_at,card_models FROM (',
    " SELECT 'robokassa'::text AS provider, (r.id+2000000000)::text AS order_id,",
    " 'premium'::text AS pack_type,r.amount::text AS amount,",
    " 'RUB'::text AS currency,r.status::text AS status,",
    ' r.is_test,r.created_at,r.paid_at AS completed_at,',
    ' CASE WHEN r.cards IS NOT NULL THEN jsonb_array_length(r.cards) ELSE 0 END AS card_models',
    ' FROM echo_robokassa_orders r WHERE r.account_id=$1',
    ' UNION ALL',
    " SELECT 'vk'::text,v.order_id::text,'premium'::text,",
    " v.price::text,'VK_VOTES'::text,v.status::text,",
    ' v.is_test,v.created_at,v.created_at,jsonb_array_length(v.cards)',
    ' FROM echo_vk_payments v WHERE v.account_id=$1',
    ' UNION ALL',
    " SELECT o.source::text,('P-'||o.id::text)::text,o.pack_type::text,",
    " o.amount::text,o.currency::text,'paid'::text,",
    ' false,o.created_at,o.created_at,jsonb_array_length(o.cards)',
    ' FROM echo_pack_openings o WHERE o.account_id=$1',
    ' ) ledger ORDER BY created_at DESC,provider DESC,order_id DESC',
    ' LIMIT $2 OFFSET $3'
   ].join('\n');
   const r=await pool.query(sql,[user.id,limit+1,offset]);
   const hasMore=r.rows.length>limit;
   res.json({
     purchases:r.rows.slice(0,limit).map(row=>({
       provider:row.provider,orderId:row.order_id,
       packType:row.pack_type,amount:String(row.amount),currency:row.currency,
       status:row.status,testMode:Boolean(row.is_test),
       createdAt:row.created_at,completedAt:row.completed_at,
       cardModels:Number(row.card_models)||0
     })),
     hasMore,nextOffset:hasMore?offset+limit:null
   });
  }catch(error){
   console.error('[ECHO purchase history] list failed:',error.message);
   res.status(500).json({error:'Purchase history unavailable'});
  }
 });
 return {router,initialize};
}
module.exports={createPurchaseHistory,recordPackOpening};

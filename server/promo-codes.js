'use strict';

// ECHO promo codes are independent of referral and Cat Fighting partner codes.
// An account can redeem each distinct promo once. All grants/limits are atomic.
const CODE_PATTERN=/^[A-Z0-9][A-Z0-9_-]{3,31}$/;
const TYPES=new Set(['coins','basic_pack','premium_pack']);
const MAX_QUANTITY=1000000;

class PromoError extends Error {
 constructor(code,status){super(code);this.code=code;this.status=status;}
}

function normalizeCode(code){
 return typeof code==='string' ? code.trim().toUpperCase() : '';
}

function validatePromo({code,type,quantity,expiresAt=null,limit=null}){
 const name=normalizeCode(code);
 if(!CODE_PATTERN.test(name) || name.startsWith('CF-') || name.startsWith('REF-'))
  throw new TypeError('Invalid or reserved promo code');
 if(!TYPES.has(type))throw new TypeError('Unknown promo reward type');
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_QUANTITY)
  throw new RangeError('Invalid promo reward quantity');
 if(type!=='coins'&&quantity>1000)throw new RangeError('Pack promo quantity cannot exceed 1000');
 if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>100000000))
  throw new RangeError('Invalid promo activation limit');
 if(expiresAt!==null && !(expiresAt instanceof Date && Number.isFinite(expiresAt.valueOf())))
  throw new TypeError('Invalid promo expiration');
 return {code:name,type,quantity,expiresAt,limit};
}

function createPromoCodes({pool,grantPack,now=()=>new Date()}){
 if(!pool?.query||!pool?.connect||typeof grantPack!=='function')throw new TypeError('Promo code dependencies missing');
 async function initialize(){
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_promo_codes (
    code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{3,31}$'),
    reward_type TEXT NOT NULL CHECK (reward_type IN ('coins','basic_pack','premium_pack')),
    reward_amount INTEGER NOT NULL CHECK (reward_amount BETWEEN 1 AND 1000000),
    expires_at TIMESTAMPTZ,
    max_activations INTEGER CHECK (max_activations > 0),
    activations INTEGER NOT NULL DEFAULT 0 CHECK (activations >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (max_activations IS NULL OR activations <= max_activations)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_promo_redemptions (
    code TEXT NOT NULL REFERENCES echo_promo_codes(code) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code, account_id)
  )`);
 }
 async function redeem(accountId,rawCode){
  const code=normalizeCode(rawCode);
  if(!CODE_PATTERN.test(code))throw new PromoError('PROMO_INVALID',400);
  let tx;
  try{
   tx=await pool.connect();
   await tx.query('BEGIN');
   // Lock a single promo row to serialize all users competing for the last slot.
   const selected=await tx.query('SELECT code,reward_type,reward_amount,expires_at,max_activations,activations,active FROM echo_promo_codes WHERE code=$1 FOR UPDATE',[code]);
   const promo=selected.rows[0];
   if(!promo)throw new PromoError('PROMO_NOT_FOUND',404);
   // Report repeated redemption even if code later expired or its global limit was reached.
   const prior=await tx.query('SELECT 1 FROM echo_promo_redemptions WHERE code=$1 AND account_id=$2',[code,accountId]);
   if(prior.rowCount)throw new PromoError('PROMO_ALREADY_CLAIMED',409);
   if(!promo.active)throw new PromoError('PROMO_INACTIVE',410);
   if(promo.expires_at && new Date(promo.expires_at).valueOf()<=now().valueOf())
    throw new PromoError('PROMO_EXPIRED',410);
   if(promo.max_activations!==null && Number(promo.activations)>=Number(promo.max_activations))
    throw new PromoError('PROMO_EXHAUSTED',409);
   const quantity=Number(promo.reward_amount);
   const type=promo.reward_type;
   if(!TYPES.has(type)||!Number.isSafeInteger(quantity)||quantity<1||quantity>MAX_QUANTITY||
      (type!=='coins' && quantity>1000))throw new Error('Unsafe promo reward data');
   if(type==='coins'){
    await tx.query(`INSERT INTO echo_wallets(profile_id,coins) VALUES($1,$2)
      ON CONFLICT(profile_id) DO UPDATE SET coins=echo_wallets.coins+EXCLUDED.coins`,[String(accountId),quantity]);
   }else{
    await grantPack(accountId,type==='premium_pack'?'premium':'coin',quantity,tx);
   }
   await tx.query('INSERT INTO echo_promo_redemptions(code,account_id) VALUES($1,$2)',[code,accountId]);
   await tx.query('UPDATE echo_promo_codes SET activations=activations+1 WHERE code=$1',[code]);
   await tx.query('COMMIT');
   return {success:true,type:'promo',reward:{type,quantity}};
  }catch(error){
   if(tx)await tx.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{tx?.release();}
 }
 return {initialize,redeem};
}

module.exports={createPromoCodes,PromoError,CODE_PATTERN,normalizeCode,validatePromo};

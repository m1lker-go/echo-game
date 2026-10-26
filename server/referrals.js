'use strict';
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^REF-[A-HJ-NP-Z2-9]{12}$/;
const PACKS_PER_FRIEND = 2;

function generateCode() {
  let code = 'REF-';
  for (let i = 0; i < 12; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

class ReferralError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function createReferrals({pool, sessionUser, grantPack,
  createRouter = () => require('express').Router(), newCode = generateCode}) {
  if (typeof grantPack !== 'function') throw new TypeError('Free pack grant required');
  const router = createRouter();

  async function initialize() {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS echo_referral_codes (' +
      'account_id UUID PRIMARY KEY REFERENCES echo_accounts(id) ON DELETE CASCADE,' +
      'code TEXT NOT NULL UNIQUE,' +
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
    );
    await pool.query(
      'CREATE TABLE IF NOT EXISTS echo_referrals (' +
      'invited_account_id UUID PRIMARY KEY REFERENCES echo_accounts(id) ON DELETE CASCADE,' +
      'inviter_account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,' +
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),' +
      'claimed_at TIMESTAMPTZ,' +
      'CONSTRAINT echo_referral_no_self CHECK (inviter_account_id <> invited_account_id))'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS echo_referrals_unclaimed_idx ' +
      'ON echo_referrals(inviter_account_id) WHERE claimed_at IS NULL'
    );
  }

  async function ensureCode(accountId) {
    for (let i = 0; i < 5; i++) {
      try {
        await pool.query(
          'INSERT INTO echo_referral_codes(account_id,code) VALUES($1,$2) ' +
          'ON CONFLICT(account_id) DO NOTHING', [accountId,newCode()]
        );
        const result = await pool.query('SELECT code FROM echo_referral_codes WHERE account_id=$1', [accountId]);
        if (result.rows[0]?.code) return result.rows[0].code;
      } catch (error) {
        if (error.code !== '23505' || i === 4) throw error;
      }
    }
    throw new Error('Referral code unavailable');
  }

  async function state(accountId) {
    const code = await ensureCode(accountId);
    const result = await pool.query(
      'SELECT COUNT(*)::int AS total, ' +
      'COUNT(*) FILTER (WHERE claimed_at IS NULL)::int AS pending ' +
      'FROM echo_referrals WHERE inviter_account_id=$1', [accountId]
    );
    const totalFriends = Number(result.rows[0]?.total || 0);
    const pendingFriends = Number(result.rows[0]?.pending || 0);
    return {
      code, totalFriends, pendingFriends,
      pendingPacks: pendingFriends * PACKS_PER_FRIEND,
      packsPerFriend: PACKS_PER_FRIEND
    };
  }

  // Called ONLY after code-entry validated the ECHO auth session.
  // The UNIQUE(invited_account_id) constraint is the final anti-double-redeem guard.
  async function redeem(invitedAccountId, code) {
    if (!CODE_PATTERN.test(code)) throw new ReferralError(400,'REFERRAL_INVALID');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const match = await client.query(
        'SELECT account_id FROM echo_referral_codes WHERE code=$1', [code]
      );
      const inviterAccountId = match.rows[0]?.account_id;
      if (!inviterAccountId) throw new ReferralError(404,'REFERRAL_NOT_FOUND');
      if (String(inviterAccountId) === String(invitedAccountId))
        throw new ReferralError(409,'REFERRAL_SELF');
      const inserted = await client.query(
        'INSERT INTO echo_referrals(inviter_account_id,invited_account_id) VALUES($1,$2) ' +
        'ON CONFLICT(invited_account_id) DO NOTHING RETURNING invited_account_id',
        [inviterAccountId, invitedAccountId]
      );
      if (!inserted.rowCount) throw new ReferralError(409,'REFERRAL_ALREADY_USED');
      // The friend receives packs immediately. Grant and referral are one transaction.
      await grantPack(invitedAccountId,'coin',PACKS_PER_FRIEND,client);
      await client.query('COMMIT');
      return {success:true,type:'referral',reward:{packType:'coin',quantity:PACKS_PER_FRIEND}};
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  router.get('/',async(req,res)=>{
    try {
      const user=await sessionUser(req);
      if (!user) return res.status(401).json({error:'Unauthorized'});
      res.set('Cache-Control','no-store');
      return res.json(await state(user.id));
    } catch(error) {
      console.error('[referrals] state unavailable:',error.message);
      return res.status(500).json({error:'Referral quest unavailable'});
    }
  });

  router.post('/claim',async(req,res)=>{
    let client;
    try {
      const user=await sessionUser(req);
      if (!user) return res.status(401).json({error:'Unauthorized'});
      client=await pool.connect();
      await client.query('BEGIN');
      // UPDATE atomically locks only unclaimed referral rows. A second
      // simultaneous claim cannot pay for those rows a second time.
      const claimed=await client.query(
        'UPDATE echo_referrals SET claimed_at=NOW() ' +
        'WHERE inviter_account_id=$1 AND claimed_at IS NULL ' +
        'RETURNING invited_account_id', [user.id]
      );
      const friends=claimed.rowCount;
      if (friends) await grantPack(user.id,'coin',friends*PACKS_PER_FRIEND,client);
      await client.query('COMMIT');
      client.release(); client=null;
      res.set('Cache-Control','no-store');
      return res.json({claimedNow:friends>0,claimedFriends:friends,packsGranted:friends*PACKS_PER_FRIEND});
    } catch(error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[referrals] claim unavailable:',error.message);
      return res.status(500).json({error:'Referral claim unavailable'});
    } finally { client?.release(); }
  });

  return {router,initialize,redeem,state};
}

module.exports={createReferrals,generateCode,CODE_PATTERN,PACKS_PER_FRIEND,ReferralError};

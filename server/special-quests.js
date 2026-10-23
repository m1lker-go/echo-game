'use strict';

// ECHO-side source of truth for the one-time Cat Fighting partner mission.
// A code belongs to a verified ECHO account and rotates every 30 minutes
// until redeemed. The partner callback is server-to-server only.
const crypto = require('node:crypto');
const express = require('express');

const CODE_LIFETIME_MS = 30 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^ECHO-[A-HJ-NP-Z2-9]{12}$/;

function generateCode() {
  let value = 'ECHO-';
  for (let i = 0; i < 12; i++) value += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return value;
}

function partnerAuthorized(received, secret) {
  if (typeof received !== 'string' || typeof secret !== 'string' || secret.length < 32) return false;
  const a = Buffer.from(received), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSpecialQuests({ pool, sessionUser, grantPack, partnerSecret = process.env.ECHO_PARTNER_SHARED_SECRET || '',
  now = () => new Date() }) {
  if (typeof grantPack !== 'function') throw new TypeError('A free-pack grant function is required');
  const router = express.Router();
  // Reuse ECHO's existing special-edition premium pack inventory.
  const rewardPack = Object.freeze({ type: 'pack', packType: 'premium', quantity: 1 });

  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS echo_partner_quest_codes (
      account_id UUID PRIMARY KEY REFERENCES echo_accounts(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      redeemed_at TIMESTAMPTZ,
      redeemed_by TEXT,
      claimed_at TIMESTAMPTZ
    )`);
    // A Cat Fighting account cannot complete multiple ECHO accounts' partner missions.
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS echo_partner_quest_redeemer_unique ON echo_partner_quest_codes(redeemed_by) WHERE redeemed_by IS NOT NULL');
  }

  function state(row) {
    return {
      id: 'cat_fighting',
      game: 'Cat Fighting',
      gameUrl: 'https://cat-fight.ru/',
      code: row.claimed_at ? null : row.code,
      expiresAt: row.claimed_at || row.redeemed_at ? null : row.expires_at,
      verified: Boolean(row.redeemed_at),
      claimed: Boolean(row.claimed_at),
      reward: rewardPack,
      rewardConfigured: true,
    };
  }

  async function ensureCode(accountId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Per-account row lock prevents competing tabs generating different codes.
      let result = await client.query('SELECT * FROM echo_partner_quest_codes WHERE account_id=$1 FOR UPDATE', [accountId]);
      if (!result.rowCount) {
        await client.query(
          'INSERT INTO echo_partner_quest_codes(account_id,code,expires_at) VALUES($1,$2,$3) ON CONFLICT(account_id) DO NOTHING',
          [accountId, generateCode(), new Date(now().getTime() + CODE_LIFETIME_MS)]);
        result = await client.query('SELECT * FROM echo_partner_quest_codes WHERE account_id=$1 FOR UPDATE', [accountId]);
      }
      let row = result.rows[0];
      if (!row.claimed_at && !row.redeemed_at && new Date(row.expires_at).getTime() <= now().getTime()) {
        result = await client.query(
          'UPDATE echo_partner_quest_codes SET code=$2,created_at=$3,expires_at=$4 WHERE account_id=$1 RETURNING *',
          [accountId, generateCode(), now(), new Date(now().getTime() + CODE_LIFETIME_MS)]);
        row = result.rows[0];
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function authenticatedAccount(req, res) {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return user.id;
  }

  router.get('/', async (req, res) => {
    try {
      const accountId = await authenticatedAccount(req, res);
      if (!accountId) return;
      res.set('Cache-Control', 'no-store');
      res.json({ quest: state(await ensureCode(accountId)) });
    } catch (error) {
      console.error('[special-quests] load failed:', error.message);
      res.status(500).json({ error: 'Special quests unavailable' });
    }
  });

  router.post('/check', async (req, res) => {
    let client;
    try {
      const accountId = await authenticatedAccount(req, res);
      if (!accountId) return;
      client = await pool.connect();
      await client.query('BEGIN');
      const rows = await client.query('SELECT * FROM echo_partner_quest_codes WHERE account_id=$1 FOR UPDATE', [accountId]);
      const row = rows.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Open the special quest first' });
      }

      let claimedNow = false;
      if (row.redeemed_at && !row.claimed_at) {
        // Grant the pack and finalize the mission in ONE transaction.
        await grantPack(accountId, 'premium', 1, client);
        await client.query('UPDATE echo_partner_quest_codes SET claimed_at=NOW() WHERE account_id=$1', [accountId]);
        row.claimed_at = now();
        claimedNow = true;
      }
      await client.query('COMMIT');
      res.set('Cache-Control', 'no-store');
      res.json({ quest: state(row), claimedNow, reward: claimedNow ? rewardPack : null, status: row.claimed_at ? 'completed' : 'waiting' });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[special-quests] check failed:', error.message);
      res.status(500).json({ error: 'Special quest check unavailable' });
    } finally { client?.release(); }
  });

  // Called only from Cat Fighting's authenticated server with a long shared secret.
  // Cat Fighting must validate its own player JWT before passing catFightUserId.
  router.post('/partner/redeem', async (req, res) => {
    if (!partnerAuthorized(req.get('x-echo-partner-secret'), partnerSecret)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const userId = String(req.body?.catFightUserId ?? '');
    if (!CODE_PATTERN.test(code) || !/^[1-9]\d{0,19}$/.test(userId)) {
      return res.status(400).json({ error: 'Invalid partner claim' });
    }
    const redeemer = 'cat-fighting:' + userId;
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM echo_partner_quest_codes WHERE code=$1 FOR UPDATE', [code]);
      const row = result.rows[0];
      if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Code not found' }); }
      if (row.redeemed_by) {
        await client.query('ROLLBACK');
        return row.redeemed_by === redeemer
          ? res.json({ ok: true, verified: true, alreadyRedeemed: true })
          : res.status(409).json({ error: 'Code already used' });
      }
      if (new Date(row.expires_at).getTime() <= now().getTime()) {
        await client.query('ROLLBACK');
        return res.status(410).json({ error: 'Code expired' });
      }
      await client.query('UPDATE echo_partner_quest_codes SET redeemed_by=$2,redeemed_at=NOW() WHERE account_id=$1', [row.account_id, redeemer]);
      await client.query('COMMIT');
      res.json({ ok: true, verified: true, alreadyRedeemed: false });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return res.status(409).json({ error: 'Partner account already linked' });
      console.error('[special-quests] partner claim failed:', error.message);
      res.status(500).json({ error: 'Partner claim unavailable' });
    } finally { client?.release(); }
  });

  return { router, initialize };
}

module.exports = { createSpecialQuests, generateCode, partnerAuthorized, CODE_LIFETIME_MS, CODE_PATTERN };

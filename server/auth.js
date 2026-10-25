'use strict';
const crypto = require('node:crypto');
const express = require('express');
const router = express.Router();
const { pool } = require('./db');
const { validateNickname } = require('./nickname-policy');
const { verifyVKMiniAppLaunch } = require('./vk-launch');
const APP_ID = String(process.env.VK_ID_APP_ID || '');
const MINI_APP_ID = String(process.env.VK_MINI_APP_ID || '');
const MINI_APP_SECRET = process.env.VK_MINI_APP_SECRET || '';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const {deleteAccount} = require('./account-deletion');
const echoOAuth = require('./oauth');
let onAccountDeleted = () => {};
function setAccountDeletedHandler(handler) {
  onAccountDeleted = typeof handler === 'function' ? handler : () => {};
}
const getSession = req => (req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/)?.[1];
async function sessionUser(req) {
  const token = getSession(req);
  if (!token) return null;
  const result = await pool.query(
    'SELECT a.id,a.nickname,w.coins FROM echo_auth_sessions s JOIN echo_accounts a ON a.id=s.account_id LEFT JOIN echo_wallets w ON w.profile_id=a.id::text WHERE s.token_hash=$1 AND s.expires_at>NOW()',
    [hash(token)]
  );
  return result.rows[0] || null;
}
async function initialize() {
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_accounts (
    id UUID PRIMARY KEY, provider TEXT NOT NULL, provider_id TEXT NOT NULL,
    nickname TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_id)
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS echo_accounts_nickname_lower_unique ON echo_accounts (LOWER(nickname))');
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_auth_sessions (
    token_hash TEXT PRIMARY KEY, account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
}
// Both browser VK ID and VK Mini Apps resolve the same VK user to one ECHO account.
async function createVKAccountSession(uid) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id,nickname FROM echo_accounts WHERE provider=$1 AND provider_id=$2',
      ['vkid', String(uid)]
    );
    let account = existing.rows[0];
    if (!account) {
      const id = crypto.randomUUID();
      const nickname = 'Echo_' + id.replace(/-/g,'').slice(0,10);
      const created = await client.query(
        'INSERT INTO echo_accounts(id,provider,provider_id,nickname) VALUES($1,$2,$3,$4) ON CONFLICT(provider,provider_id) DO NOTHING RETURNING id,nickname',
        [id, 'vkid', String(uid), nickname]
      );
      // Simultaneous app opens must resolve to one existing VK account.
      account = created.rows[0] || (await client.query(
        'SELECT id,nickname FROM echo_accounts WHERE provider=$1 AND provider_id=$2',
        ['vkid', String(uid)]
      )).rows[0];
      if (!account) throw new Error('VK account lookup failed');
    }
    const session = crypto.randomBytes(32).toString('hex');
    await client.query(
      "INSERT INTO echo_auth_sessions(token_hash,account_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",
      [hash(session), account.id]
    );
    await client.query('COMMIT');
    return { token: session, nickname: account.nickname, accountId: account.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.get('/config', (_req, res) => res.json({
  enabled: /^\d+$/.test(APP_ID),
  appId: /^\d+$/.test(APP_ID) ? Number(APP_ID) : null,
  miniAppEnabled: /^\d+$/.test(MINI_APP_ID) && Boolean(MINI_APP_SECRET),
  miniAppId: /^\d+$/.test(MINI_APP_ID) ? Number(MINI_APP_ID) : null,
  googleEnabled: echoOAuth.hasCredentials('google'),
  yandexEnabled: echoOAuth.hasCredentials('yandex')
}));
router.post('/vk', async (req,res) => {
  const accessToken = req.body?.accessToken;
  if (!/^\d+$/.test(APP_ID) || typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096)
    return res.status(400).json({ error: 'Invalid VK ID request' });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    let data;
    try {
      const response = await fetch('https://id.vk.com/oauth2/user_info?client_id=' + encodeURIComponent(APP_ID), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accessToken }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('VK ID rejected token');
      data = await response.json();
    } finally { clearTimeout(timer); }
    const uid = data?.user?.user_id;
    if (!uid || !/^[a-zA-Z0-9_-]{1,120}$/.test(String(uid))) return res.status(401).json({ error: 'VK ID verification failed' });
    res.json(await createVKAccountSession(uid));
  } catch (error) {
    console.error('[auth] VK ID login failed:',error.message);
    res.status(502).json({error:'VK ID login failed'});
  }
});
// VK Mini App uses signed launch params, not the browser VK ID OAuth token.
router.post('/vk-launch', async (req, res) => {
  if (!/^\d+$/.test(MINI_APP_ID) || !MINI_APP_SECRET)
    return res.status(503).json({ error: 'ECHO VK Mini App is not configured' });
  if (!verifyVKMiniAppLaunch(req.body, MINI_APP_SECRET, MINI_APP_ID))
    return res.status(403).json({ error: 'Invalid VK Mini App launch signature' });
  try {
    res.json(await createVKAccountSession(req.body.vk_user_id));
  } catch (error) {
    console.error('[auth] VK Mini App login failed:', error.message);
    res.status(500).json({ error: 'VK Mini App login failed' });
  }
});

router.get('/me',async(req,res)=>{
  try { const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Unauthorized'});res.json({accountId:user.id,nickname:user.nickname,coins:Number(user.coins||0)}); }
  catch(error){console.error('[auth] me failed:',error.message);res.status(500).json({error:'Unavailable'});}
});
router.post('/nickname/validate',async(req,res)=>{
 try{
  const user=await sessionUser(req);
  if(!user)return res.status(401).json({error:'Unauthorized'});
  const validation=validateNickname(req.body?.nickname);
  if(!validation.ok)return res.status(400).json({error:'Invalid nickname',code:validation.reason});
  const existing=await pool.query('SELECT 1 FROM echo_accounts WHERE LOWER(nickname)=LOWER($1) AND id<>$2 LIMIT 1',[req.body.nickname,user.id]);
  if(existing.rows.length)return res.status(409).json({error:'Nickname already taken',code:'taken'});
  res.json({ok:true});
 }catch(error){console.error('[auth] nickname validation failed:',error.message);res.status(500).json({error:'Unavailable'});}
});
router.post('/nickname',async(req,res)=>{
  const validation=validateNickname(req.body?.nickname);
  if(!validation.ok)return res.status(400).json({error:validation.reason==='forbidden'?'Nickname contains prohibited words':'Invalid nickname',code:validation.reason});
  try {
    const user=await sessionUser(req);
    if(!user)return res.status(401).json({error:'Unauthorized'});
    const updated=await pool.query('UPDATE echo_accounts SET nickname=$1 WHERE id=$2 RETURNING nickname',[req.body.nickname,user.id]);
    res.json({nickname:updated.rows[0].nickname});
  } catch(error){
    if(error.code==='23505')return res.status(409).json({error:'Nickname already taken'});
    console.error('[auth] nickname failed:',error.message);res.status(500).json({error:'Unavailable'});
  }
});
// Explicit confirmation + valid ECHO bearer token are both required.
// Do not log raw tokens, account IDs or personally identifiable provider IDs.
router.delete('/account', async (req, res) => {
  const token = getSession(req);
  if (!token) return res.status(401).json({error:'Unauthorized'});
  if (req.body?.confirm !== 'DELETE')
    return res.status(400).json({error:'Account deletion requires confirmation'});
  try {
    const accountId = await deleteAccount(pool, hash(token));
    if (!accountId) return res.status(401).json({error:'Unauthorized'});
    try { onAccountDeleted(accountId); }
    catch (error) { console.error('[auth] deleted account session cleanup failed:',error.message); }
    res.set('Cache-Control','no-store');
    res.json({ok:true});
  } catch (error) {
    console.error('[auth] account deletion failed:',error.message);
    res.status(500).json({error:'Account deletion unavailable'});
  }
});

router.post('/logout',async(req,res)=>{
  const token=getSession(req);
  if(token)await pool.query('DELETE FROM echo_auth_sessions WHERE token_hash=$1',[hash(token)]).catch(error=>console.error('[auth] logout failed:',error.message));
  res.json({ok:true});
});
module.exports={router,initialize,sessionUser,setAccountDeletedHandler};

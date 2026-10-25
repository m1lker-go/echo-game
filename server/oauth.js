'use strict';

// ECHO-owned Google / Yandex authorization-code flow. No Cat Fighting
// accounts, client secrets, access tokens or provider PII are shared.
const express = require('express');
const crypto = require('node:crypto');
const {pool} = require('./db');

const ORIGIN = 'https://cat-fight.ru';
const BASE = ORIGIN + '/echo/api/auth/oauth';
const RETURN_URL = ORIGIN + '/echo/';
const COOKIE_PATH = '/echo/api/auth/oauth';
const STATE_COOKIE = 'echo_oauth_state';
const TICKET_COOKIE = 'echo_oauth_ticket';
const PROVIDERS = Object.freeze({
  google: {
    clientId: () => process.env.ECHO_GOOGLE_CLIENT_ID,
    secret: () => process.env.ECHO_GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid profile'
  },
  yandex: {
    clientId: () => process.env.ECHO_YANDEX_CLIENT_ID,
    secret: () => process.env.ECHO_YANDEX_CLIENT_SECRET,
    authorize: 'https://oauth.yandex.ru/authorize',
    token: 'https://oauth.yandex.ru/token',
    profile: 'https://login.yandex.ru/info?format=json',
    scope: 'login:info'
  }
});
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const rand = () => crypto.randomBytes(32).toString('base64url');
const cookieOpts = {httpOnly:true,secure:true,sameSite:'lax',path:COOKIE_PATH};
const validChallenge = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hasCredentials = provider =>
  Boolean(PROVIDERS[provider]?.clientId() && PROVIDERS[provider]?.secret());

async function initialize() {
  // Expire abandoned login attempts and tickets on startup.
  await pool.query("DELETE FROM echo_oauth_states WHERE expires_at < NOW()").catch(error => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query("DELETE FROM echo_oauth_tickets WHERE expires_at < NOW()").catch(error => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_auth_identities (
    account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('vkid','google','yandex')),
    provider_id TEXT NOT NULL,
    PRIMARY KEY(account_id,provider),
    UNIQUE(provider,provider_id)
  )`);
  // Migrate current VK players without changing their IDs or wallets.
  await pool.query(`INSERT INTO echo_auth_identities(account_id,provider,provider_id)
    SELECT id,'vkid',provider_id FROM echo_accounts WHERE provider='vkid'
    ON CONFLICT DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_oauth_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('web','android')),
    code_challenge TEXT,
    linked_account_id UUID REFERENCES echo_accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_oauth_tickets (
    ticket_hash TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    code_challenge TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 minutes')
  )`);
}

async function timedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally { clearTimeout(timer); }
}
async function getIdentity(provider, code) {
  const cfg=PROVIDERS[provider];
  const redirectUri = BASE + '/' + provider + '/callback';
  const response = await timedFetch(cfg.token,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'authorization_code',code,
      client_id:cfg.clientId(),client_secret:cfg.secret(),
      redirect_uri:redirectUri
    })
  });
  if (!response.ok) throw new Error(provider+' code exchange status '+response.status);
  const token=await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token)
    throw new Error(provider+' returned no access token');
  const result=await timedFetch(cfg.profile,{
    headers:{Authorization:(provider==='yandex'?'OAuth ':'Bearer ')+token.access_token}
  });
  if (!result.ok) throw new Error(provider+' profile verification status '+result.status);
  const profile=await result.json();
  const id = provider==='google'?profile.sub:profile.id;
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(String(id)))
    throw new Error(provider+' profile has no trusted user ID');
  return String(id);
}
async function resolveIdentity(provider, providerId, linkId, database=pool) {
  const client=await database.connect();
  try {
    await client.query('BEGIN');
    // Serialize first sign-ins of the same provider subject.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[provider+':'+providerId]);
    const existing=await client.query(
      'SELECT account_id FROM echo_auth_identities WHERE provider=$1 AND provider_id=$2',
      [provider,providerId]);
    let accountId=existing.rows[0]?.account_id;
    if (accountId && linkId && String(accountId)!==String(linkId)) {
      const error=new Error('Provider already belongs to another account');
      error.status=409;throw error;
    }
    if (linkId) {
      const account=await client.query('SELECT id FROM echo_accounts WHERE id=$1 FOR UPDATE',[linkId]);
      if (!account.rowCount) {const error=new Error('Account no longer exists');error.status=409;throw error;}
      if (!accountId) {
        const prior=await client.query('SELECT provider_id FROM echo_auth_identities WHERE account_id=$1 AND provider=$2',
          [linkId,provider]);
        if (prior.rowCount) {const error=new Error('Different provider identity already linked');error.status=409;throw error;}
        await client.query('INSERT INTO echo_auth_identities(account_id,provider,provider_id) VALUES($1,$2,$3)',
          [linkId,provider,providerId]);
        accountId=linkId;
      }
    } else if (!accountId) {
      // New provider means a new ECHO player, not an unsafe merge on email.
      const id=crypto.randomUUID();
      const nickname='Echo_'+id.replace(/-/g,'').slice(0,10);
      await client.query('INSERT INTO echo_accounts(id,provider,provider_id,nickname) VALUES($1,$2,$3,$4)',
        [id,provider,providerId,nickname]);
      await client.query('INSERT INTO echo_auth_identities(account_id,provider,provider_id) VALUES($1,$2,$3)',
        [id,provider,providerId]);
      accountId=id;
    }
    await client.query('COMMIT');
    return String(accountId);
  } catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}
function cookie(req,name) {
  const parts=(req.headers.cookie||'').split(';').map(part=>part.trim());
  const match=parts.find(part=>part.startsWith(name+'='));
  return match ? match.slice(name.length+1) : null;
}
function oauthRouter({sessionUser}){
 const router=express.Router();
 router.post('/:provider/start',async(req,res)=>{
   const provider=req.params.provider;
   if(!PROVIDERS[provider])return res.status(404).json({error:'Unknown provider'});
   if(!hasCredentials(provider))return res.status(503).json({error:provider+' is not configured'});
   const platform=req.body?.platform;
   const challenge=req.body?.codeChallenge;
   if(!['web','android'].includes(platform) || (platform==='android'&&!validChallenge(challenge)))
     return res.status(400).json({error:'Invalid OAuth platform or challenge'});
   if(platform==='web' && challenge != null)return res.status(400).json({error:'Unexpected challenge'});
   try{
     const linked=req.body?.link===true?await sessionUser(req):null;
     if(req.body?.link===true&&!linked)return res.status(401).json({error:'Sign in before linking accounts'});
     const state=rand();
     await pool.query(`INSERT INTO echo_oauth_states
       (state_hash,provider,platform,code_challenge,linked_account_id)
       VALUES($1,$2,$3,$4,$5)`,
       [sha256(state),provider,platform,platform==='android'?challenge:null,linked?.id||null]);
     const url=new URL(PROVIDERS[provider].authorize);
     url.searchParams.set('response_type','code');
     url.searchParams.set('client_id',PROVIDERS[provider].clientId());
     url.searchParams.set('redirect_uri',BASE+'/'+provider+'/callback');
     url.searchParams.set('scope',PROVIDERS[provider].scope);
     url.searchParams.set('state',state);
     if(provider==='google')url.searchParams.set('prompt','select_account');
     if(platform==='web')res.cookie(STATE_COOKIE,state,{...cookieOpts,maxAge:10*60*1000});
     res.set('Cache-Control','no-store');
     res.json({authorizationUrl:url.toString()});
   }catch(error){
     console.error('[echo oauth] start failed',error.message);
     res.status(500).json({error:'Unable to start authorization'});
   }
 });
 router.get('/:provider/callback',async(req,res)=>{
   const provider=req.params.provider;
   if(!PROVIDERS[provider])return res.status(404).send('Unknown provider');
   const state=typeof req.query.state==='string'?req.query.state:'';
   const code=typeof req.query.code==='string'?req.query.code:'';
   if(!validChallenge(state)||!code||code.length>4096){
     return res.status(400).send('Authorization was cancelled or invalid. Return to ECHO.');
   }
   try{
     const rows=await pool.query(`DELETE FROM echo_oauth_states
       WHERE state_hash=$1 AND provider=$2 AND expires_at>NOW()
       RETURNING platform,code_challenge,linked_account_id`,[sha256(state),provider]);
     const flow=rows.rows[0];
     if(!flow)return res.status(400).send('Expired authorization. Try again in ECHO.');
     if(flow.platform==='web'){
       if(cookie(req,STATE_COOKIE)!==state)return res.status(403).send('Authorization session mismatch.');
       res.clearCookie(STATE_COOKIE,cookieOpts);
     }
     const providerId=await getIdentity(provider,code);
     const accountId=await resolveIdentity(provider,providerId,flow.linked_account_id);
     const ticket=rand();
     await pool.query(`INSERT INTO echo_oauth_tickets(ticket_hash,account_id,platform,code_challenge)
       VALUES($1,$2,$3,$4)`,[sha256(ticket),accountId,flow.platform,flow.code_challenge]);
     res.set('Cache-Control','no-store');
     res.set('Referrer-Policy','no-referrer');
     if(flow.platform==='android'){
       // A short-lived ticket, NEVER the bearer token, crosses an Android deep link.
       // Redeeming the ticket also requires the native app's private PKCE verifier.
       const url='echogame://oauth?ticket='+encodeURIComponent(ticket);
       return res.type('html').send(`<!doctype html><meta name="referrer" content="no-referrer">
         <title>ECHO</title><p>Возврат в игру ECHO…</p>
         <a href="${url}">Вернуться в ECHO</a>
         <script>location.replace(${JSON.stringify(url)})</script>`);
     }
     res.cookie(TICKET_COOKIE,ticket,{...cookieOpts,maxAge:3*60*1000});
     res.type('html').send(`<!doctype html><meta name="referrer" content="no-referrer">
       <title>ECHO</title><p>Вход подтверждён. Можно вернуться в ECHO.</p>
       <script>
       if(window.opener&&!window.opener.closed){
         window.opener.postMessage({type:'echo-oauth-ready'},${JSON.stringify(ORIGIN)});
         window.close();
       } else {location.replace(${JSON.stringify(RETURN_URL+'?echo_oauth=complete')});}
       </script>
       <a href="${RETURN_URL}?echo_oauth=complete">Вернуться в ECHO</a>`);
   }catch(error){
     console.error('[echo oauth] callback failed',error.message);
     res.status(error.status||502).type('html').send(
       '<!doctype html><meta name="referrer" content="no-referrer"><p>Не удалось войти в ECHO. Закройте окно и повторите попытку.</p>');
   }
 });
 router.post('/complete',async(req,res)=>{
   const platform=req.body?.platform;
   if(!['web','android'].includes(platform))return res.status(400).json({error:'Invalid platform'});
   if(platform==='web' && req.get('origin')!==ORIGIN)
     return res.status(403).json({error:'Origin mismatch'});
   const ticket=platform==='web'?cookie(req,TICKET_COOKIE):req.body?.ticket;
   const verifier=req.body?.codeVerifier;
   if(!validChallenge(ticket)||platform==='android'&&!validChallenge(verifier))
     return res.status(400).json({error:'Missing authorization ticket'});
   try{
     const proof=platform==='android'
       ? crypto.createHash('sha256').update(verifier).digest('base64url') : null;
     const client=await pool.connect();
     try{
       await client.query('BEGIN');
       const x=await client.query(`DELETE FROM echo_oauth_tickets
         WHERE ticket_hash=$1 AND platform=$2 AND expires_at>NOW()
           AND (code_challenge IS NULL OR code_challenge=$3)
         RETURNING account_id`,[sha256(ticket),platform,proof]);
       if(!x.rowCount){await client.query('ROLLBACK');return res.status(401).json({error:'Authorization expired'});}
       const account=await client.query('SELECT id,nickname FROM echo_accounts WHERE id=$1',[x.rows[0].account_id]);
       if(!account.rowCount){await client.query('ROLLBACK');return res.status(401).json({error:'Account unavailable'});}
       const session=crypto.randomBytes(32).toString('hex');
       await client.query("INSERT INTO echo_auth_sessions(token_hash,account_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",
         [sha256(session),account.rows[0].id]);
       await client.query('COMMIT');
       if(platform==='web')res.clearCookie(TICKET_COOKIE,cookieOpts);
       res.set('Cache-Control','no-store');
       return res.json({token:session,nickname:account.rows[0].nickname,accountId:account.rows[0].id});
     }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
     finally{client.release();}
   }catch(error){
     console.error('[echo oauth] complete failed',error.message);
     res.status(500).json({error:'Unable to finish authorization'});
   }
 });
 return router;
}
module.exports={initialize,oauthRouter,hasCredentials,resolveIdentity};

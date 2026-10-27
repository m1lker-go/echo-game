'use strict';

// One-time ECHO quest: verified VK group membership awards exactly one premium pack.
// The community URL/ID are public; only the VK API token belongs in the server environment.
const GROUP_ID = 242489870;
const GROUP_URL = 'https://vk.ru/club242489870';
const REWARD = Object.freeze({type:'pack',packType:'premium',quantity:1});

async function checkVKGroupMembership(vkId, groupId, token, fetchImpl = globalThis.fetch) {
  if (!/^[1-9]\d{0,19}$/.test(String(vkId)) || !token) {
    throw new Error('VK membership verification unavailable');
  }
  const body = new URLSearchParams({
    group_id:String(groupId), user_id:String(vkId), access_token:token, v:'5.199'
  });
  // POST avoids putting the secret in a request URL or diagnostics.
  const response = await fetchImpl('https://api.vk.com/method/groups.isMember', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body,
    signal:AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error('VK membership request failed');
  const data = await response.json();
  if (data?.error) {
    // Surface the numeric VK error only. Never expose tokens, request arguments or API debug payload.
    const code = Number(data.error.error_code);
    const safeCode = Number.isSafeInteger(code) && code > 0 && code <= 999999 ? code : null;
    const error = new Error('VK groups.isMember rejected request' + (safeCode ? ' (code ' + safeCode + ')' : ''));
    if (safeCode) error.vkErrorCode = safeCode;
    throw error;
  }
  if (data?.response !== 0 && data?.response !== 1 && data?.response !== true && data?.response !== false) {
    throw new Error('VK membership response invalid');
  }
  return data.response === 1 || data.response === true;
}

function createVKCommunityQuest({
  pool, sessionUser, grantPack,
  groupToken = process.env.ECHO_VK_GROUP_TOKEN || '',
  checkMembership = checkVKGroupMembership,
  createRouter = () => require('express').Router()
}) {
  if (typeof grantPack !== 'function') throw new TypeError('A pack grant function is required');
  const router = createRouter();
  const state = (claimed, vkLinked) => ({
    id:'vk_community', groupUrl:GROUP_URL, claimed:Boolean(claimed),
    vkLinked:Boolean(vkLinked), verificationAvailable:Boolean(groupToken), reward:REWARD
  });

  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS echo_vk_community_quest_claims (
      account_id UUID PRIMARY KEY REFERENCES echo_accounts(id) ON DELETE CASCADE,
      claimed_at TIMESTAMPTZ
    )`);
  }

  async function account(req,res) {
    const user=await sessionUser(req);
    if(!user){res.status(401).json({error:'Unauthorized'});return null;}
    return user.id;
  }

  async function linkedVK(accountId) {
    const result=await pool.query(
      "SELECT provider_id FROM echo_auth_identities WHERE account_id=$1 AND provider='vkid'",
      [accountId]
    );
    return result.rows[0]?.provider_id || null;
  }

  router.get('/',async(req,res)=>{
    try {
      const accountId=await account(req,res);
      if(!accountId)return;
      const [claim, vkId]=await Promise.all([
        pool.query('SELECT claimed_at FROM echo_vk_community_quest_claims WHERE account_id=$1',[accountId]),
        linkedVK(accountId)
      ]);
      res.set('Cache-Control','no-store');
      res.json({quest:state(Boolean(claim.rows[0]?.claimed_at),Boolean(vkId))});
    } catch(error) {
      console.error('[vk-community-quest] status failed:',error.message);
      res.status(500).json({error:'VK quest status unavailable'});
    }
  });

  router.post('/check',async(req,res)=>{
    let client;
    try {
      const accountId=await account(req,res);
      if(!accountId)return;
      // Previously claimed rewards remain claimed even if the VK API is down.
      const previous=await pool.query('SELECT claimed_at FROM echo_vk_community_quest_claims WHERE account_id=$1',[accountId]);
      if(previous.rows[0]?.claimed_at) {
        res.set('Cache-Control','no-store');
        return res.json({quest:state(true,true),claimedNow:false,reward:null});
      }
      const vkId=await linkedVK(accountId);
      if(!vkId)return res.status(409).json({error:'vk_account_required'});
      if(!groupToken)return res.status(503).json({error:'vk_verification_not_configured'});
      // Only a trusted VK identity from the server database may be checked.
      let member;
      try { member=await checkMembership(vkId,GROUP_ID,groupToken); }
      catch(error){
        console.warn('[vk-community-quest] VK verification failed:',error.message);
        const code = error.vkErrorCode;
        return res.status(503).json({
          error:'vk_verification_unavailable',
          ...(Number.isSafeInteger(code) && code > 0 && code <= 999999 ? {vkErrorCode:code} : {})
        });
      }
      if(!member)return res.status(409).json({error:'not_subscribed'});

      client=await pool.connect();
      await client.query('BEGIN');
      // The unique account row and FOR UPDATE serialize simultaneous claims.
      await client.query(
        'INSERT INTO echo_vk_community_quest_claims(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING',
        [accountId]
      );
      const locked=await client.query(
        'SELECT claimed_at FROM echo_vk_community_quest_claims WHERE account_id=$1 FOR UPDATE',
        [accountId]
      );
      if(locked.rows[0]?.claimed_at) {
        await client.query('COMMIT');
        res.set('Cache-Control','no-store');
        return res.json({quest:state(true,true),claimedNow:false,reward:null});
      }
      // Inventory and completion live in the same PostgreSQL transaction.
      await grantPack(accountId,'premium',1,client);
      await client.query('UPDATE echo_vk_community_quest_claims SET claimed_at=NOW() WHERE account_id=$1',[accountId]);
      await client.query('COMMIT');
      res.set('Cache-Control','no-store');
      res.json({quest:state(true,true),claimedNow:true,reward:REWARD});
    } catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('[vk-community-quest] claim failed:',error.message);
      res.status(500).json({error:'VK quest claim unavailable'});
    } finally {client?.release();}
  });

  return {router,initialize};
}

module.exports={createVKCommunityQuest,checkVKGroupMembership,GROUP_ID,GROUP_URL};

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createVKCommunityQuest,checkVKGroupMembership,GROUP_ID,GROUP_URL}=require('../vk-community-quest');
const A='b7042f81-037a-4051-b983-7990e0cacabc';
const B='05b777a0-ac46-46cf-9d2a-46a155d89aa6';

function harness({token='test-token',member=true,vkId='123456',broken=false}={}){
  const rows=new Map(),packs=new Map();
  const calls=[];
  let failGrant=false;
  let saved=null;
  const db={
    async query(sql,args=[]){
      const q=sql.trim();
      if(q==='BEGIN'){ saved={rows:new Map([...rows].map(([k,v])=>[k,{...v}])),packs:new Map(packs)};return {rows:[],rowCount:0}; }
      if(q==='ROLLBACK'){if(saved){rows.clear();for(const [k,v] of saved.rows)rows.set(k,v);packs.clear();for(const [k,v] of saved.packs)packs.set(k,v)}saved=null;return {rows:[],rowCount:0};}
      if(q==='COMMIT'){saved=null;return {rows:[],rowCount:0};}
      if(q.startsWith('CREATE TABLE'))return {rows:[],rowCount:0};
      if(q.startsWith('SELECT provider_id FROM echo_auth_identities')){
        return {rows:args[0]===A && vkId?[{provider_id:vkId}]:[],rowCount:args[0]===A&&vkId?1:0};
      }
      if(q.startsWith('SELECT claimed_at FROM echo_vk_community_quest_claims')){
        const row=rows.get(args[0]);return {rows:row?[{...row}]:[],rowCount:row?1:0};
      }
      if(q.startsWith('INSERT INTO echo_vk_community_quest_claims')){
        if(!rows.has(args[0]))rows.set(args[0],{claimed_at:null});
        return {rows:[],rowCount:1};
      }
      if(q.startsWith('UPDATE echo_vk_community_quest_claims')){
        rows.get(args[0]).claimed_at=new Date();
        return {rows:[],rowCount:1};
      }
      throw Error('Unexpected SQL: '+q);
    },
    async connect(){return {query:(...args)=>db.query(...args),release(){}};}
  };
  const router={stack:[],get(p,fn){this.stack.push({method:'GET',p,fn})},post(p,fn){this.stack.push({method:'POST',p,fn})}};
  const quest=createVKCommunityQuest({
    pool:db,
    sessionUser:async req=>req.account?{id:req.account}:null,
    grantPack:async(account,kind,n,tx)=>{
      assert.equal(kind,'premium');assert.equal(n,1);assert.ok(tx);
      if(failGrant)throw Error('Simulated inventory failure');
      packs.set(account,(packs.get(account)||0)+n);
    },
    groupToken:token,
    checkMembership:async(uid,id,t)=>{
      calls.push({uid,id,t});
      if(broken)throw Error('VK down');
      return member;
    },
    createRouter:()=>router
  });
  async function request(method,p,{account=A}={}){
    const h=router.stack.find(r=>r.method===method&&r.p===p);
    assert.ok(h,'Route registered '+method+' '+p);
    const res={
      statusCode:200,body:null,
      status(code){this.statusCode=code;return this},
      json(data){this.body=data;return this},
      set(){return this}
    };
    await h.fn({account},res);
    return res;
  }
  return {quest,request,rows,packs,calls,failGrant(){failGrant=true}};
}

test('VK group ID and URL match ECHO community',()=>{
  assert.equal(GROUP_ID,242489870);
  assert.equal(GROUP_URL,'https://vk.ru/club242489870');
});
test('Only verified ECHO accounts can view or claim VK quest',async()=>{
  const h=harness();await h.quest.initialize();
  assert.equal((await h.request('GET','/',{account:null})).statusCode,401);
  assert.equal((await h.request('POST','/check',{account:null})).statusCode,401);
  assert.equal((await h.request('GET','/')).body.quest.claimed,false);
});
test('Unlinked VK identities and unavailable verification never award packs',async()=>{
  const other=harness();
  const withoutVK=await other.request('POST','/check',{account:B});
  assert.equal(withoutVK.statusCode,409);
  assert.equal(withoutVK.body.error,'vk_account_required');
  assert.equal(other.packs.size,0);
  const missing=harness({token:''});
  assert.equal((await missing.request('POST','/check')).body.error,'vk_verification_not_configured');
  const down=harness({broken:true});
  assert.equal((await down.request('POST','/check')).statusCode,503);
  assert.equal(down.packs.size,0);
});
test('Unsubscribed VK member receives no reward',async()=>{
  const h=harness({member:false});
  const response=await h.request('POST','/check');
  assert.equal(response.statusCode,409);
  assert.equal(response.body.error,'not_subscribed');
  assert.equal(h.packs.size,0);
  assert.deepEqual(h.calls,[{uid:'123456',id:242489870,t:'test-token'}]);
});
test('Verified subscription grants one premium pack once and persists claimed state',async()=>{
  const h=harness();
  const first=await h.request('POST','/check');
  assert.equal(first.statusCode,200);
  assert.equal(first.body.claimedNow,true);
  assert.deepEqual(first.body.reward,{type:'pack',packType:'premium',quantity:1});
  assert.equal(h.packs.get(A),1);
  assert.equal((await h.request('GET','/')).body.quest.claimed,true);
  const repeat=await h.request('POST','/check');
  assert.equal(repeat.body.claimedNow,false);
  assert.equal(h.calls.length,1,'Second claim needs no VK API request');
  assert.equal(h.packs.get(A),1);
});
test('Inventory failure rolls back completion and pack and allows later retry',async()=>{
  const h=harness();h.failGrant();
  assert.equal((await h.request('POST','/check')).statusCode,500);
  assert.equal(h.packs.size,0);
  assert.equal(h.rows.get(A),undefined);
});
test('VK verification posts token only in HTTPS form body and fails closed',async()=>{
  let sent;
  const yes=await checkVKGroupMembership('123456',GROUP_ID,'test-token',async(uri,options)=>{
    sent={uri,options};
    return {ok:true,json:async()=>({response:1})};
  });
  assert.equal(yes,true);
  assert.equal(sent.uri,'https://api.vk.com/method/groups.isMember');
  assert.equal(sent.options.method,'POST');
  assert.equal(sent.options.body.get('group_id'),'242489870');
  assert.equal(sent.options.body.get('user_id'),'123456');
  assert.equal(sent.options.body.get('access_token'),'test-token');
  assert.equal(await checkVKGroupMembership('123456',GROUP_ID,'test-token',async()=>({ok:true,json:async()=>({response:0})})),false);
  await assert.rejects(()=>checkVKGroupMembership('123456',GROUP_ID,'test-token',async()=>({ok:true,json:async()=>({error:{error_code:5}})})));
  await assert.rejects(()=>checkVKGroupMembership('bad',GROUP_ID,'test-token',async()=>{throw Error('Must not request')}));
});
test('Special quests show the uploaded ECHO icon, reward and permanent link after completion',()=>{
  const root=path.resolve(__dirname,'../..');
  const script=fs.readFileSync(path.join(root,'client/special-quests.js'),'utf8');
  assert.match(script,/assets\/icons\/icon_echo\.webp/);
  assert.match(script,/function renderVKCommunity/);
  assert.match(script,/if\(!vkQuest\.claimed\)/);
  assert.match(script,/special_vk_name/);
  assert.match(script,/vk-community\/check/);
  assert.match(script,/VKWebAppOpenURL/);
  assert.ok(fs.existsSync(path.join(root,'client/assets/icons/icon_echo.webp')));
});

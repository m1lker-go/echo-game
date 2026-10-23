'use strict';
const express = require('express');
const CF_CODE = /^CF-[A-HJ-NP-Z2-9]{12}$/;
const URL = 'https://cat-fight.ru/codes/partner/redeem';
function createCodeRedemption({sessionUser, secret=require('./partner-code-secret').getPartnerSecret,
  redeem=async(code,echoAccountId,key)=>{
    const r=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json','x-echo-partner-secret':key},
      body:JSON.stringify({code,echoAccountId}),signal:AbortSignal.timeout(5000),redirect:'error'});
    let payload={};try{payload=await r.json()}catch{}
    return {status:r.status,payload};
  }}){
  const router=express.Router(),recent=new Map();
  router.post('/redeem',async(req,res)=>{
    const user=await sessionUser(req);
    if(!user)return res.status(401).json({error:'Unauthorized'});
    const code=typeof req.body?.code==='string'?req.body.code.trim().toUpperCase():'';
    if(!CF_CODE.test(code))return res.status(400).json({error:'Unknown or invalid code'});
    const key=String(user.id),t=Date.now(),attempts=(recent.get(key)||[]).filter(x=>t-x<60000);
    if(attempts.length>=8)return res.status(429).json({error:'Too many code attempts'});
    attempts.push(t);recent.set(key,attempts);
    if(recent.size>10000)recent.clear();
    const shared=secret();
    if(typeof shared!=='string'||shared.length<32)return res.status(503).json({error:'Partner integration is not configured'});
    try {
      const result=await redeem(code,user.id,shared);
      if(result.status===200&&result.payload?.verified)
        return res.json({success:true,type:'cat_partner',alreadyRedeemed:!!result.payload.alreadyRedeemed,
          message:'Код принят! Вернись в Cat Fighting и нажми «Проверка».'});
      const status=[400,404,409,410,429,503].includes(result.status)?result.status:502;
      return res.status(status).json({error:result.payload?.error||'Code activation unavailable'});
    }catch(error){
      console.error('[code-redemption] partner unavailable:',error.message);
      return res.status(502).json({error:'Partner server unavailable'});
    }
  });
  return router;
}
module.exports={createCodeRedemption,CF_CODE};

'use strict';
// Staged ECHO-only Robokassa integration. Never reuse Cat Fighting's payment route.
const crypto = require('node:crypto');
const {recordPackOpened} = require('./pack-quest-progress');
const PRICE_RUB='250.00', PRICE_CENTS=25000, MERCHANT_URL='https://auth.robokassa.ru/Merchant/Index.aspx';

function config(env=process.env) {
  // Live payments require EXPLICIT opt-in. No surprises during staging.
  const test=env.ECHO_ROBO_TEST_MODE !== 'false';
  const merchant=String(env.ECHO_ROBO_MERCHANT_LOGIN || '').trim();
  const password1=String(test ? env.ECHO_ROBO_TEST_PASSWORD1 || '' : env.ECHO_ROBO_PASSWORD1 || '').trim();
  const password2=String(test ? env.ECHO_ROBO_TEST_PASSWORD2 || '' : env.ECHO_ROBO_PASSWORD2 || '').trim();
  return {test,merchant,password1,password2,
    enabled:!!merchant && password1.length>=8 && password2.length>=8};
}
const digest=s=>crypto.createHash('md5').update(s,'utf8').digest('hex').toUpperCase();
const signatureForCheckout=(merchant,sum,id,pass)=>digest([merchant,sum,id,pass].join(':'));
const signatureForResult=(sum,id,pass)=>digest([sum,id,pass].join(':'));
function secureSameSignature(expected,provided){
  if(typeof provided!=='string'||!/^[a-f0-9]{32}$/i.test(provided))return false;
  return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(provided.toUpperCase()));
}
function toCents(raw){
  // Robokassa can return six decimal places for production OutSum.
  const m=/^([0-9]{1,8})(?:\.([0-9]{1,6}))?$/.exec(String(raw ?? ''));
  if(!m)return null;
  const fractional=(m[2]||'').padEnd(2,'0');
  if(fractional.slice(2).replace(/0/g,'')!=='')return null;
  return Number(m[1])*100+Number(fractional.slice(0,2));
}
const validId=x=>/^[1-9]\d{0,17}$/.test(String(x??''));

function createRobokassaPayments({
  pool,sessionUser,rollSecurePack,
  createRouter=()=>require('express').Router(),getConfig=config
}){
  const router=createRouter();
  let schemaReady=false;
  async function initialize(){
    await pool.query("CREATE TABLE IF NOT EXISTS echo_robokassa_orders (id BIGSERIAL PRIMARY KEY, account_id UUID NOT NULL REFERENCES echo_accounts(id), product TEXT NOT NULL DEFAULT 'premium_pack', amount NUMERIC(10,2) NOT NULL DEFAULT 250.00, is_test BOOLEAN NOT NULL, status TEXT NOT NULL DEFAULT 'pending', cards JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ)");
    await pool.query('CREATE INDEX IF NOT EXISTS echo_robokassa_account_orders ON echo_robokassa_orders (account_id,id DESC)');
    schemaReady=true;
  }
  router.get('/',(_req,res)=>{
    const c=getConfig();
    res.set('Cache-Control','no-store');
    res.json({service:'echo-robokassa',enabled:c.enabled&&schemaReady,
      testMode:c.test,price:PRICE_RUB,currency:'RUB'});
  });
  router.post('/create',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const c=getConfig();
    if(!c.enabled||!schemaReady)return res.status(503).json({error:'Payment not configured'});
    try{
      const user=await sessionUser(req);
      if(!user)return res.status(401).json({error:'Sign in to ECHO'});
      // Do not accept amount, account_id or reward from the browser.
      const r=await pool.query("INSERT INTO echo_robokassa_orders (account_id,amount,is_test,product) VALUES($1,$2,$3,'premium_pack') RETURNING id",[user.id,PRICE_RUB,c.test]);
      const id=String(r.rows[0].id);
      const qs=new URLSearchParams({
        MerchantLogin:c.merchant,OutSum:PRICE_RUB,InvId:id,
        Description:'ECHO: элитный пак персонажей',
        SignatureValue:signatureForCheckout(c.merchant,PRICE_RUB,id,c.password1),
        IsTest:c.test?'1':'0',Culture:'ru',Encoding:'utf-8'
      });
      res.json({orderId:id,price:PRICE_RUB,currency:'RUB',
        checkoutUrl:MERCHANT_URL+'?'+qs.toString(),testMode:c.test});
    }catch(error){
      console.error('[echo robokassa] create failed:',error.message);
      res.status(500).json({error:'Payment unavailable'});
    }
  });
  router.get('/status/:id',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!validId(req.params.id))return res.status(400).json({error:'Invalid order'});
    try{
      const user=await sessionUser(req);
      if(!user)return res.status(401).json({error:'Unauthorized'});
      const r=await pool.query('SELECT status,cards FROM echo_robokassa_orders WHERE id=$1 AND account_id=$2',[req.params.id,user.id]);
      if(!r.rowCount)return res.status(404).json({error:'Order not found'});
      res.json({status:r.rows[0].status,cards:r.rows[0].status==='paid'?r.rows[0].cards:null});
    }catch(error){
      console.error('[echo robokassa] status failed:',error.message);
      res.status(500).json({error:'Order unavailable'});
    }
  });
  // Authoritative server-to-server callback. A checkout SuccessURL cannot credit cards.
  router.post('/result',async(req,res)=>{
    const c=getConfig();
    if(!c.enabled||!schemaReady)return res.status(503).send('NOT READY');
    const b=req.body||{};
    const sum=typeof b.OutSum==='string'?b.OutSum:'';
    const id=String(b.InvId??'');
    if(Object.keys(b).some(k=>k.startsWith('Shp_'))||
       !validId(id)||toCents(sum)!==PRICE_CENTS||
       !secureSameSignature(signatureForResult(sum,id,c.password2),b.SignatureValue))
      return res.status(400).send('BAD SIGNATURE OR ORDER');
    let client;
    try{
      client=await pool.connect();
      await client.query('BEGIN');
      const found=await client.query('SELECT account_id,status,amount,is_test,product FROM echo_robokassa_orders WHERE id=$1 FOR UPDATE',[id]);
      const order=found.rows[0];
      if(!order||toCents(order.amount)!==PRICE_CENTS||order.product!=='premium_pack'||order.is_test!==c.test){
        await client.query('ROLLBACK');return res.status(400).send('ORDER MISMATCH');
      }
      if(order.status==='paid'){
        await client.query('COMMIT');return res.type('text/plain').send('OK'+id);
      }
      if(order.status!=='pending'){
        await client.query('ROLLBACK');return res.status(409).send('ORDER NOT PENDING');
      }
      const cards=rollSecurePack('premium');
      if(!Array.isArray(cards)||cards.length!==5)throw new Error('Invalid premium roll');
      for(const card of cards){
        await client.query('INSERT INTO echo_hero_collection(account_id,model,fragments) VALUES($1,$2,$3) ON CONFLICT(account_id,model) DO UPDATE SET fragments=echo_hero_collection.fragments+EXCLUDED.fragments',[String(order.account_id),card.model,card.count]);
      }
      await recordPackOpened(client,order.account_id,'premium');
      await client.query("UPDATE echo_robokassa_orders SET status='paid',cards=$2::jsonb,paid_at=NOW() WHERE id=$1",[id,JSON.stringify(cards)]);
      await client.query('COMMIT');
      console.info('[echo robokassa] paid pack granted',{test:c.test});
      return res.type('text/plain').send('OK'+id);
    }catch(error){
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('[echo robokassa] result failed:',error.message);
      return res.status(500).send('RETRY');
    }finally{client?.release();}
  });
  const returnPage=(status)=>(_req,res)=>{
    res.set('Cache-Control','no-store');
    res.type('html').send('<!doctype html><html lang="ru"><meta charset="utf-8"><title>ECHO</title><body style="background:#000;color:#fff;font:18px system-ui;text-align:center;padding:10vh 16px">'+(status==='success'?'Платёж отправлен. Вернитесь в ECHO, чтобы проверить результат.':'Оплата отменена. Вернитесь в ECHO.')+'</body></html>');
  };
  router.get('/return',returnPage('success'));
  router.get('/fail',returnPage('fail'));
  return {router,initialize};
}
module.exports={createRobokassaPayments,config,toCents,
  signatureForCheckout,signatureForResult,secureSameSignature,PRICE_RUB};

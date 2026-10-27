'use strict';

// VPS only, never a public API route. Example:
// node scripts/create-promo.js --code ECHO2026 --type premium_pack --amount 1 --limit 100
// node scripts/create-promo.js --code WINTER100 --type coins --amount 100 --expires 2026-12-31T23:59:59Z
const {validatePromo}=require('../promo-codes');

function parseArguments(argv){
 const params={};
 for(let i=0;i<argv.length;i+=2){
  const key=argv[i],value=argv[i+1];
  if(!/^--(?:code|type|amount|limit|expires)$/.test(key)||!value||params[key])
   throw new TypeError('Arguments: --code NAME --type coins|basic_pack|premium_pack --amount N [--limit N] [--expires ISO-UTC]');
  params[key]=value;
 }
 const amount=Number(params['--amount']);
 const limit=params['--limit']===undefined?null:Number(params['--limit']);
 const date=params['--expires'];
 if(params['--expires']!==undefined &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date))
  throw new TypeError('Expiration must be UTC: YYYY-MM-DDTHH:mm:ssZ');
 const expiresAt=date===undefined?null:new Date(date);
 if(limit===null && expiresAt===null)throw new TypeError('Provide at least --limit or --expires');
 const validated=validatePromo({code:params['--code'],type:params['--type'],quantity:amount,limit,expiresAt});
 if(validated.expiresAt && validated.expiresAt<=new Date())throw new RangeError('Expiration must be in the future');
 return validated;
}

async function createFromCLI(argv){
 const promo=parseArguments(argv);
 // Only connect after validation, and never log DB secrets.
 const {pool}=require('../db');
 try {
  await pool.query(`INSERT INTO echo_promo_codes
    (code,reward_type,reward_amount,expires_at,max_activations)
    VALUES($1,$2,$3,$4,$5)`,
    [promo.code,promo.type,promo.quantity,promo.expiresAt,promo.limit]);
  console.log('ECHO promo created:',promo.code,promo.type,promo.quantity,
    'limit:',promo.limit??'none',
    'expires:',promo.expiresAt?.toISOString()??'none');
 } finally {await pool.end();}
}

if(require.main===module){
 createFromCLI(process.argv.slice(2)).catch(error=>{
  if(error.code==='23505')console.error('Promo code already exists.');
  else console.error('Could not create promo:',error.message);
  process.exitCode=1;
 });
}

module.exports={parseArguments};

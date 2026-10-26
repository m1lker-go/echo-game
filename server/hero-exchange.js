'use strict';

// Card exchange is server-authoritative: prices and ownership are never taken
// from the browser. Claiming a hero does not subtract its unlocking fragments.
const PRICES = Object.freeze({common:2,uncommon:3,rare:5,epic:7,legendary:10});
const REQUIRED = Object.freeze({common:25,uncommon:30,rare:40,epic:50,legendary:60});
const STARTERS = new Set(['character-female-b.glb','character-male-a.glb','character-female-c.glb']);
const RARITIES = Object.keys(PRICES);
const emptyCounts = () => Object.fromEntries(RARITIES.map(key=>[key,0]));

function summarizeExcess(rows, rarities) {
  const counts=emptyCounts(),changes=[];
  let totalCoins=0;
  for(const row of rows) {
    const rarity=rarities[row.model];
    if(!PRICES[rarity])continue;
    const fragments=Number(row.fragments);
    if(!Number.isSafeInteger(fragments)||fragments<=0)continue;
    const starter=STARTERS.has(row.model);
    if(!starter && row.claimed!==true)continue;
    // The original unlock cost stays with the assembled hero forever.
    // Starter heroes are available without spending any fragments.
    const keep=starter?0:REQUIRED[rarity];
    const quantity=Math.max(0,fragments-keep);
    if(!quantity)continue;
    counts[rarity]+=quantity;
    totalCoins+=quantity*PRICES[rarity];
    changes.push({model:row.model,keep,quantity});
  }
  if(!Number.isSafeInteger(totalCoins)||totalCoins<0)
    throw new Error('Exchange reward out of range');
  return {counts,totalCards:changes.reduce((n,row)=>n+row.quantity,0),totalCoins,changes};
}

function createHeroExchange({pool,sessionUser,heroRarities,createRouter=()=>require('express').Router()}) {
  const router=createRouter();
  if(!heroRarities)throw new TypeError('Hero rarity map is required');
  async function account(req,res){
    const user=await sessionUser(req);
    if(!user){res.status(401).json({error:'Unauthorized'});return null;}
    return user.id;
  }
  router.get('/excess',async(req,res)=>{
    try {
      const id=await account(req,res);
      if(!id)return;
      const rows=await pool.query(
        'SELECT model,fragments,claimed FROM echo_hero_collection WHERE account_id=$1',[String(id)]
      );
      const {counts,totalCards,totalCoins}=summarizeExcess(rows.rows,heroRarities);
      res.set('Cache-Control','no-store');
      res.json({counts,totalCards,totalCoins});
    }catch(error){
      console.error('[hero-exchange] read failed:',error.message);
      res.status(500).json({error:'Extra cards unavailable'});
    }
  });

  router.post('/exchange',async(req,res)=>{
    let client;
    try {
      const id=await account(req,res);
      if(!id)return;
      client=await pool.connect();
      await client.query('BEGIN');
      // Lock fragment rows before calculating the final payout.
      // Concurrent requests can never exchange the same fragments twice.
      const rows=await client.query(
        'SELECT model,fragments,claimed FROM echo_hero_collection ' +
        'WHERE account_id=$1 ORDER BY model FOR UPDATE',[String(id)]
      );
      const {counts,totalCards,totalCoins,changes}=summarizeExcess(rows.rows,heroRarities);
      if(!totalCards){
        await client.query('COMMIT');
        return res.json({exchanged:false,counts,totalCards:0,coinsGranted:0});
      }
      for(const {model,keep} of changes){
        await client.query(
          'UPDATE echo_hero_collection SET fragments=$3 WHERE account_id=$1 AND model=$2',
          [String(id),model,keep]
        );
      }
      const result=await client.query(
        'INSERT INTO echo_wallets(profile_id,coins) VALUES($1,$2) ' +
        'ON CONFLICT(profile_id) DO UPDATE SET coins=echo_wallets.coins+EXCLUDED.coins ' +
        'RETURNING coins',[String(id),totalCoins]
      );
      await client.query('COMMIT');
      res.set('Cache-Control','no-store');
      res.json({exchanged:true,counts,totalCards,coinsGranted:totalCoins,balance:Number(result.rows[0].coins)});
    }catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      console.error('[hero-exchange] exchange failed:',error.message);
      res.status(500).json({error:'Card exchange unavailable'});
    }finally{client?.release();}
  });
  return {router};
}
module.exports={createHeroExchange,summarizeExcess,PRICES,REQUIRED,STARTERS};

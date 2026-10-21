'use strict';
// Scores marked account:<uuid> originate only from server-verified Socket.IO sessions.
const ACCOUNT_SCORE_ID = /^account:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const accountIdFromScore = identity => typeof identity === 'string' ? identity.match(ACCOUNT_SCORE_ID)?.[1] || null : null;
const REWARDS = [[1,25],[2,21],[3,18],[10,16],[20,12],[30,10],[40,8],[50,5]];
function rewardForPlace(place) {
  for (const [limit, coins] of REWARDS) if (place<=limit) return coins;
  return 0;
}
function rankParticipants(rows) {
  return [...rows].sort((a,b)=>Number(b.score)-Number(a.score)||Number(a.reached_at)-Number(b.reached_at)||String(a.profile_id).localeCompare(String(b.profile_id)))
    .map((row,i)=>({...row,place:i+1,coins:rewardForPlace(i+1)}));
}
async function initialize(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_round_scores (
    round_id BIGINT NOT NULL, room_id INTEGER NOT NULL, profile_id TEXT NOT NULL,
    player_name TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
    reached_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(round_id,room_id,profile_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_coin_ledger (
    round_id BIGINT NOT NULL, room_id INTEGER NOT NULL, profile_id TEXT NOT NULL,
    place INTEGER NOT NULL, score INTEGER NOT NULL, coins INTEGER NOT NULL,
    PRIMARY KEY(round_id,room_id,profile_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_wallets (
    profile_id TEXT PRIMARY KEY, coins BIGINT NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_round_finalized (
    round_id BIGINT NOT NULL, room_id INTEGER NOT NULL,
    PRIMARY KEY(round_id,room_id))`);
  // Enforce one Echo Coin credit per verified account across the whole round.
  await pool.query(`CREATE TABLE IF NOT EXISTS echo_round_account_awards (
    round_id BIGINT NOT NULL, account_id UUID NOT NULL,
    PRIMARY KEY(round_id,account_id))`);
  // Honor payouts from earlier deployments without paying them twice.
  await pool.query(`INSERT INTO echo_round_account_awards(round_id,account_id)
    SELECT DISTINCT round_id,substring(profile_id from 9)::uuid
    FROM echo_coin_ledger
    WHERE coins > 0 AND profile_id ~* '^account:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ON CONFLICT DO NOTHING`);
}
async function writeTick(pool,roundId,roomId,entries) {
  if (!entries.length) return;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for(const entry of entries) {
      await client.query(`INSERT INTO echo_round_scores(round_id,room_id,profile_id,player_name,score,reached_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(round_id,room_id,profile_id)
      DO UPDATE SET player_name=EXCLUDED.player_name,
      score=echo_round_scores.score+EXCLUDED.score,reached_at=EXCLUDED.reached_at`,
      [roundId,roomId,entry.identity,entry.name,entry.points,entry.reachedAt]);
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
async function finalizeRoom(pool,roundId,roomId) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const claim=await client.query('INSERT INTO echo_round_finalized(round_id,room_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING round_id',[roundId,roomId]);
    if (!claim.rowCount) {await client.query('COMMIT');return [];}
    const result=await client.query('SELECT profile_id,player_name,score,reached_at FROM echo_round_scores WHERE round_id=$1 AND room_id=$2',[roundId,roomId]);
    const ranks=rankParticipants(result.rows);
    // Restrict minting to actual registered accounts, even if old guest rows exist.
    const verified=await client.query('SELECT id::text AS id FROM echo_accounts WHERE id::text = ANY($1::text[])',[ranks.map(item=>accountIdFromScore(item.profile_id)).filter(Boolean)]);
    const registered=new Set(verified.rows.map(row=>row.id));
    for(const item of ranks){
      const accountId=accountIdFromScore(item.profile_id);
      if(!accountId || !registered.has(accountId))item.coins=0;
    }
    for(const item of ranks) {
      const accountId=accountIdFromScore(item.profile_id);
      if(item.coins>0&&accountId) {
        // Concurrent finalizers serialize through this unique insert.
        const award=await client.query(
          'INSERT INTO echo_round_account_awards(round_id,account_id) VALUES($1,$2::uuid) ON CONFLICT DO NOTHING RETURNING account_id',
          [roundId,accountId]);
        if(!award.rowCount)item.coins=0;
      }
      await client.query('INSERT INTO echo_coin_ledger(round_id,room_id,profile_id,place,score,coins) VALUES($1,$2,$3,$4,$5,$6)',
        [roundId,roomId,item.profile_id,item.place,item.score,item.coins]);
      if(item.coins>0)await client.query(`INSERT INTO echo_wallets(profile_id,coins) VALUES($1,$2)
        ON CONFLICT(profile_id) DO UPDATE SET coins=echo_wallets.coins+EXCLUDED.coins`,[accountId,item.coins]);
    }
    await client.query('COMMIT');
    return ranks;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
async function finalizeOverdue(pool,now) {
  const cutoff=Math.floor(now/(15*60*1000))*(15*60*1000);
  const rooms=await pool.query(`SELECT DISTINCT s.round_id,s.room_id FROM echo_round_scores s
  LEFT JOIN echo_round_finalized f ON f.round_id=s.round_id AND f.room_id=s.room_id
  WHERE s.round_id < $1 AND f.round_id IS NULL ORDER BY s.round_id,s.room_id`,[cutoff]);
  for(const room of rooms.rows) await finalizeRoom(pool,room.round_id,room.room_id);
}
async function getRecentResults(pool,profileId) {
  const result=await pool.query(`SELECT round_id,room_id,place,score,coins FROM echo_coin_ledger
    WHERE profile_id=$1 ORDER BY round_id DESC LIMIT 10`,[profileId]);
  return result.rows;
}
module.exports={rewardForPlace,rankParticipants,accountIdFromScore,initialize,writeTick,finalizeRoom,finalizeOverdue,getRecentResults};

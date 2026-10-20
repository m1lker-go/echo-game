const express = require('express');
const cors = require('cors');
const http = require('node:http');
const { Server } = require('socket.io');
require('dotenv').config();

const { pool, checkDatabase } = require('./db');
const { normalizePlayerName } = require('./player-name');
const { roundWindow, createRoomManager } = require('./room-manager');
const roundRewards = require('./round-rewards');
const echoAuth = require('./auth');

const app = express();
const server = http.createServer(app);

const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(v => v.trim()) }));
app.use(express.json());
app.use('/api/auth', echoAuth.router);

const io = new Server(server, {
  cors: {
    origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(v => v.trim()),
    methods: ['GET', 'POST'],
  },
});

// The clock is intentionally informational until room gameplay is integrated.
function currentRoundClock(now = Date.now()) {
  return { ...roundWindow(now), serverNow: now };
}

app.get('/api/round-clock', (_req, res) => {
  res.json(currentRoundClock());
});

app.get('/health', async (_req, res) => {
  try {
    const database = await checkDatabase();
    res.status(200).json({
      ok: true,
      service: 'echo-server',
      database: database ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  } catch (_error) {
    res.status(503).json({
      ok: false,
      service: 'echo-server',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/daily-activity', async (req, res) => {
  const profileId = normalizeActivityProfileId(req.query.profileId);
  if (!profileId) return res.status(400).json({ error: 'Invalid profileId' });
  const today = dailyDateKey();
  try {
    await ensureDailyActivityRow(profileId, today);
    const result = await pool.query(
      'SELECT activity_date, play_seconds, food_collected, pvp_wins FROM echo_daily_activity WHERE profile_id = $1 AND activity_date = $2::date',
      [profileId, today]
    );
    const activity = result.rows[0];
    return res.json({
      date: today,
      timezone: DAILY_TIME_ZONE,
      playSeconds: Number(activity?.play_seconds || 0),
      foodCollected: Number(activity?.food_collected || 0),
      pvpWins: Number(activity?.pvp_wins || 0),
      profileId,
    });
  } catch (error) {
    console.error('[daily-activity] read failed:', error.message);
    return res.status(500).json({ error: 'Daily activity unavailable' });
  }
});

const DAILY_TIME_ZONE = process.env.DAILY_TIME_ZONE || 'Europe/Moscow';
const ACTIVE_PING_MAX_GAP_MS = 45000;
const DAILY_ACTIVITY_FIELDS = new Set(['food_collected', 'pvp_wins']);
const dailyActivityProfileIds = new Map();
const activityProfileSockets = new Map();
function dailyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}
function normalizeActivityProfileId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value) ? value : null;
}
function claimActivityProfileSocket(socket, profileId) {
  if (!profileId) return;
  const previousSocketId = activityProfileSockets.get(profileId);
  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) {
      console.log(`[socket] replacing duplicate profile session: ${previousSocketId} -> ${socket.id}`);
      previousSocket.disconnect(true);
    }
  }
  activityProfileSockets.set(profileId, socket.id);
}
async function ensureDailyActivitySchema() {
  await pool.query('CREATE TABLE IF NOT EXISTS echo_daily_activity (profile_id TEXT NOT NULL, activity_date DATE NOT NULL, play_seconds INTEGER NOT NULL DEFAULT 0 CHECK (play_seconds >= 0), food_collected INTEGER NOT NULL DEFAULT 0 CHECK (food_collected >= 0), pvp_wins INTEGER NOT NULL DEFAULT 0 CHECK (pvp_wins >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (profile_id, activity_date))');
}
async function ensureDailyActivityRow(profileId, dateKey) {
  if (!profileId) return;
  await pool.query('INSERT INTO echo_daily_activity (profile_id, activity_date) VALUES ($1, $2::date) ON CONFLICT (profile_id, activity_date) DO NOTHING', [profileId, dateKey]);
}
async function addDailyActivity(profileId, field, amount) {
  if (!profileId || !DAILY_ACTIVITY_FIELDS.has(field)) return;
  const n = Math.max(0, Math.min(100000, Math.floor(Number(amount) || 0)));
  if (!n) return;
  await pool.query('INSERT INTO echo_daily_activity (profile_id, activity_date, ' + field + ') VALUES ($1, $2::date, $3) ON CONFLICT (profile_id, activity_date) DO UPDATE SET ' + field + ' = LEAST(echo_daily_activity.' + field + ' + EXCLUDED.' + field + ', 100000), updated_at = NOW()', [profileId, dailyDateKey(), n]);
}
async function addDailyPlaySeconds(profileId, seconds, dateKey) {
  const n = Math.max(0, Math.min(60, Math.floor(Number(seconds) || 0)));
  if (!profileId || !n) return;
  await pool.query('INSERT INTO echo_daily_activity (profile_id, activity_date, play_seconds) VALUES ($1, $2::date, $3) ON CONFLICT (profile_id, activity_date) DO UPDATE SET play_seconds = LEAST(echo_daily_activity.play_seconds + EXCLUDED.play_seconds, 86400), updated_at = NOW()', [profileId, dateKey, n]);
}


// Secure pack rolls: no rewards are accepted from the browser.
const packRandom=require('node:crypto');
const PACK_WEIGHTS={
 coin:{common:60,uncommon:27,rare:10,epic:2.5,legendary:.5},
 premium:{common:0,uncommon:28,rare:39,epic:26,legendary:7}
};
const PACK_RARITY_LIMIT={common:4,uncommon:3,rare:3,epic:2,legendary:1};
function pickWeighted(items,getWeight){
 const total=items.reduce((sum,item)=>sum+getWeight(item),0);
 let ticket=packRandom.randomInt(0,1000000000)/1000000000*total;
 for(const item of items){ticket-=getWeight(item);if(ticket<0)return item;}
 return items[items.length-1];
}
function rollSecurePack(type){
 const weights=PACK_WEIGHTS[type],poolModels=Object.keys(HERO_RARITIES).filter(m=>weights[HERO_RARITIES[m]]>0);
 const used={common:0,uncommon:0,rare:0,epic:0,legendary:0},cards=[];
 for(let i=0;i<5;i++){
  const allowed=Object.keys(weights).filter(r=>weights[r]>0&&used[r]<PACK_RARITY_LIMIT[r]&&poolModels.some(m=>HERO_RARITIES[m]===r));
  const rarity=pickWeighted(allowed,r=>weights[r]),options=poolModels.filter(m=>HERO_RARITIES[m]===rarity);
  const model=options[packRandom.randomInt(options.length)];
  poolModels.splice(poolModels.indexOf(model),1);used[rarity]++;
  cards.push({model,rarity,count:1});
 }
 for(let i=5;i<(type==='premium'?15:5);i++)pickWeighted(cards,c=>weights[c.rarity]).count++;
 return cards;
}
app.post('/api/packs/coin/open',async(req,res)=>{
 let client;
 try{
  const accountId=await heroAccount(req,res);if(!accountId)return;
  client=await pool.connect();await client.query('BEGIN');
  const wallet=await client.query('UPDATE echo_wallets SET coins=coins-50 WHERE profile_id=$1 AND coins>=50 RETURNING coins',[String(accountId)]);
  if(!wallet.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Insufficient ECHO Coin'});}
  const cards=rollSecurePack('coin');
  for(const card of cards)await client.query(
   'INSERT INTO echo_hero_collection(account_id,model,fragments) VALUES($1,$2,$3) ON CONFLICT(account_id,model) DO UPDATE SET fragments=echo_hero_collection.fragments+EXCLUDED.fragments',
   [String(accountId),card.model,card.count]);
  await client.query('COMMIT');
  res.json({cards,balance:Number(wallet.rows[0].coins)});
 }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('[packs] purchase failed',error);res.status(500).json({error:'Pack purchase failed'});}
 finally{client?.release();}
});

// Server-authoritative character collection. Demo pack openings never grant fragments.
const HERO_RARITIES = Object.freeze({
 'character-female-a.glb':'common','character-female-b.glb':'common',
 'character-female-c.glb':'common','character-female-d.glb':'uncommon',
 'character-female-e.glb':'common','character-female-f.glb':'common',
 'character-male-a.glb':'common','character-male-b.glb':'uncommon',
 'character-male-c.glb':'rare','character-male-d.glb':'rare',
 'character-male-e.glb':'uncommon','character-male-f.glb':'uncommon',
 'character-ghost.glb':'legendary','character-keeper.glb':'rare',
 'character-skeleton.glb':'legendary','character-zombie.glb':'epic',
 'character-human.glb':'rare','character-orc.glb':'epic',
});
const HERO_REQUIREMENTS=Object.freeze({common:25,uncommon:30,rare:40,epic:50,legendary:60});
async function heroAccount(req,res){
 const user=await echoAuth.sessionUser(req);
 if(!user){res.status(401).json({error:'Unauthorized'});return null;}
 return user.id;
}
async function heroCollection(accountId, db=pool){
 const result=await db.query('SELECT model,fragments,claimed FROM echo_hero_collection WHERE account_id=$1',[accountId]);
 return Object.fromEntries(result.rows.map(row=>[row.model,{fragments:Number(row.fragments),claimed:row.claimed}]));
}
app.get('/api/heroes',async(req,res)=>{
 try{
  const id=await heroAccount(req,res);if(!id)return;
  res.json({heroes:await heroCollection(id)});
 }catch(error){console.error('[heroes] read failed',error);res.status(500).json({error:'Collection unavailable'});}
});
app.post('/api/heroes/claim',async(req,res)=>{
 let client;
 try{
  const id=await heroAccount(req,res);if(!id)return;
  const model=req.body?.model,rarity=HERO_RARITIES[model];
  if(!rarity)return res.status(400).json({error:'Unknown hero'});
  client=await pool.connect();
  await client.query('BEGIN');
  const row=await client.query('SELECT fragments,claimed FROM echo_hero_collection WHERE account_id=$1 AND model=$2 FOR UPDATE',[id,model]);
  const entry=row.rows[0];
  if(!entry||entry.claimed||Number(entry.fragments)<HERO_REQUIREMENTS[rarity]){
   await client.query('ROLLBACK');
   return res.status(409).json({error:'Not enough fragments or already claimed'});
  }
  await client.query('UPDATE echo_hero_collection SET claimed=TRUE WHERE account_id=$1 AND model=$2',[id,model]);
  await client.query('COMMIT');
  res.json({model,claimed:true,fragments:Number(entry.fragments)});
 }catch(error){
  if(client)await client.query('ROLLBACK').catch(()=>{});
  console.error('[heroes] claim failed',error);
  res.status(500).json({error:'Claim unavailable'});
 }finally{client?.release();}
});

// Account-bound daily quests. Targets accumulate throughout the Moscow day.
const DAILY_QUESTS = Object.freeze([
  { id: 'play', column: 'play_seconds', targets: [300,600,1800,2700,3600] },
  { id: 'food', column: 'food_collected', targets: [50,200,500,1000,2000] },
  { id: 'pvp', column: 'pvp_wins', targets: [3,7,12,18,25] },
  // Pack purchases are deliberately not awarded by demo-pack interactions.
  { id: 'pack_coin', column: null, targets: [1], reward: 5 },
  { id: 'pack_premium', column: null, targets: [1], reward: 50 },
]);
const QUEST_LEVEL_REWARDS = [2,4,6,8,10];
const questKey = (id, level) => id + ':' + level;
async function questAccount(req, res) {
  const user = await echoAuth.sessionUser(req);
  if (!user) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  return user.id;
}
async function getDailyQuests(accountId) {
  const date = dailyDateKey();
  await ensureDailyActivityRow(accountId, date);
  const [activityResult, claimsResult] = await Promise.all([
    pool.query('SELECT play_seconds, food_collected, pvp_wins FROM echo_daily_activity WHERE profile_id=$1 AND activity_date=$2::date', [accountId, date]),
    pool.query('SELECT quest_id FROM echo_daily_quest_claims WHERE profile_id=$1 AND quest_date=$2::date', [accountId, date]),
  ]);
  const activity = activityResult.rows[0] || {};
  const claimed = new Set(claimsResult.rows.map(row => row.quest_id));
  return { date, timezone: DAILY_TIME_ZONE, quests: DAILY_QUESTS.map(quest => {
    const count = quest.targets.length;
    let level = quest.targets.findIndex((_, i) => !claimed.has(questKey(quest.id, i+1)));
    if (level === -1) level = count-1;
    const done = quest.targets.every((_, i) => claimed.has(questKey(quest.id, i+1)));
    const target = quest.targets[level];
    const progress = quest.column ? Math.min(target, Number(activity[quest.column] || 0)) : 0;
    return { id: quest.id, level: level+1, levels: count, target, progress,
      reward: quest.reward ?? QUEST_LEVEL_REWARDS[level], claimed: done, available: !!quest.column };
  }) };
}
app.get('/api/daily-quests', async (req, res) => {
  try {
    const accountId = await questAccount(req,res);
    if (accountId) res.json(await getDailyQuests(accountId));
  } catch(error) {
    console.error('[daily-quests] read failed:', error.message);
    res.status(500).json({ error: 'Daily quests unavailable' });
  }
});
app.post('/api/daily-quests/claim', async (req, res) => {
  let client;
  try {
    const accountId = await questAccount(req,res);
    if (!accountId) return;
    const quest = DAILY_QUESTS.find(q => q.id === req.body?.questId);
    if (!quest) return res.status(400).json({ error: 'Invalid quest' });
    if (!quest.column) return res.status(409).json({ error: 'Purchase not available yet' });
    const date = dailyDateKey();
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize claims per account/date, including simultaneous browser sessions.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',[accountId,date]);
    const existing = await client.query(
      'SELECT quest_id FROM echo_daily_quest_claims WHERE profile_id=$1 AND quest_date=$2::date AND quest_id LIKE $3',
      [accountId,date,quest.id+':%']);
    const claimed = new Set(existing.rows.map(row=>row.quest_id));
    const levelIndex = quest.targets.findIndex((_,i)=>!claimed.has(questKey(quest.id,i+1)));
    if (levelIndex < 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ...(await getDailyQuests(accountId)), claimedNow:false });
    }
    const target = quest.targets[levelIndex];
    const activity = await client.query(
      'SELECT ' + quest.column + ' AS progress FROM echo_daily_activity WHERE profile_id=$1 AND activity_date=$2::date',
      [accountId,date]);
    if (Number(activity.rows[0]?.progress||0) < target) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ...(await getDailyQuests(accountId)), claimedNow:false });
    }
    await client.query(
      'INSERT INTO echo_daily_quest_claims(profile_id,quest_date,quest_id) VALUES($1,$2::date,$3)',
      [accountId,date,questKey(quest.id,levelIndex+1)]);
    const reward = QUEST_LEVEL_REWARDS[levelIndex];
    await client.query(
      'INSERT INTO echo_wallets(profile_id,coins) VALUES($1,$2) ON CONFLICT(profile_id) DO UPDATE SET coins=echo_wallets.coins+EXCLUDED.coins',
      [accountId,reward]);
    await client.query('COMMIT');
    client.release();client=null;
    res.json({ ...(await getDailyQuests(accountId)), claimedNow:true, reward });
  } catch(error) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    console.error('[daily-quests] claim failed:', error.message);
    res.status(500).json({ error: 'Daily claim unavailable' });
  } finally { if(client) client.release(); }
});

const players = new Map();
const roomManager = createRoomManager();
const roomFood = new Map();
function roomKey(player) { return `echo:${player.roundId}:${player.roomId}`; }
function ensureRoomFood(roundId, roomId) {
  const key = `echo:${roundId}:${roomId}`;
  if (!roomFood.has(key)) roomFood.set(key, new Map(Array.from({ length: FOOD_COUNT }, (_, id) => [id, createFoodPoint(id)])));
  return roomFood.get(key);
}

const activeFights = new Map();
const MAX_COORDINATE = 1_000_000;
const WORLD_CELL_SIZE = 84;
const WORLD_SIZE_CELLS = 50;
const WORLD_HALF_SIZE = (WORLD_CELL_SIZE * WORLD_SIZE_CELLS) / 2;
const MAX_ENERGY = 1_000_000;
const FIGHT_DISTANCE = 72;
const FIGHT_DURATION = 1000;
const ALLOWED_SKINS = new Set([
  'character-female-a.glb', 'character-female-b.glb', 'character-female-c.glb',
  'character-female-d.glb', 'character-female-e.glb', 'character-female-f.glb',
  'character-male-a.glb', 'character-male-b.glb', 'character-male-c.glb',
  'character-male-d.glb', 'character-male-e.glb', 'character-male-f.glb',
  'character-ghost.glb',
  'character-keeper.glb',
  'character-skeleton.glb',
  'character-zombie.glb',
  'character-human.glb',
  'character-orc.glb',
]);


const STARTER_SKINS = new Set(['character-female-b.glb','character-male-a.glb','character-female-c.glb']);
const GUEST_SKINS = new Set(['character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-e.glb','character-female-f.glb','character-male-a.glb']);
function allowedPlayerSkin(socket,skin){
 return ALLOWED_SKINS.has(skin) &&
   (socket.data.verifiedAccountId ? (STARTER_SKINS.has(skin)||socket.data.claimedHeroes?.has(skin)) : GUEST_SKINS.has(skin));
}
function defaultPlayerSkin(socket){
 return socket.data.verifiedAccountId?'character-female-b.glb':'character-female-a.glb';
}

const FOOD_COUNT = 1000;
const FOOD_COLLECT_RADIUS = 60;
const FOOD_RESPAWN_MIN_MS = 10_000;
const FOOD_RESPAWN_MAX_MS = 25_000;

// The server creates one stable seeded layout shared by every player.
const WORLD_SEED = 847291;
const TREE_COUNT = 42;
const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 2.5;
// tree.glb bounding box: X=0.650015, Z=0.651140 model units.
// Client renders the GLB at base scale 50, so the horizontal radius at
// factor 1.0 is half of the scaled maximum X/Z dimension (~16.28).
const TREE_BASE_SCALE = 50;
const TREE_MODEL_WIDTH = 0.6500152945518494;
const TREE_MODEL_DEPTH = 0.6511395573616028;
const TREE_COLLISION_RADIUS = Math.max(TREE_MODEL_WIDTH, TREE_MODEL_DEPTH) * TREE_BASE_SCALE / 2;
const TREE_FOOD_CLEARANCE = 32;
const TREE_PLAYER_CLEARANCE = 24;
const PLAYER_COLLISION_RADIUS = 24;
function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
// Seven shared water patches. Use a separate seeded RNG so water placement
// does not change the existing tree/food layout. Large coefficients are spread
// across the whole playable field instead of clustering around the center.
const WATER_COUNT = 7;
const WATER_DAMAGE_INTERVAL_EDGE_MS = 600;
const WATER_DAMAGE_INTERVAL_CENTER_MS = 300;
const WATER_DAMAGE_AMOUNT = 1;
const WATER_MODEL_BASE_SCALE = 50;
const WATER_SCALE_MIN = 7;
const WATER_SCALE_MAX = 12;
const WATER_GEOMETRY = require('../shared/water-hazard-contours');
const { worldPointToLocalWater, projectWaterContour } = require('../shared/water-visual-space');
function getWaterGeometry(water) { return { vertices: WATER_GEOMETRY[water.model] || WATER_GEOMETRY['patch-water-large.glb'] }; }
function getWaterScale(water) { return WATER_MODEL_BASE_SCALE * water.scale; }
function isPointInPolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(xi, xj) - 1e-7 && x <= Math.max(xi, xj) + 1e-7 && y >= Math.min(yi, yj) - 1e-7 && y <= Math.max(yi, yj) + 1e-7) return true;
  }
  return inside;
}
function getWaterWorldContour(water) {
  return water.worldContour || projectWaterContour(water, getWaterGeometry(water).vertices);
}
function getWaterFootprint(water) {
  let halfWidth = 0, halfDepth = 0;
  for (const [x, y] of getWaterWorldContour(water)) {
    halfWidth = Math.max(halfWidth, Math.abs(x - water.x));
    halfDepth = Math.max(halfDepth, Math.abs(y - water.y));
  }
  return { halfWidth, halfDepth };
}
function getWaterLocalPosition(position, water) {
  return worldPointToLocalWater(position, water);
}
function distanceToWaterSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a[0], point.y - a[1]);
  const t = Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / lengthSquared));
  return Math.hypot(point.x - (a[0] + t * dx), point.y - (a[1] + t * dy));
}
function getWaterBoundaryDistanceLocal(point, vertices) {
  let minDistance = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    minDistance = Math.min(minDistance, distanceToWaterSegment(point, vertices[i], vertices[(i + 1) % vertices.length]));
  }
  return minDistance;
}
function getWaterDamageDepth(water) {
  if (Number.isFinite(water.damageDepth) && water.damageDepth > 0) return water.damageDepth;
  const vertices = getWaterGeometry(water).vertices;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // Estimate maximum polygon depth from its actual contour, not the model center.
  const samplesPerAxis = 40;
  let deepestDistance = 0;
  for (let yi = 0; yi <= samplesPerAxis; yi += 1) {
    const y = minY + (maxY - minY) * yi / samplesPerAxis;
    for (let xi = 0; xi <= samplesPerAxis; xi += 1) {
      const x = minX + (maxX - minX) * xi / samplesPerAxis;
      if (!isPointInPolygon(x, y, vertices)) continue;
      deepestDistance = Math.max(deepestDistance, getWaterBoundaryDistanceLocal({ x, y }, vertices));
    }
  }
  water.damageDepth = deepestDistance || 1;
  return water.damageDepth;
}
function getWaterDamageInterval(position, water) {
  const local = getWaterLocalPosition(position, water);
  const vertices = getWaterGeometry(water).vertices;
  const depthRatio = Math.max(0, Math.min(1,
    getWaterBoundaryDistanceLocal(local, vertices) / getWaterDamageDepth(water)
  ));
  return Math.round(
    WATER_DAMAGE_INTERVAL_EDGE_MS +
    (WATER_DAMAGE_INTERVAL_CENTER_MS - WATER_DAMAGE_INTERVAL_EDGE_MS) * depthRatio
  );
}
function isPointOnWater(position, water) {
  const local = getWaterLocalPosition(position, water);
  return isPointInPolygon(local.x, local.y, getWaterGeometry(water).vertices);
}
function createWorldWaters() {
  const waters = [];
  const waterRandom = createSeededRandom(WORLD_SEED + 918273);
  const randomWaterBetween = (min, max) => min + waterRandom() * (max - min);
  const variants = ['patch-water.glb', 'patch-water.glb', 'patch-water.glb', 'patch-water-large.glb', 'patch-water-large.glb', 'patch-water-large.glb', 'patch-water-large.glb'];

  // Keep the existing count, but distribute targets across the four quadrants
  // so the larger puddles cover the whole map, including outer areas.
  const sectors = [
    { minX: -1, maxX: -0.15, minY: -1, maxY: -0.15 },
    { minX: 0.15, maxX: 1, minY: -1, maxY: -0.15 },
    { minX: -1, maxX: -0.15, minY: 0.15, maxY: 1 },
    { minX: 0.15, maxX: 1, minY: 0.15, maxY: 1 },
    { minX: -1, maxX: 1, minY: -1, maxY: -0.15 },
    { minX: -1, maxX: 1, minY: 0.15, maxY: 1 },
    { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  ];

  for (let index = 0; index < WATER_COUNT; index += 1) {
    const model = variants[index];
    const scale = randomWaterBetween(WATER_SCALE_MIN, WATER_SCALE_MAX);
    const candidateWater = {
      id: `water_${String(index + 1).padStart(2, '0')}`,
      type: 'water',
      model,
      x: 0,
      y: 0,
      scale,
      rotation: randomWaterBetween(0, Math.PI * 2),
      collisionRadius: 0,
    };
    const footprint = getWaterFootprint(candidateWater);
    const sector = sectors[index];
    const minX = Math.max(-WORLD_HALF_SIZE + footprint.halfWidth + 60, sector.minX * (WORLD_HALF_SIZE - footprint.halfWidth - 60));
    const maxX = Math.min(WORLD_HALF_SIZE - footprint.halfWidth - 60, sector.maxX * (WORLD_HALF_SIZE - footprint.halfWidth - 60));
    const minY = Math.max(-WORLD_HALF_SIZE + footprint.halfDepth + 60, sector.minY * (WORLD_HALF_SIZE - footprint.halfDepth - 60));
    const maxY = Math.min(WORLD_HALF_SIZE - footprint.halfDepth - 60, sector.maxY * (WORLD_HALF_SIZE - footprint.halfDepth - 60));
    let candidate = null;

    for (let attempt = 0; attempt < 2500; attempt += 1) {
      const point = {
        x: randomWaterBetween(minX, maxX),
        y: randomWaterBetween(minY, maxY),
      };
      candidateWater.x = point.x;
      candidateWater.y = point.y;
      const rotatedFootprint = Math.hypot(footprint.halfWidth, footprint.halfDepth);
      if (waters.some(other => Math.hypot(point.x - other.x, point.y - other.y) <
        rotatedFootprint + Math.hypot(getWaterFootprint(other).halfWidth, getWaterFootprint(other).halfDepth) + 20)) continue;
      candidate = { ...candidateWater, collisionRadius: rotatedFootprint };
      break;
    }

    if (!candidate) {
      // With very large puddles, avoid startup failure by allowing separation
      // based on the visible centers while still keeping each patch in bounds.
      const point = {
        x: randomWaterBetween(-WORLD_HALF_SIZE + footprint.halfWidth + 60, WORLD_HALF_SIZE - footprint.halfWidth - 60),
        y: randomWaterBetween(-WORLD_HALF_SIZE + footprint.halfDepth + 60, WORLD_HALF_SIZE - footprint.halfDepth - 60),
      };
      candidateWater.x = point.x;
      candidateWater.y = point.y;
      candidate = { ...candidateWater, collisionRadius: Math.hypot(footprint.halfWidth, footprint.halfDepth) };
    }
    // Cache the visible water footprint for server-side checks and snapshots.
    candidate.worldContour = getWaterWorldContour(candidate);
    waters.push(candidate);
  }

  return waters;
}
const WORLD_WATERS = createWorldWaters();
function isInWater(position) {
  return WORLD_WATERS.some(water => isPointOnWater(position, water));
}


const worldRandom = createSeededRandom(WORLD_SEED);
const randomBetween = (min, max) => min + worldRandom() * (max - min);
function overlapsCircle(a, b, radiusA, radiusB, allowedOverlap = 0) {
  return Math.hypot(a.x - b.x, a.y - b.y) < Math.max(0, radiusA + radiusB - allowedOverlap);
}
function createWorldTrees(waters) {
  const trees = [];
  const clusterSizes = [2, 3, 5, 7];
  const clusterCount = 12;
  const maxAttemptsPerCluster = 160;
  let nextId = 1;

  const makeTree = (x, y, scale, placementRadius = 100 * scale) => ({
    id: `tree_${String(nextId++).padStart(3, '0')}`,
    type: 'tree',
    x,
    y,
    scale,
    collisionRadius: TREE_COLLISION_RADIUS * scale,
    placementRadius,
    rotation: randomBetween(0, Math.PI * 2),
  });

  const trunksOverlap = (candidate, other, clearance = 12) =>
    Math.hypot(candidate.x - other.x, candidate.y - other.y) <
    candidate.collisionRadius + other.collisionRadius + clearance;

  const isInsidePlayableArea = (x, y, margin = 160) =>
    Math.abs(x) <= WORLD_HALF_SIZE - margin &&
    Math.abs(y) <= WORLD_HALF_SIZE - margin;

  const isNearSpawn = (x, y) => Math.hypot(x, y) < 440;

  const distanceToSegment = (point, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - a[0], point.y - a[1]);
    const t = Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / lengthSquared));
    return Math.hypot(point.x - (a[0] + t * dx), point.y - (a[1] + t * dy));
  };

  // Reject a tree only when its actual collision circle intersects a water
  // polygon. Tangency is allowed; there is intentionally no extra margin.
  const treeOverlapsWater = (tree) => waters.some(water => {
    if (isPointOnWater(tree, water)) return true;
    // A tree's collision radius is expressed in world units. Compute segment
    // clearance in the same space, not in unprojected model coordinates.
    const vertices = getWaterWorldContour(water);
    let minDistance = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      minDistance = Math.min(minDistance, distanceToSegment(
        tree, vertices[i], vertices[(i + 1) % vertices.length]
      ));
    }
    return minDistance < tree.collisionRadius;
  });

  const canPlace = (candidate, existing, gapFactor = 0.4) => {
    if (!isInsidePlayableArea(candidate.x, candidate.y) ||
        isNearSpawn(candidate.x, candidate.y) ||
        treeOverlapsWater(candidate)) return false;
    return !existing.some(other => overlapsCircle(
      candidate,
      other,
      candidate.placementRadius,
      other.placementRadius,
      Math.min(candidate.placementRadius, other.placementRadius) * gapFactor
    ));
  };

  for (let clusterIndex = 0; clusterIndex < clusterCount && trees.length < 90; clusterIndex += 1) {
    const clusterSize = clusterSizes[Math.floor(worldRandom() * clusterSizes.length)];
    let clusterPlaced = false;

    for (let attempt = 0; attempt < maxAttemptsPerCluster && !clusterPlaced; attempt += 1) {
      const centerX = randomBetween(-WORLD_HALF_SIZE + 420, WORLD_HALF_SIZE - 420);
      const centerY = randomBetween(-WORLD_HALF_SIZE + 420, WORLD_HALF_SIZE - 420);
      if (isNearSpawn(centerX, centerY)) continue;

      const cluster = [];
      let failed = false;

      for (let i = 0; i < clusterSize; i += 1) {
        let candidate = null;
        for (let memberAttempt = 0; memberAttempt < 100; memberAttempt += 1) {
          const angle = randomBetween(0, Math.PI * 2);
          const distance = randomBetween(35, 125);
          const scale = randomBetween(TREE_SCALE_MIN, TREE_SCALE_MAX);
          const placementRadius = 38 * scale;
          const attemptTree = makeTree(
            centerX + Math.cos(angle) * distance,
            centerY + Math.sin(angle) * distance,
            scale,
            placementRadius
          );

          if (!isInsidePlayableArea(attemptTree.x, attemptTree.y) ||
              isNearSpawn(attemptTree.x, attemptTree.y) ||
              treeOverlapsWater(attemptTree) ||
              trees.some(other => overlapsCircle(
                attemptTree,
                other,
                attemptTree.placementRadius,
                other.placementRadius,
                Math.min(attemptTree.placementRadius, other.placementRadius) * 0.4
              )) ||
              cluster.some(other => trunksOverlap(attemptTree, other))) {
            continue;
          }
          candidate = attemptTree;
          break;
        }

        if (!candidate) {
          failed = true;
          break;
        }
        cluster.push(candidate);
      }

      if (!failed && cluster.length === clusterSize) {
        trees.push(...cluster);
        clusterPlaced = true;
      }
    }
  }

  const targetCount = 90;
  for (let attempt = 0; attempt < targetCount * 220 && trees.length < targetCount; attempt += 1) {
    const scale = randomBetween(TREE_SCALE_MIN, TREE_SCALE_MAX);
    const candidate = makeTree(
      randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160),
      randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160),
      scale
    );
    if (canPlace(candidate, trees)) trees.push(candidate);
  }

  return trees;
}
const WORLD_TREES = createWorldTrees(WORLD_WATERS);

// Damage is based only on the actual water polygon contour. No body radius,
// center-distance shortcut, or extra shoreline buffer is used.
setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    if (!player || player.defeated || player.fightingWith) continue;
    const water = WORLD_WATERS.find(candidate => isPointOnWater(player, candidate));
    if (!water) {
      player.inWater = false;
      player.lastWaterDamageAt = 0;
      continue;
    }
    const damageInterval = getWaterDamageInterval(player, water);
    if (!player.inWater) {
      player.inWater = true;
      player.lastWaterDamageAt = now;
      continue;
    }
    if (now - player.lastWaterDamageAt < damageInterval) continue;
    const damageTicks = Math.floor((now - player.lastWaterDamageAt) / damageInterval);
    player.energy = Math.max(0, player.energy - damageTicks * WATER_DAMAGE_AMOUNT);
    player.lastWaterDamageAt += damageTicks * damageInterval;
  }
}, WATER_DAMAGE_INTERVAL_CENTER_MS);
function createWorldSnapshot() {
  return {
    seed: WORLD_SEED,
    trees: WORLD_TREES.map(({ id, type, x, y, scale, rotation, collisionRadius }) => ({ id, type, x, y, scale, rotation, collisionRadius })),
    // Client collision and red debug overlay consume this exact server polygon.
    waters: WORLD_WATERS.map(({ id, type, model, x, y, scale, rotation, collisionRadius, worldContour }) => ({
      id, type, model, x, y, scale, rotation, collisionRadius,
      serverContourWorld: worldContour,
    })),
  };
}
function isBlockedByTree(position, clearance = 0) {
  return WORLD_TREES.some(tree =>
    Math.hypot(position.x - tree.x, position.y - tree.y) < tree.collisionRadius + clearance
  );
}
function isValidFoodPosition(position) {
  return Math.abs(position.x) <= WORLD_HALF_SIZE - 40 &&
    Math.abs(position.y) <= WORLD_HALF_SIZE - 40 &&
    !isBlockedByTree(position, TREE_FOOD_CLEARANCE);
}
function isValidPlayerPosition(position) {
  return Math.abs(position.x) <= WORLD_HALF_SIZE &&
    Math.abs(position.y) <= WORLD_HALF_SIZE &&
    !isBlockedByTree(position, TREE_PLAYER_CLEARANCE);
}
function findOpenPlayerSpawn() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const point = {
      x: randomBetween(-WORLD_HALF_SIZE + 80, WORLD_HALF_SIZE - 80),
      y: randomBetween(-WORLD_HALF_SIZE + 80, WORLD_HALF_SIZE - 80),
    };
    if (isValidPlayerPosition(point)) return point;
  }
  return { x: 0, y: 0 };
}
const {
  createFoodPoint: createFoodPointCore,
  collectFood: collectFoodCore,
  refillFood: refillFoodCore,
  createFoodSnapshot,
} = require('./food');

function createFoodPoint(id) {
  return createFoodPointCore(id, {
    isValidFoodPosition,
    worldHalfSize: WORLD_HALF_SIZE,
    maxAttempts: 5000,
    createCandidate(pointId) {
      return {
        id: pointId,
        x: randomBetween(-WORLD_HALF_SIZE + 60, WORLD_HALF_SIZE - 60),
        y: randomBetween(-WORLD_HALF_SIZE + 60, WORLD_HALF_SIZE - 60),
        size: 5 + (pointId % 3),
        pulse: pointId * 0.7,
        active: true,
        respawnAt: 0,
      };
    },
  });
}
// Food is allocated lazily per room rather than shared across all players.

function finiteNumber(value, fallback = 0, min = -MAX_COORDINATE, max = MAX_COORDINATE) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function roomPlayers(player) {
  return Array.from(players.values(), candidate => candidate).filter(candidate => candidate.roomId === player.roomId && candidate.roundId === player.roundId);
}
function broadcastPlayers(player) {
  if (!player) return;
  io.to(roomKey(player)).emit('echo:players', roomPlayers(player).map(p => ({ ...p })));
}
function broadcastFood(player) {
  if (!player) return;
  const food = ensureRoomFood(player.roundId, player.roomId);
  io.to(roomKey(player)).emit('echo:food', createFoodSnapshot(food));
}
function collectFood(player) {
  return collectFoodCore(player, ensureRoomFood(player.roundId, player.roomId), {
    radius: FOOD_COLLECT_RADIUS,
    respawnMinMs: FOOD_RESPAWN_MIN_MS,
    respawnMaxMs: FOOD_RESPAWN_MAX_MS,
  });
}
function refillFood() {
  for (const [key, food] of roomFood) {
    const changed = refillFoodCore(food, { createFoodPoint });
    if (changed) io.to(key).emit('echo:food', createFoodSnapshot(food));
  }
}
setInterval(refillFood, 1000);

// Re-seat connected players into fresh rooms at the synchronized boundary.
// Scores/rewards are not enabled yet, so this only resets ephemeral play state.
const roundScores = new Map();
let rewardWriteQueue = Promise.resolve();
let rewardsReady = false;
function queueRewardWork(work) {
  rewardWriteQueue=rewardWriteQueue.then(work).catch(error=>console.error('[echo-coins] database operation failed:',error.message));
  return rewardWriteQueue;
}

const SCORE_BY_PLACE = place => place === 1 ? 50 : place === 2 ? 45 : place === 3 ? 42 : place === 4 ? 40 : place === 5 ? 38 : place <= 10 ? 35 : place <= 15 ? 30 : place <= 20 ? 25 : place <= 30 ? 20 : place <= 40 ? 15 : 10;
function scoreRoomTick() {
  const roundId = roundWindow().id;
  const roomIds = new Set([...players.values()].filter(p => p.roundId === roundId).map(p => p.roomId));
  for (const roomId of roomIds) {
    const key = `${roundId}:${roomId}`;
    if (!roundScores.has(key)) roundScores.set(key, new Map());
    const scores = roundScores.get(key);
    const active = [...players.values()].filter(p => p.roomId === roomId && p.roundId === roundId && !p.defeated);
    active.sort((a,b) => b.energy-a.energy || a.id.localeCompare(b.id));
    const earned=[];
    const scoredAccountIds=new Set();
    for (const [index, player] of active.entries()) {
      const identity = io.sockets.sockets.get(player.id)?.data.roomIdentity || player.id;
      const previous = scores.get(identity) || { identity, name: player.name, score: 0, reachedAt: 0 };
      const points=SCORE_BY_PLACE(index + 1);
      const accountId = io.sockets.sockets.get(player.id)?.data.verifiedAccountId;
      const rewardIdentity = accountId ? 'account:' + accountId : identity;
      if (!accountId || !scoredAccountIds.has(accountId)) {
        earned.push({identity:rewardIdentity,name:player.name,points,reachedAt:Date.now()});
        if (accountId) scoredAccountIds.add(accountId);
      }
      previous.score += points;
      previous.reachedAt = Date.now();
      previous.name = player.name;
      scores.set(identity, previous);
    }
    if (rewardsReady && earned.length) queueRewardWork(()=>roundRewards.writeTick(pool,roundId,roomId,earned));
    const ranked = [...scores.values()].sort((a,b) => b.score-a.score || a.reachedAt-b.reachedAt || a.identity.localeCompare(b.identity));
    const energyRanked = active.map(p=>({ name:p.name, energy:p.energy, identity:io.sockets.sockets.get(p.id)?.data.roomIdentity || p.id }));
    for (const player of active) {
      const socket = io.sockets.sockets.get(player.id);
      if (!socket) continue;
      const identity = socket.data.roomIdentity;
      const emitData = (mode, list, field) => ({
        top: list.slice(0,5).map((p,i)=>({ place:i+1,name:p.name,value:p[field] })),
        me: (()=> { const i=list.findIndex(p=>p.identity===identity); return i<0 ? null : {place:i+1,name:list[i].name,value:list[i][field]}; })()
      });
      socket.emit('echo:leaderboard', { roomId, roundId, playersOnline:active.length, rating:emitData('rating',ranked,'score'), energy:emitData('energy',energyRanked,'energy') });
    }
  }
}
let liveRoundId = roundWindow().id;
function advanceRoomRound() {
  const nextRound = roundWindow();
  if (nextRound.id === liveRoundId) return;
  liveRoundId = nextRound.id;
  // Flush queued points before finalizing the previous round. Rewards are committed exactly once.
  if (rewardsReady) queueRewardWork(async()=>{
    await roundRewards.finalizeOverdue(pool,Date.now());
    for (const socket of io.sockets.sockets.values()) {
      const id=socket.data.verifiedAccountId ? 'account:' + socket.data.verifiedAccountId : socket.data.roomIdentity;
      if(!id)continue;
      const results=await roundRewards.getRecentResults(pool,id);
      if(results.length)socket.emit('echo:roundResults',results.map(item=>({...item,authenticated: Boolean(socket.data.verifiedAccountId)})));
    }
  });
  roundScores.clear();
  activeFights.clear();
  roomFood.clear();
  for (const player of players.values()) {
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) { players.delete(player.id); continue; }
    const oldKey = roomKey(player);
    socket.leave(oldKey);
    const identity = socket.data.roomIdentity || player.id;
    const assignment = roomManager.join(identity);
    if (assignment.status !== 'joined') {
      socket.emit('echo:roomFull', { roomId: assignment.roomId });
      socket.disconnect(true);
      continue;
    }
    player.roundId = assignment.round.id;
    player.roomId = assignment.roomId;
    player.energy = 0;
    player.fightingWith = null;
    player.fightId = null;
    player.defeated = false;
    player.inWater = false;
    player.lastWaterDamageAt = 0;
    const spawn = findOpenPlayerSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    socket.join(roomKey(player));
    socket.emit('echo:room', { roomId: player.roomId, round: assignment.round, occupancy: assignment.occupancy });
    socket.emit('echo:combatResult', { result: 'round-reset', energy: 0 });
  }
  for (const player of players.values()) {
    broadcastPlayers(player);
    broadcastFood(player);
  }
}

function emitFightState(fight) {
  const base = { fightId: fight.id, duration: FIGHT_DURATION };
  io.to(fight.a.id).emit('echo:fight', { ...base, playerA: fight.a.id, playerB: fight.b.id });
  io.to(fight.b.id).emit('echo:fight', { ...base, playerA: fight.b.id, playerB: fight.a.id });
}

function finishFight(fight) {
  if (!activeFights.has(fight.id)) return;
  activeFights.delete(fight.id);

  const a = players.get(fight.a.id);
  const b = players.get(fight.b.id);
  if (!a || !b) {
    if (a) a.fightingWith = null;
    if (b) b.fightingWith = null;
    broadcastPlayers(a || b);
    return;
  }

  const winner = fight.a.energy > fight.b.energy ? fight.a : fight.b;
  const loser = winner === fight.a ? fight.b : fight.a;
  const winnerState = players.get(winner.id);
  const loserState = players.get(loser.id);
  if (!winnerState || !loserState) return;
  const winnerProfileId = dailyActivityProfileIds.get(winnerState.id);
  if (winnerProfileId) addDailyActivity(winnerProfileId, 'pvp_wins', 1).catch((error) => console.error('[daily-activity] PvP write failed:', error.message));
  const winnerAccountId = io.sockets.sockets.get(winnerState.id)?.data.verifiedAccountId;
  if (winnerAccountId) addDailyActivity(winnerAccountId, 'pvp_wins', 1).catch(error => console.error('[daily-quests] PvP write failed:', error.message));

  const winnerEnergyBefore = winnerState.energy;
  const loserEnergy = loserState.energy;
  const reward = Math.round(loserEnergy * 0.30);
  winnerState.energy = Math.min(MAX_ENERGY, winnerEnergyBefore + reward);
  loserState.energy = 0;
  winnerState.fightingWith = null;
  winnerState.fightId = null;
  loserState.fightingWith = null;
  loserState.fightId = null;

  io.to(winnerState.id).emit('echo:combatResult', {
    fightId: fight.id,
    result: 'win',
    energy: winnerState.energy,
    gained: winnerState.energy - winnerEnergyBefore,
    opponentId: loserState.id,
    previousEnergy: winnerEnergyBefore,
  });
  io.to(loserState.id).emit('echo:combatResult', {
    fightId: fight.id,
    result: 'lose',
    energy: 0,
    opponentId: winnerState.id,
  });

  players.delete(loserState.id);
  broadcastPlayers(winnerState);
}

function startFight(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.fightingWith || b.fightingWith || a.defeated || b.defeated) return false;
  if (a.energy === b.energy) return false;

  const fight = {
    id: `${a.id}:${b.id}:${Date.now()}`,
    a: { id: a.id, energy: a.energy },
    b: { id: b.id, energy: b.energy },
  };

  a.fightingWith = b.id;
  b.fightingWith = a.id;
  a.fightId = fight.id;
  b.fightId = fight.id;
  a.vx = 0;
  a.vy = 0;
  b.vx = 0;
  b.vy = 0;
  a.inWater = false;
  a.lastWaterDamageAt = 0;
  b.inWater = false;
  b.lastWaterDamageAt = 0;
  activeFights.set(fight.id, fight);
  emitFightState(fight);
  broadcastPlayers(a);
  setTimeout(() => finishFight(fight), FIGHT_DURATION);
  return true;
}

function checkForFights(source) {
  if (!source || source.fightingWith || source.defeated) return;
  for (const opponent of players.values()) {
    if (opponent.id === source.id || opponent.roomId !== source.roomId || opponent.roundId !== source.roundId || opponent.fightingWith || opponent.defeated) continue;
    if (opponent.energy === source.energy) continue;
    const distance = Math.hypot(source.x - opponent.x, source.y - opponent.y);
    if (distance > FIGHT_DISTANCE) continue;
    if (startFight(source, opponent)) return;
  }
}

// Round transitions happen before broadcasting the fresh server clock.
setInterval(() => {
  advanceRoomRound();
  scoreRoomTick();
  io.emit('echo:roundClock', currentRoundClock());
}, 5000).unref();

// Authenticate optional game-session token on the server; never trust a client nickname.
io.use(async (socket, next) => {
  socket.data.verifiedNickname = null;
  socket.data.verifiedAccountId = null;
  socket.data.claimedHeroes=new Set();
  const token = socket.handshake.auth?.accountToken;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return next();
  try {
    const user = await echoAuth.sessionUser({ headers: { authorization: 'Bearer ' + token } });
    if (user) {
      socket.data.verifiedNickname = user.nickname;
      socket.data.verifiedAccountId = user.id;
      socket.data.claimedHeroes=new Set(Object.entries(await heroCollection(user.id)).filter(([,entry])=>entry.claimed).map(([model])=>model));
    }
  } catch (error) {
    console.error('[socket] account verification unavailable:', error.message);
  }
  next();
});

io.on('connection', (socket) => {
  let activityProfileId = normalizeActivityProfileId(socket.handshake.auth?.activityProfileId);
  if (activityProfileId) claimActivityProfileSocket(socket, activityProfileId);
  let lastPingAt = 0;
  let lastPersistedAt = Date.now();
  let dayKey = dailyDateKey();
  let writeQueue = Promise.resolve();
  const enqueueWrite = (operation) => {
    writeQueue = writeQueue.then(operation).catch((error) => console.error('[daily-activity] write failed:', error.message));
    return writeQueue;
  };
  const collectElapsedTime = (now = Date.now()) => {
    if (!activityProfileId) { lastPersistedAt = now; return; }
    const today = dailyDateKey(new Date(now));
    if (today !== dayKey) {
      lastPersistedAt = now;
      dayKey = today;
      const profileId = activityProfileId;
      enqueueWrite(() => ensureDailyActivityRow(profileId, today));
      return;
    }
    const elapsed = Math.floor((now - lastPersistedAt) / 1000);
    lastPersistedAt = now;
    if (elapsed > 0 && elapsed <= 60) {
      const profileId = activityProfileId;
      const intervalDate = dayKey;
      enqueueWrite(() => addDailyPlaySeconds(profileId, elapsed, intervalDate));
      if (socket.data.verifiedAccountId && players.has(socket.id) && !players.get(socket.id).defeated) {
        const accountId = socket.data.verifiedAccountId;
        enqueueWrite(() => addDailyPlaySeconds(accountId, elapsed, intervalDate));
      }
    }
  };
  const receiveActivityPing = (payload) => {
    const now = Date.now();
    const today = dailyDateKey(new Date(now));
    const requestedProfileId = normalizeActivityProfileId(payload?.activityProfileId);

    if (requestedProfileId && requestedProfileId !== activityProfileId) {
      const previousProfileId = activityProfileId;
      if (previousProfileId && activityProfileSockets.get(previousProfileId) === socket.id) activityProfileSockets.delete(previousProfileId);
      activityProfileId = requestedProfileId;
      claimActivityProfileSocket(socket, activityProfileId);
      dailyActivityProfileIds.set(socket.id, activityProfileId);
      dayKey = today;
      lastPersistedAt = now;
      lastPingAt = 0;
      socket.data.activityPaused = payload?.active === false;
      enqueueWrite(() => ensureDailyActivityRow(activityProfileId, today));
    }

    if (!activityProfileId) return;
    if (today !== dayKey) {
      dayKey = today;
      lastPersistedAt = now;
      enqueueWrite(() => ensureDailyActivityRow(activityProfileId, today));
    } else if (payload?.active === false) {
      if (lastPingAt && now - lastPingAt <= ACTIVE_PING_MAX_GAP_MS) collectElapsedTime(now);
      else lastPersistedAt = now;
    } else if (lastPingAt && now - lastPingAt > ACTIVE_PING_MAX_GAP_MS) {
      lastPersistedAt = now;
    } else if (!lastPingAt) {
      lastPersistedAt = now;
    } else {
      collectElapsedTime(now);
    }

    socket.data.activityPaused = payload?.active === false;
    lastPingAt = now;
    socket.emit('echo:dailyActivity', { date: today, active: !socket.data.activityPaused });
  };
  const activityInterval = setInterval(() => {
    const now = Date.now();
    if (activityProfileId && !socket.data.activityPaused && lastPingAt && now - lastPingAt <= ACTIVE_PING_MAX_GAP_MS) {
      collectElapsedTime(now);
    } else if (lastPingAt && now - lastPingAt > ACTIVE_PING_MAX_GAP_MS) {
      lastPingAt = 0;
      lastPersistedAt = now;
      dayKey = dailyDateKey(new Date(now));
    } else {
      lastPersistedAt = now;
      dayKey = dailyDateKey(new Date(now));
    }
  }, 15000);

  advanceRoomRound();
  console.log(`[socket] connected: ${socket.id}`);
  socket.emit('echo:roundClock', currentRoundClock());
  if(rewardsReady && activityProfileId) queueRewardWork(async()=>{
    const results=await roundRewards.getRecentResults(pool,socket.data.verifiedAccountId ? 'account:' + socket.data.verifiedAccountId : activityProfileId);
    if(socket.connected && results.length)socket.emit('echo:roundResults',results.map(item=>({...item,authenticated: Boolean(socket.data.verifiedAccountId)})));
  });

  const identity = activityProfileId || socket.id;
  socket.data.roomIdentity = identity;
  const assignment = roomManager.join(identity);
  if (assignment.status !== 'joined') {
    socket.emit('echo:roomFull', { roomId: assignment.roomId });
    socket.disconnect(true);
    clearInterval(activityInterval);
    return;
  }
  socket.join(`echo:${assignment.round.id}:${assignment.roomId}`);
  socket.emit('echo:room', { roomId: assignment.roomId, round: assignment.round, occupancy: assignment.occupancy });
  const requestedSkin = socket.handshake.auth?.skin;
  const spawn = findOpenPlayerSpawn();
  players.set(socket.id, {
    id: socket.id,
    roomId: assignment.roomId,
    roundId: assignment.round.id,
    name: socket.data.verifiedNickname || normalizePlayerName(null, activityProfileId || socket.id),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    energy: 0,
    inWater: false,
    lastWaterDamageAt: 0,
    skin: allowedPlayerSkin(socket,requestedSkin) ? requestedSkin : defaultPlayerSkin(socket),
    fightingWith: null,
    fightId: null,
    defeated: false,
  });
  broadcastPlayers(players.get(socket.id));
  broadcastFood(players.get(socket.id));
  socket.emit('echo:world', createWorldSnapshot());

  socket.on('echo:dailyPing', receiveActivityPing);

  socket.on('echo:hello', (payload) => {
    const helloProfileId = normalizeActivityProfileId(payload?.activityProfileId);
    if (helloProfileId && !activityProfileId) receiveActivityPing({ activityProfileId: helloProfileId });
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && allowedPlayerSkin(socket,requestedSkin)) current.skin = requestedSkin;
    if (current) current.name = socket.data.verifiedNickname || normalizePlayerName(null, activityProfileId || socket.id);

    socket.emit('echo:world', createWorldSnapshot());
    if (current) {
      socket.emit('echo:players', roomPlayers(current).map(player => ({ ...player })));
      broadcastFood(current);
      broadcastPlayers(current);
    }
  });

  socket.on('echo:move', (payload) => {
    advanceRoomRound();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const current = players.get(socket.id);
    if (!current || current.defeated || current.fightingWith) return;

    const desired = {
      x: finiteNumber(payload.x, current.x, -WORLD_HALF_SIZE, WORLD_HALF_SIZE),
      y: finiteNumber(payload.y, current.y, -WORLD_HALF_SIZE, WORLD_HALF_SIZE),
    };
    const oldPosition = { x: current.x, y: current.y };
    if (!isValidPlayerPosition(desired)) {
      const slideX = { x: desired.x, y: oldPosition.y };
      const slideY = { x: oldPosition.x, y: desired.y };
      if (isValidPlayerPosition(slideX)) {
        current.x = slideX.x; current.y = slideX.y;
      } else if (isValidPlayerPosition(slideY)) {
        current.x = slideY.x; current.y = slideY.y;
      } else {
        current.x = oldPosition.x; current.y = oldPosition.y;
      }
      current.vx = 0; current.vy = 0;
    } else {
      current.x = desired.x; current.y = desired.y;
      current.vx = finiteNumber(payload.vx, 0, -100_000, 100_000);
      current.vy = finiteNumber(payload.vy, 0, -100_000, 100_000);
    }

    const now = Date.now();
    const inWater = isInWater(current);
    current.inWater = inWater;
    if (!inWater) current.lastWaterDamageAt = 0;
    else if (!current.lastWaterDamageAt) current.lastWaterDamageAt = now;

    const collected = collectFood(current);
    if (collected > 0) {
      current.energy = Math.min(MAX_ENERGY, current.energy + collected);
      const profileId = dailyActivityProfileIds.get(socket.id);
      if (profileId) addDailyActivity(profileId, 'food_collected', collected).catch((error) => console.error('[daily-activity] food write failed:', error.message));
      if (socket.data.verifiedAccountId) addDailyActivity(socket.data.verifiedAccountId, 'food_collected', collected).catch(error => console.error('[daily-quests] food write failed:', error.message));
    }

    const requestedSkin = payload.skin;
    if (allowedPlayerSkin(socket,requestedSkin)) current.skin = requestedSkin;

    checkForFights(current);
    broadcastPlayers(current);
    if (collected > 0) broadcastFood(current);
  });

  socket.on('disconnect', (reason) => {
    collectElapsedTime();
    clearInterval(activityInterval);
    dailyActivityProfileIds.delete(socket.id);
    if (activityProfileId && activityProfileSockets.get(activityProfileId) === socket.id) activityProfileSockets.delete(activityProfileId);
    const current = players.get(socket.id);
    if (current?.fightingWith) {
      const opponent = players.get(current.fightingWith);
      if (opponent) {
        opponent.fightingWith = null;
        opponent.fightId = null;
      }
      if (current.fightId) activeFights.delete(current.fightId);
    }
    players.delete(socket.id);
    roomManager.markAbsent(identity);
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    broadcastPlayers(current);
  });
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`[echo-server] listening on port ${port}`);
  try {
    await checkDatabase();
    await ensureDailyActivitySchema();
    await pool.query('CREATE TABLE IF NOT EXISTS echo_hero_collection (account_id TEXT NOT NULL, model TEXT NOT NULL, fragments INTEGER NOT NULL DEFAULT 0 CHECK (fragments >= 0), claimed BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (account_id,model))');
    await pool.query('CREATE TABLE IF NOT EXISTS echo_daily_quest_claims (profile_id TEXT NOT NULL, quest_date DATE NOT NULL, quest_id TEXT NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (profile_id, quest_date, quest_id))');
    await roundRewards.initialize(pool);
    await echoAuth.initialize();
    rewardsReady = true;
    queueRewardWork(()=>roundRewards.finalizeOverdue(pool,Date.now()));
    console.log('[echo-server] database connection OK');
    console.log('[daily-activity] ready; timezone=' + DAILY_TIME_ZONE);
  } catch (error) {
    console.error('[echo-server] database connection failed:', error.message);
  }
});

async function shutdown(signal) {
  console.log(`[echo-server] received ${signal}; shutting down`);
  io.close();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const express = require('express');
const cors = require('cors');
const http = require('node:http');
const { Server } = require('socket.io');
require('dotenv').config();

const { pool, checkDatabase } = require('./db');

const app = express();
const server = http.createServer(app);

const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(v => v.trim()) }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(v => v.trim()),
    methods: ['GET', 'POST'],
  },
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

const players = new Map();
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
]);

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
const worldRandom = createSeededRandom(WORLD_SEED);
const randomBetween = (min, max) => min + worldRandom() * (max - min);
function overlapsCircle(a, b, radiusA, radiusB, allowedOverlap = 0) {
  return Math.hypot(a.x - b.x, a.y - b.y) < Math.max(0, radiusA + radiusB - allowedOverlap);
}
function createWorldTrees() {
  const trees = [];
  for (let attempt = 0; attempt < TREE_COUNT * 100 && trees.length < TREE_COUNT; attempt += 1) {
    const scale = randomBetween(TREE_SCALE_MIN, TREE_SCALE_MAX);
    const tree = {
      id: `tree_${String(trees.length + 1).padStart(3, '0')}`,
      type: 'tree',
      x: randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160),
      y: randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160),
      scale,
      collisionRadius: TREE_COLLISION_RADIUS * scale,
      placementRadius: 100 * scale,
      rotation: randomBetween(0, Math.PI * 2),
    };
    // Keep the spawn area clear and allow modest visual overlap between trees.
    // Keep the initial player spawn at the origin clear; also avoid overly dense clumps.
    if (Math.hypot(tree.x, tree.y) < 440) continue;
    if (trees.some(other => overlapsCircle(tree, other, tree.placementRadius, other.placementRadius,
      Math.min(tree.placementRadius, other.placementRadius) * 0.4))) continue;
    trees.push(tree);
  }
  return trees;
}
const WORLD_TREES = createWorldTrees();
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
const food = new Map(Array.from({ length: FOOD_COUNT }, (_, id) => [id, createFoodPoint(id)]));

function finiteNumber(value, fallback = 0, min = -MAX_COORDINATE, max = MAX_COORDINATE) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function broadcastPlayers() {
  io.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
}

function broadcastFood() {
  io.emit('echo:food', createFoodSnapshot(food));
}

function collectFood(player) {
  return collectFoodCore(player, food, {
    radius: FOOD_COLLECT_RADIUS,
    respawnMinMs: FOOD_RESPAWN_MIN_MS,
    respawnMaxMs: FOOD_RESPAWN_MAX_MS,
  });
}

function refillFood() {
  const changed = refillFoodCore(food, { createFoodPoint });
  if (changed) broadcastFood();
}

setInterval(refillFood, 1000);

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
    broadcastPlayers();
    return;
  }

  const winner = fight.a.energy > fight.b.energy ? fight.a : fight.b;
  const loser = winner === fight.a ? fight.b : fight.a;
  const winnerState = players.get(winner.id);
  const loserState = players.get(loser.id);
  if (!winnerState || !loserState) return;
  const winnerProfileId = dailyActivityProfileIds.get(winnerState.id);
  if (winnerProfileId) addDailyActivity(winnerProfileId, 'pvp_wins', 1).catch((error) => console.error('[daily-activity] PvP write failed:', error.message));

  const winnerEnergyBefore = winnerState.energy;
  const loserEnergy = loserState.energy;
  winnerState.energy = Math.min(MAX_ENERGY, winnerState.energy + loserEnergy);
  loserState.energy = 0;
  winnerState.fightingWith = null;
  winnerState.fightId = null;
  loserState.fightingWith = null;
  loserState.fightId = null;

  io.to(winnerState.id).emit('echo:combatResult', {
    fightId: fight.id,
    result: 'win',
    energy: winnerState.energy,
    gained: loserEnergy,
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
  broadcastPlayers();
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
  activeFights.set(fight.id, fight);
  emitFightState(fight);
  broadcastPlayers();
  setTimeout(() => finishFight(fight), FIGHT_DURATION);
  return true;
}

function checkForFights(source) {
  if (!source || source.fightingWith || source.defeated) return;
  for (const opponent of players.values()) {
    if (opponent.id === source.id || opponent.fightingWith || opponent.defeated) continue;
    if (opponent.energy === source.energy) continue;
    const distance = Math.hypot(source.x - opponent.x, source.y - opponent.y);
    if (distance > FIGHT_DISTANCE) continue;
    if (startFight(source, opponent)) return;
  }
}

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

  console.log(`[socket] connected: ${socket.id}`);

  const requestedSkin = socket.handshake.auth?.skin;
  const spawn = findOpenPlayerSpawn();
  players.set(socket.id, {
    id: socket.id,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    energy: 0,
    skin: ALLOWED_SKINS.has(requestedSkin) ? requestedSkin : 'character-female-a.glb',
    fightingWith: null,
    fightId: null,
    defeated: false,
  });
  broadcastPlayers();
  broadcastFood();
  socket.emit('echo:world', { seed: WORLD_SEED, trees: WORLD_TREES.map(({ id, type, x, y, scale, rotation, collisionRadius }) => ({ id, type, x, y, scale, rotation, collisionRadius })) });

  socket.on('echo:dailyPing', receiveActivityPing);

  socket.on('echo:hello', (payload) => {
    const helloProfileId = normalizeActivityProfileId(payload?.activityProfileId);
    if (helloProfileId && !activityProfileId) receiveActivityPing({ activityProfileId: helloProfileId });
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    socket.emit('echo:world', { seed: WORLD_SEED, trees: WORLD_TREES.map(({ id, type, x, y, scale, rotation, collisionRadius }) => ({ id, type, x, y, scale, rotation, collisionRadius })) });
    socket.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
    broadcastFood();
    broadcastPlayers();
  });

  socket.on('echo:move', (payload) => {
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

    const collected = collectFood(current);
    if (collected > 0) {
      current.energy = Math.min(MAX_ENERGY, current.energy + collected);
      const profileId = dailyActivityProfileIds.get(socket.id);
      if (profileId) addDailyActivity(profileId, 'food_collected', collected).catch((error) => console.error('[daily-activity] food write failed:', error.message));
    }

    const requestedSkin = payload.skin;
    if (ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    checkForFights(current);
    broadcastPlayers();
    if (collected > 0) broadcastFood();
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
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    broadcastPlayers();
  });
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`[echo-server] listening on port ${port}`);
  try {
    await checkDatabase();
    await ensureDailyActivitySchema();
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

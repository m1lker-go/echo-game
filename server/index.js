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
const TREE_COUNT = 90;
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
  const clusterSizes = [2, 3, 5, 7];
  const clusterCount = 18;
  const clusteredTreeCount = clusterCount * 3;
  const singleTreeCount = TREE_COUNT - clusteredTreeCount;
  let nextId = 1;

  const addTree = (x, y, scale) => {
    trees.push({
      id: `tree_${String(nextId++).padStart(3, '0')}`,
      type: 'tree',
      x,
      y,
      scale,
      collisionRadius: TREE_COLLISION_RADIUS * scale,
      placementRadius: 100 * scale,
      rotation: randomBetween(0, Math.PI * 2),
    });
  };

  const isOpenForTree = (x, y, scale, allowNearby = false) => {
    const point = { x, y };
    if (Math.hypot(x, y) < 440) return false;
    const placementRadius = 100 * scale;
    return !trees.some(other => overlapsCircle(
      point,
      other,
      placementRadius,
      other.placementRadius,
      allowNearby ? Math.min(placementRadius, other.placementRadius) * 0.75 : Math.min(placementRadius, other.placementRadius) * 0.4
    ));
  };

  // Most trees remain spread across the map, while a portion is deliberately
  // placed in natural-looking groups of 2, 3, 5 or 7 trees.
  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
    const size = clusterSizes[Math.floor(worldRandom() * clusterSizes.length)];
    let placed = false;
    for (let attempt = 0; attempt < 300 && !placed; attempt += 1) {
      const centerX = randomBetween(-WORLD_HALF_SIZE + 240, WORLD_HALF_SIZE - 240);
      const centerY = randomBetween(-WORLD_HALF_SIZE + 240, WORLD_HALF_SIZE - 240);
      if (Math.hypot(centerX, centerY) < 500) continue;

      const group = [];
      let failed = false;
      for (let i = 0; i < size; i += 1) {
        const angle = worldRandom() * Math.PI * 2;
        const distance = randomBetween(90, 250);
        const scale = randomBetween(TREE_SCALE_MIN, TREE_SCALE_MAX);
        const x = centerX + Math.cos(angle) * distance;
        const y = centerY + Math.sin(angle) * distance;
        if (Math.abs(x) > WORLD_HALF_SIZE - 160 || Math.abs(y) > WORLD_HALF_SIZE - 160 ||
            !isOpenForTree(x, y, scale, true) ||
            group.some(other => overlapsCircle({ x, y }, other, 100 * scale, other.placementRadius, 0.2 * Math.min(100 * scale, other.placementRadius)))) {
          failed = true;
          break;
        }
        group.push({ x, y, scale, placementRadius: 100 * scale });
      }
      if (failed) continue;
      group.forEach(tree => addTree(tree.x, tree.y, tree.scale));
      placed = true;
    }
  }

  while (trees.length < TREE_COUNT && singleTreeCount > 0 && nextId <= TREE_COUNT) {
    const scale = randomBetween(TREE_SCALE_MIN, TREE_SCALE_MAX);
    const x = randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160);
    const y = randomBetween(-WORLD_HALF_SIZE + 160, WORLD_HALF_SIZE - 160);
    if (!isOpenForTree(x, y, scale)) continue;
    addTree(x, y, scale);
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

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

  const canPlace = (candidate, existing, gapFactor = 0.4) => {
    if (!isInsidePlayableArea(candidate.x, candidate.y) || isNearSpawn(candidate.x, candidate.y)) return false;
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
const WORLD_TREES = createWorldTrees();

// Seven shared water patches. Use a separate seeded RNG so water placement
// does not change the existing tree/food layout. Large coefficients are spread
// across the whole playable field instead of clustering around the center.
const WATER_COUNT = 7;
const WATER_DAMAGE_INTERVAL_MS = 300;
const WATER_DAMAGE_AMOUNT = 1;
const WATER_MODEL_BASE_SCALE = 50;
const WATER_SCALE_MIN = 7;
const WATER_SCALE_MAX = 12;
const WATER_GEOMETRY = require('../shared/water-hazard-contours');
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
function getWaterFootprint(water) {
  const scale = getWaterScale(water), vertices = getWaterGeometry(water).vertices;
  let halfWidth = 0, halfDepth = 0;
  for (const [x, y] of vertices) { halfWidth = Math.max(halfWidth, Math.abs(x * scale)); halfDepth = Math.max(halfDepth, Math.abs(y * scale)); }
  return { halfWidth, halfDepth };
}
function isPointOnWater(position, water) {
  const vertices = getWaterGeometry(water).vertices;
  const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
  const dx = position.x - water.x, dy = position.y - water.y;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const scale = getWaterScale(water);
  return isPointInPolygon(localX / scale, localY / scale, vertices);
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
    waters.push(candidate);
  }

  return waters;
}
const WORLD_WATERS = createWorldWaters();
function isInWater(position) {
  return WORLD_WATERS.some(water => isPointOnWater(position, water));
}

// Water damage is checked independently of movement packets. The player's
// world X/Y position is the character's central axis: no body-radius or model
// bounds are used here. If that axis is on the visible puddle footprint,
// energy drains every 300ms while the player remains there.
setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    if (!player || player.defeated || player.fightingWith) continue;
    const inWater = isInWater(player);
    if (!inWater) {
      player.inWater = false;
      player.lastWaterDamageAt = 0;
      continue;
    }
    if (!player.inWater) {
      player.inWater = true;
      player.lastWaterDamageAt = now;
      continue;
    }
    if (now - player.lastWaterDamageAt < WATER_DAMAGE_INTERVAL_MS) continue;
    const damageTicks = Math.floor((now - player.lastWaterDamageAt) / WATER_DAMAGE_INTERVAL_MS);
    player.energy = Math.max(0, player.energy - damageTicks * WATER_DAMAGE_AMOUNT);
    player.lastWaterDamageAt += damageTicks * WATER_DAMAGE_INTERVAL_MS;
  }
}, WATER_DAMAGE_INTERVAL_MS);

function createWorldSnapshot() {
  return {
    seed: WORLD_SEED,
    trees: WORLD_TREES.map(({ id, type, x, y, scale, rotation, collisionRadius }) => ({ id, type, x, y, scale, rotation, collisionRadius })),
    waters: WORLD_WATERS.map(({ id, type, model, x, y, scale, rotation, collisionRadius }) => ({ id, type, model, x, y, scale, rotation, collisionRadius })),
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
  a.inWater = false;
  a.lastWaterDamageAt = 0;
  b.inWater = false;
  b.lastWaterDamageAt = 0;
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
    inWater: false,
    lastWaterDamageAt: 0,
    skin: ALLOWED_SKINS.has(requestedSkin) ? requestedSkin : 'character-female-a.glb',
    fightingWith: null,
    fightId: null,
    defeated: false,
  });
  broadcastPlayers();
  broadcastFood();
  socket.emit('echo:world', createWorldSnapshot());

  socket.on('echo:dailyPing', receiveActivityPing);

  socket.on('echo:hello', (payload) => {
    const helloProfileId = normalizeActivityProfileId(payload?.activityProfileId);
    if (helloProfileId && !activityProfileId) receiveActivityPing({ activityProfileId: helloProfileId });
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    socket.emit('echo:world', createWorldSnapshot());
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

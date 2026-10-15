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

const players = new Map();
const activeFights = new Map();
const MAX_COORDINATE = 1_000_000;
const MAX_ENERGY = 1_000_000;
const FIGHT_DISTANCE = 72;
const FIGHT_DURATION = 1000;
const ALLOWED_SKINS = new Set([
  'character-female-a.glb', 'character-female-b.glb', 'character-female-c.glb',
  'character-female-d.glb', 'character-female-e.glb', 'character-female-f.glb',
  'character-male-a.glb', 'character-male-b.glb', 'character-male-c.glb',
  'character-male-d.glb', 'character-male-e.glb', 'character-male-f.glb',
]);

const FOOD_COUNT = 34;
// Food visually attracts inside 75.6 units. Collect slightly before its center
// reaches the player so server snapshots remove it before it appears to stick.
const FOOD_COLLECT_RADIUS = 60;
const FOOD_RESPAWN_INTERVAL = 3000;
const FOOD_RESPAWN_BATCH = 4;

function createFoodPoint(id) {
  const angle = id * 2.399963229728653;
  const radius = 170 + (id % 9) * 58 + Math.floor(id / 9) * 100;
  return {
    id,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    size: 5 + (id % 3),
    pulse: id * .7,
    active: true,
  };
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
  io.emit('echo:food', Array.from(food.values())
    .filter((point) => point.active)
    .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse })));
}

function collectFood(player) {
  let collected = 0;
  for (const point of food.values()) {
    if (!point.active) continue;
    const distance = Math.hypot(player.x - point.x, player.y - point.y);
    if (distance > FOOD_COLLECT_RADIUS) continue;
    point.active = false;
    collected += 1;
  }
  return collected;
}

function refillFood() {
  const inactive = Array.from(food.values()).filter((point) => !point.active);
  if (!inactive.length) return;

  for (const point of inactive.slice(0, FOOD_RESPAWN_BATCH)) {
    point.active = true;
  }
  broadcastFood();
}

setInterval(refillFood, FOOD_RESPAWN_INTERVAL);

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
  console.log(`[socket] connected: ${socket.id}`);

  const requestedSkin = socket.handshake.auth?.skin;
  players.set(socket.id, {
    id: socket.id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    energy: 0,
    skin: ALLOWED_SKINS.has(requestedSkin) ? requestedSkin : 'character-female-a.glb',
    fightingWith: null,
    fightId: null,
    defeated: false,
  });
  broadcastPlayers();
  socket.emit('echo:food', Array.from(food.values())
    .filter((point) => point.active)
    .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse })));

  socket.on('echo:hello', (payload) => {
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    socket.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
    socket.emit('echo:food', Array.from(food.values())
      .filter((point) => point.active)
      .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse })));
    broadcastPlayers();
  });

  socket.on('echo:move', (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const current = players.get(socket.id);
    if (!current || current.defeated || current.fightingWith) return;

    current.x = finiteNumber(payload.x, current.x);
    current.y = finiteNumber(payload.y, current.y);
    current.vx = finiteNumber(payload.vx, 0, -100_000, 100_000);
    current.vy = finiteNumber(payload.vy, 0, -100_000, 100_000);

    const collected = collectFood(current);
    if (collected > 0) current.energy = Math.min(MAX_ENERGY, current.energy + collected);

    const requestedSkin = payload.skin;
    if (ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    checkForFights(current);
    broadcastPlayers();
    if (collected > 0) broadcastFood();
  });

  socket.on('disconnect', (reason) => {
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
    console.log('[echo-server] database connection OK');
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

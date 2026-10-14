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

// In-memory state for the current online players. Socket IDs identify active sessions.
const players = new Map();
const MAX_COORDINATE = 1_000_000;
const MAX_ENERGY = 1_000_000;
const ALLOWED_SKINS = new Set([
  'character-female-a.glb', 'character-female-b.glb', 'character-female-c.glb',
  'character-female-d.glb', 'character-female-e.glb', 'character-female-f.glb',
  'character-male-a.glb', 'character-male-b.glb', 'character-male-c.glb',
  'character-male-d.glb', 'character-male-e.glb', 'character-male-f.glb',
]);

const FOOD_COUNT = 34;
const FOOD_COLLECT_RADIUS = 22;
const FOOD_RESPAWN_INTERVAL = 3000;

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
    if (distance >= FOOD_COLLECT_RADIUS) continue;

    point.active = false;
    collected += 1;
  }

  return collected;
}

function refillFood() {
  let changed = false;
  for (const point of food.values()) {
    if (point.active) continue;
    point.active = true;
    changed = true;
  }
  if (changed) broadcastFood();
}

setInterval(refillFood, FOOD_RESPAWN_INTERVAL);

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // Add the new player immediately so existing clients receive them as well.
  const requestedSkin = socket.handshake.auth?.skin;
  players.set(socket.id, {
    id: socket.id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    energy: 0,
    skin: ALLOWED_SKINS.has(requestedSkin) ? requestedSkin : 'character-female-a.glb',
  });
  broadcastPlayers();
  socket.emit('echo:food', Array.from(food.values())
    .filter((point) => point.active)
    .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse })));

  socket.on('echo:hello', (payload) => {
    // Keep the skin tied to this socket session; accept only known bundled model names.
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    // Send the current snapshot to the connecting client.
    socket.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
    socket.emit('echo:food', Array.from(food.values())
      .filter((point) => point.active)
      .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse })));
    broadcastPlayers();
  });

  socket.on('echo:move', (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const current = players.get(socket.id);
    if (!current) return;

    // Keep the player snapshot authoritative to this socket and reject malformed values.
    current.x = finiteNumber(payload.x, current.x);
    current.y = finiteNumber(payload.y, current.y);
    current.vx = finiteNumber(payload.vx, 0, -100_000, 100_000);
    current.vy = finiteNumber(payload.vy, 0, -100_000, 100_000);

    // Shared food is collected from the server's canonical positions.
    const collected = collectFood(current);
    if (collected > 0) current.energy += collected;

    // Keep compatibility with the existing client-side energy counter without allowing
    // a stale client value to erase food already collected on the server.
    const clientEnergy = Math.round(finiteNumber(payload.energy, current.energy, 0, MAX_ENERGY));
    current.energy = Math.max(current.energy, clientEnergy);

    // Keep the chosen appearance tied to the session; never accept arbitrary asset paths.
    const requestedSkin = payload.skin;
    if (ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    broadcastPlayers();
    if (collected > 0) broadcastFood();
  });

  socket.on('disconnect', (reason) => {
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

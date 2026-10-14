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

function finiteNumber(value, fallback = 0, min = -MAX_COORDINATE, max = MAX_COORDINATE) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function broadcastPlayers() {
  io.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
}

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

  socket.on('echo:hello', (payload) => {
    // Keep the skin tied to this socket session; accept only known bundled model names.
    const requestedSkin = payload?.skin;
    const current = players.get(socket.id);
    if (current && ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    // Send the current snapshot to the connecting client.
    socket.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
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
    current.energy = Math.round(finiteNumber(payload.energy, current.energy, 0, MAX_ENERGY));

    // Keep the chosen appearance tied to the session; never accept arbitrary asset paths.
    const requestedSkin = payload.skin;
    if (ALLOWED_SKINS.has(requestedSkin)) current.skin = requestedSkin;

    broadcastPlayers();
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

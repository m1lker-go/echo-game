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
  players.set(socket.id, {
    id: socket.id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    energy: 0,
  });
  broadcastPlayers();

  socket.on('echo:hello', () => {
    // A reconnect may have replaced the entry; always send the current snapshot.
    socket.emit('echo:players', Array.from(players.values(), (player) => ({ ...player })));
  });

  socket.on('echo:move', (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    const current = players.get(socket.id);
    if (!current) return;

    // Accept only finite numeric movement data and clamp values to sane bounds.
    current.x = finiteNumber(payload.x, current.x);
    current.y = finiteNumber(payload.y, current.y);
    current.vx = finiteNumber(payload.vx, 0, -100_000, 100_000);
    current.vy = finiteNumber(payload.vy, 0, -100_000, 100_000);
    current.energy = Math.round(finiteNumber(payload.energy, current.energy, 0, MAX_ENERGY));

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

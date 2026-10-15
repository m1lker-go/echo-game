const worldCanvas = document.querySelector('#world');
const energyText = document.querySelector('#energy');

const FOOD_COUNT = 34;
const FOOD_MAGNET_RADIUS = 84 * 0.9;
const FOOD_MAGNET_STRENGTH = 7.5;
const ISO_X = 0.8660254;
const ISO_Y = 0.5;

const food = new Map();
let activeIds = new Set();
let lastTime = performance.now();
let socket = null;
let cameraX = 0;
let cameraY = 0;
let serverPlayers = [];
let isConnected = false;

function getPoint(id, x = 0, y = 0, size = 6, pulse = 0) {
  return { id, x, y, displayX: x, displayY: y, size, pulse };
}

function syncFood(snapshot) {
  if (!Array.isArray(snapshot)) return;
  const nextIds = new Set();

  for (const item of snapshot) {
    if (!item || !Number.isInteger(item.id) ||
        item.id < 0 || item.id >= FOOD_COUNT ||
        !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;

    nextIds.add(item.id);
    const point = food.get(item.id);
    if (point) {
      // Keep the locally smoothed visual point unless the server moved it.
      point.x = item.x;
      point.y = item.y;
      point.size = Number.isFinite(item.size) ? item.size : point.size;
      point.pulse = Number.isFinite(item.pulse) ? item.pulse : point.pulse;
    } else {
      food.set(item.id, getPoint(item.id, item.x, item.y, item.size, item.pulse));
    }
  }

  // The complete snapshot is authoritative: any missing point is collected.
  activeIds = nextIds;
}

function syncPlayers(players) {
  if (!Array.isArray(players)) return;
  serverPlayers = players;
  if (socket?.id) {
    const local = players.find((player) => player?.id === socket.id);
    if (local && Number.isFinite(local.energy)) {
      if (energyText) energyText.textContent = String(Math.max(0, Math.round(local.energy)));
    }
  }
}

function attachSocket(candidate) {
  if (!candidate || candidate === socket) return;
  if (socket) {
    socket.off('echo:food', syncFood);
    socket.off('echo:players', syncPlayers);
  }
  socket = candidate;
  socket.on('echo:food', syncFood);
  socket.on('echo:players', syncPlayers);
  isConnected = Boolean(socket.connected);
  socket.on('connect', () => { isConnected = true; });
  socket.on('disconnect', () => { isConnected = false; activeIds.clear(); });
  if (socket.connected) {
    // Ask for a complete authoritative snapshot after attaching.
    socket.emit('echo:hello', { version: 1 });
  }
}

function findSocket() {
  if (window.echoSocket) {
    attachSocket(window.echoSocket);
    return;
  }
  // game.js publishes the socket immediately after creation, but allow for
  // module initialization order and reconnects without wrapping global window.io.
  requestAnimationFrame(findSocket);
}
findSocket();

function resize() {
  // Render directly into the world canvas, so grid, food, and world camera agree.
}

function isoProject(x, y) {
  return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y };
}

function worldToScreen(x, y, cx, cy, width, height) {
  const point = isoProject(x, y);
  const camera = isoProject(cx, cy);
  return {
    x: width / 2 + point.x - camera.x,
    y: height / 2 + point.y - camera.y,
  };
}

function readCamera() {
  const match = document.querySelector('#coords')?.textContent?.match(/(-?\d+)\s*[·.]\s*(-?\d+)/);
  cameraX = match ? Number(match[1]) : 0;
  cameraY = match ? Number(match[2]) : 0;
}

function draw(time) {
  const dt = Math.min(Math.max((time - lastTime) / 1000, 0), 0.05);
  lastTime = time;
  readCamera();

  if (worldCanvas && isConnected) {
    // Draw on the same canvas after game.js paints the grid; the food uses the
    // server's fixed coordinates and cannot move/collect locally.
    const width = worldCanvas.clientWidth || 1;
    const height = worldCanvas.clientHeight || 1;
    const ctx = worldCanvas.getContext('2d');
    if (ctx) {
      const blend = 1 - Math.exp(-FOOD_MAGNET_STRENGTH * dt);
      ctx.save();
      ctx.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0,
        Math.min(window.devicePixelRatio || 1, 2), 0, 0);
      ctx.shadowBlur = 0;

      for (const id of activeIds) {
        const point = food.get(id);
        if (!point) continue;

        // This attraction is presentation-only. It never changes server coordinates
        // and the point stays visible until the server removes its id from the snapshot.
        const dx = cameraX - point.displayX;
        const dy = cameraY - point.displayY;
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < FOOD_MAGNET_RADIUS) {
          point.displayX += dx * blend;
          point.displayY += dy * blend;
        } else if (distance >= FOOD_MAGNET_RADIUS) {
          // Ease the rendered point back to the authoritative position after leaving
          // the magnet radius, preventing it from being left behind visually.
          point.displayX += (point.x - point.displayX) * blend;
          point.displayY += (point.y - point.displayY) * blend;
        }

        const p = worldToScreen(point.displayX, point.displayY, cameraX, cameraY, width, height);
        if (p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30) continue;

        const pulse = 0.65 + 0.35 * Math.sin(time * 0.002 + point.pulse);
        const radius = point.size * pulse;
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.2);
        halo.addColorStop(0, 'rgba(210,238,255,0.38)');
        halo.addColorStop(0.35, 'rgba(210,238,255,0.15)');
        halo.addColorStop(1, 'rgba(210,238,255,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 3.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(220,242,255,${0.65 + 0.35 * pulse})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

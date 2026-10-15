const foodCanvas = document.querySelector('#shared-food');
const energyText = document.querySelector('#energy');

const FOOD_COUNT = 1000;
// The magnet is visual only; collection and disappearance remain server-authoritative.
const FOOD_MAGNET_RADIUS = 84 * 0.9;
const FOOD_MAGNET_SPEED = 520;
const FOOD_RECONCILE_SPEED = 260;
const ISO_X = 0.8660254;
const ISO_Y = 0.5;

const food = new Map();
let activeIds = new Set();
let lastTime = performance.now();
let socket = null;
let cameraX = 0;
let cameraY = 0;
let isConnected = false;
let lastDebugLog = 0;

function getPoint(id, x = 0, y = 0, size = 6, pulse = 0) {
  return { id, x, y, displayX: x, displayY: y, size, pulse, magnetActive: false };
}

function syncFood(snapshot) {
  if (!Array.isArray(snapshot)) return;
  const nextIds = new Set();

  for (const item of snapshot) {
    if (!item || !Number.isInteger(item.id) || item.id < 0 || item.id >= FOOD_COUNT ||
        !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    nextIds.add(item.id);
    const point = food.get(item.id);
    if (point) {
      const movedByServer = Math.hypot(point.x - item.x, point.y - item.y) > 0.5;
      point.x = item.x;
      point.y = item.y;
      if (!point.magnetActive || movedByServer) {
        point.displayX = item.x;
        point.displayY = item.y;
        point.magnetActive = false;
      }
      point.size = Number.isFinite(item.size) ? item.size : point.size;
      point.pulse = Number.isFinite(item.pulse) ? item.pulse : point.pulse;
    } else {
      food.set(item.id, getPoint(item.id, item.x, item.y, item.size, item.pulse));
    }
  }

  activeIds = nextIds;
}

function syncPlayers(players) {
  if (!Array.isArray(players)) return;
  if (socket?.id) {
    const local = players.find((player) => player?.id === socket.id);
    if (local && Number.isFinite(local.energy) && energyText) {
      energyText.textContent = String(Math.max(0, Math.round(local.energy)));
    }
  }
}

function attachSocket(candidate) {
  if (!candidate || candidate === socket) return;
  if (socket) {
    socket.off('echo:food', syncFood);
    socket.off('echo:players', syncPlayers);
    socket.off('connect', onSocketConnect);
    socket.off('disconnect', onSocketDisconnect);
  }
  socket = candidate;
  socket.on('echo:food', syncFood);
  socket.on('echo:players', syncPlayers);
  socket.on('connect', onSocketConnect);
  socket.on('disconnect', onSocketDisconnect);
  isConnected = Boolean(socket.connected);
  if (socket.connected) {
    // The first food snapshot may have arrived before these listeners were bound.
    socket.emit('echo:hello', { version: 1 });
  }
}

function onSocketConnect() {
  isConnected = true;
  // Always request fresh authoritative snapshots after reconnect.
  socket?.emit('echo:hello', { version: 1 });
}

function onSocketDisconnect() {
  isConnected = false;
  activeIds.clear();
}

function findSocket() {
  if (window.echoSocket) {
    attachSocket(window.echoSocket);
    return;
  }
  requestAnimationFrame(findSocket);
}
findSocket();

function resize() {
  if (!foodCanvas) return;
  const rect = foodCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  foodCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  foodCanvas.height = Math.max(1, Math.round(rect.height * dpr));
}
window.addEventListener('resize', resize, { passive: true });
resize();

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

  if (foodCanvas && isConnected) {
    const rect = foodCanvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = foodCanvas.getContext('2d');

    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      // Expose lightweight counters while debugging visibility of the authoritative snapshot.
      let visibleCount = 0;
      for (const id of activeIds) {
        const point = food.get(id);
        if (!point) continue;
        const dx = cameraX - point.displayX;
        const dy = cameraY - point.displayY;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.001 && distance < FOOD_MAGNET_RADIUS) {
          const travel = Math.min(distance, FOOD_MAGNET_SPEED * dt);
          point.displayX += dx / distance * travel;
          point.displayY += dy / distance * travel;
          point.magnetActive = true;
        } else if (point.magnetActive) {
          const backX = point.x - point.displayX;
          const backY = point.y - point.displayY;
          const backDistance = Math.hypot(backX, backY);
          if (distance >= FOOD_MAGNET_RADIUS * 1.05) {
            const travel = Math.min(backDistance, FOOD_RECONCILE_SPEED * dt);
            if (backDistance > 0.001) {
              point.displayX += backX / backDistance * travel;
              point.displayY += backY / backDistance * travel;
            }
            if (backDistance <= FOOD_RECONCILE_SPEED * dt) point.magnetActive = false;
          }
        } else {
          point.displayX = point.x;
          point.displayY = point.y;
        }

        const p = worldToScreen(point.displayX, point.displayY, cameraX, cameraY, width, height);
        // Offscreen points are normal; keep them in the snapshot and only skip drawing here.
        if (p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30) continue;
        if (point.id < 8 && time - lastDebugLog > 5000) {
          console.debug('[echo:food] sample point:', point.id, 'world:', point.x, point.y, 'screen:', p.x, p.y, 'camera:', cameraX, cameraY);
        }
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
        visibleCount += 1;
      }
      if (time - lastDebugLog > 5000) {
        lastDebugLog = time;
        console.debug('[echo:food] active:', activeIds.size, 'known:', food.size, 'visible:', visibleCount, 'connected:', isConnected);
      }
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

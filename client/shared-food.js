import { loadAnimatedWebpFrames } from './animated-webp-frames.js?v=echo-webp-frames-1';

const energyText = document.querySelector('#energy');

// Server positions never change during pickup: only displayX/displayY animate.
// Keep the visual attraction radius equal to the server pickup radius.
const FOOD_MAGNET_RADIUS = 70;
const FOOD_MAGNET_SPEED = 520;
const ISO_X = 0.8660254;
const ISO_Y = 0.5;

// White glowing dots are the default food visual. Add ?food=icon to preview
// the animated WebP without touching food mechanics. Dots are the fallback too.
const FOOD_VISUAL_MODE = new URLSearchParams(window.location.search).get('food') === 'icon' ? 'icon' : 'dots';
let foodAnimation = null;
if (FOOD_VISUAL_MODE === 'icon') {
  loadAnimatedWebpFrames('./assets/icons/food.webp?v=echo-food-animated-2')
    .then(animation => {
      foodAnimation = animation;
      console.info('[echo:food] animated WebP ready:', animation.frameCount, 'frames', animation.duration, 'ms');
    })
    .catch(error => {
      console.warn('[echo:food] WebP animation unavailable, using original white dots', error);
    });
}

const food = new Map();
let activeIds = new Set();
let socket = null;
let isConnected = false;
let lastDebugLog = 0;
let lastRenderAt = 0;

function getPoint(id, x = 0, y = 0, size = 6, pulse = 0) {
  return { id, x, y, displayX: x, displayY: y, size, pulse, magnetActive: false };
}

function syncFood(snapshot) {
  if (!Array.isArray(snapshot)) return;
  const nextIds = new Set();

  for (const item of snapshot) {
    // Validate payload shape only; quantity and valid IDs belong to the server.
    if (!item || !Number.isSafeInteger(item.id) || item.id < 0 ||
        !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    nextIds.add(item.id);
    const point = food.get(item.id);
    if (point) {
      const movedByServer = point.x !== item.x || point.y !== item.y;
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

  // A server snapshot is authoritative. Remove inactive points from the client cache too,
  // so a point eaten by any player cannot remain visible locally.
  for (const id of food.keys()) {
    if (!nextIds.has(id)) food.delete(id);
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
  food.clear();
  lastRenderAt = 0;
}

function findSocket() {
  if (window.echoSocket) {
    attachSocket(window.echoSocket);
    return;
  }
  requestAnimationFrame(findSocket);
}
findSocket();

// Project food using the same camera-space deltas as game.js's grid.
// The caller supplies the already scaled world canvas, so no second layer or
// independent pixel-ratio / CSS-viewport transform can drift during movement.
function worldToScreen(x, y, cx, cy, width, height) {
  const dx = x - cx, dy = y - cy;
  return { x: width / 2 + (dx - dy) * ISO_X, y: height / 2 + (dx + dy) * ISO_Y };
}

// Called after the grid/boundary in game.js, with the SAME canvas and transform.
// playerX/Y are authoritative movement coordinates for the 70-unit magnet test.
// cameraX/Y are used to aim food at the visually centered player.
export function renderSharedFood(ctx, time, cameraX, cameraY, playerX, playerY, width, height) {
  if (document.hidden || !isConnected || !ctx) { lastRenderAt = 0; return; }
  const dt = lastRenderAt ? Math.min(Math.max((time - lastRenderAt) / 1000, 0), 0.05) : 0;
  lastRenderAt = time;
  // Expose lightweight counters while debugging visibility of the authoritative snapshot.
  let visibleCount = 0;
  for (const id of activeIds) {
    const point = food.get(id);
    if (!point) continue;
    // Test distance from the permanent server point, never its animated display.
    // Otherwise a magnetic dot could keep following the player outside pickup range.
    const anchorDx = playerX - point.x;
    const anchorDy = playerY - point.y;
    if (anchorDx * anchorDx + anchorDy * anchorDy <= FOOD_MAGNET_RADIUS * FOOD_MAGNET_RADIUS) {
      const dx = cameraX - point.displayX;
      const dy = cameraY - point.displayY;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.001) {
        const travel = Math.min(distance, FOOD_MAGNET_SPEED * dt);
        point.displayX += dx / distance * travel;
        point.displayY += dy / distance * travel;
      }
      point.magnetActive = true;
    } else if (point.magnetActive) {
      // Only a visual reset: the authoritative server position is untouched.
      point.displayX = point.x;
      point.displayY = point.y;
      point.magnetActive = false;
    }
    const p = worldToScreen(point.displayX, point.displayY, cameraX, cameraY, width, height);
    // Offscreen points are normal; keep them in the snapshot and only skip drawing here.
    if (p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30) continue;
    const pulse = 0.65 + 0.35 * Math.sin(time * 0.002 + point.pulse);
    const radius = point.size * pulse;
    if (FOOD_VISUAL_MODE === 'icon' && foodAnimation) {
      // Decode the actual animation frames once, then select a cached frame
      // every draw. Canvas.drawImage(Image) otherwise freezes animated WebP.
      // Stagger phases between food points so 1,000 icons don't move in sync.
      const iconSize = radius * 6;
      const currentFrame = foodAnimation.frameAt(time + point.id * 37);
      ctx.globalAlpha = 0.8 + 0.2 * pulse;
      ctx.drawImage(currentFrame, p.x - iconSize / 2, p.y - iconSize / 2, iconSize, iconSize);
      ctx.globalAlpha = 1;
    } else {
      // Original white dots: default rendering and fallback if WebP fails to load.
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
    visibleCount += 1;
  }
  if (time - lastDebugLog > 5000) {
    lastDebugLog = time;
    console.debug('[echo:food] active:', activeIds.size, 'known:', food.size, 'visible:', visibleCount, 'connected:', isConnected);
  }
}

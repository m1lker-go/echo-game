const worldCanvas = document.querySelector('#world');
const energyText = document.querySelector('#energy');

const FOOD_COUNT = 34;
const FOOD_MAGNET_RADIUS = 84 * 0.9;
const FOOD_MAGNET_STRENGTH = 7.5;
const ISO_X = 0.8660254;
const ISO_Y = 0.5;

function createSpawnPoint(id) {
  const angle = id * 2.399963229728653;
  const radius = 170 + (id % 9) * 58 + Math.floor(id / 9) * 100;
  return {
    id,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    displayX: Math.cos(angle) * radius,
    displayY: Math.sin(angle) * radius,
    size: 5 + (id % 3),
    pulse: id * .7,
  };
}

const food = new Map(Array.from({ length: FOOD_COUNT }, (_, id) => {
  const point = createSpawnPoint(id);
  return [id, point];
}));

let activeIds = new Set();
let lastTime = performance.now();
let socket = null;

function syncFood(snapshot) {
  if (!Array.isArray(snapshot)) return;
  const nextIds = new Set();

  for (const item of snapshot) {
    if (!item || !Number.isInteger(item.id)) continue;
    if (item.id < 0 || item.id >= FOOD_COUNT) continue;
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;

    nextIds.add(item.id);
    let point = food.get(item.id);
    if (!point) {
      point = createSpawnPoint(item.id);
      food.set(item.id, point);
    }

    point.x = item.x;
    point.y = item.y;
    point.displayX = item.x;
    point.displayY = item.y;
    point.size = Number.isFinite(item.size) ? item.size : point.size;
    point.pulse = Number.isFinite(item.pulse) ? item.pulse : point.pulse;
  }

  activeIds = nextIds;
}

function syncPlayers(players) {
  if (!Array.isArray(players) || !socket?.id) return;
  const local = players.find((player) => player?.id === socket.id);
  if (!local || !Number.isFinite(local.energy)) return;
  if (energyText) energyText.textContent = String(Math.max(0, Math.round(local.energy)));
}

function attachSocket(candidate) {
  if (!candidate || candidate === socket) return;
  socket = candidate;
  socket.on('echo:food', syncFood);
  socket.on('echo:players', syncPlayers);
}

function installIoHook() {
  if (typeof window.io !== 'function') return false;
  if (window.io.__echoFoodHooked) return true;

  const originalIo = window.io;
  const wrappedIo = function (...args) {
    const result = originalIo.apply(this, args);
    attachSocket(result);
    return result;
  };
  Object.setPrototypeOf(wrappedIo, originalIo);
  wrappedIo.__echoFoodHooked = true;
  window.io = wrappedIo;
  return true;
}

installIoHook();

const foodCanvas = document.createElement('canvas');
foodCanvas.id = 'shared-food';
foodCanvas.setAttribute('aria-hidden', 'true');
foodCanvas.style.position = 'absolute';
foodCanvas.style.inset = '0';
foodCanvas.style.width = '100%';
foodCanvas.style.height = '100%';
foodCanvas.style.display = 'block';
foodCanvas.style.pointerEvents = 'none';
foodCanvas.style.zIndex = '1';
worldCanvas?.parentElement?.insertBefore(foodCanvas, worldCanvas.nextSibling);

const foodCtx = foodCanvas.getContext('2d', { alpha: true });
const worldCtx = worldCanvas?.getContext('2d');

// game.js still contains its old local food renderer. Suppress only those food pixels;
// the authoritative food is rendered by this canvas from server snapshots.
if (worldCtx && !worldCtx.__echoSharedFoodPatched) {
  const originalCreateRadialGradient = worldCtx.createRadialGradient.bind(worldCtx);
  const originalFill = worldCtx.fill.bind(worldCtx);
  const foodGradients = new WeakSet();

  worldCtx.createRadialGradient = (...args) => {
    const gradient = originalCreateRadialGradient(...args);
    const outerRadius = Number(args[5]);
    if (Number.isFinite(outerRadius) && outerRadius <= 30) foodGradients.add(gradient);
    return gradient;
  };

  worldCtx.fill = function(...args) {
    if (foodGradients.has(this.fillStyle) ||
        (typeof this.fillStyle === 'string' && this.fillStyle.startsWith('rgba(220,242,255,'))) {
      return;
    }
    return originalFill(...args);
  };

  worldCtx.__echoSharedFoodPatched = true;
}

function resize() {
  if (!foodCanvas || !foodCtx || !worldCanvas) return;
  const rect = worldCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  foodCanvas.width = Math.round(rect.width * dpr);
  foodCanvas.height = Math.round(rect.height * dpr);
  foodCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize, { passive: true });
resize();

function getCamera() {
  const worldWidth = worldCanvas?.clientWidth || 1;
  const worldHeight = worldCanvas?.clientHeight || 1;
  const playerModel = document.querySelector('#models');
  // The local model is centered by game.js; use its center offset only for the
  // visual food layer. The authoritative coordinates arrive from the server.
  const match = document.querySelector('#coords')?.textContent?.match(/(-?\d+)\s*[·.]\s*(-?\d+)/);
  return {
    x: match ? Number(match[1]) : 0,
    y: match ? Number(match[2]) : 0,
    width: worldWidth,
    height: worldHeight,
    playerModel,
  };
}

function isoProject(x, y) {
  return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y };
}

function worldToScreen(x, y, cameraX, cameraY, width, height) {
  const point = isoProject(x, y);
  const camera = isoProject(cameraX, cameraY);
  return {
    x: width / 2 + point.x - camera.x,
    y: height / 2 + point.y - camera.y,
  };
}

function draw(time) {
  if (!foodCtx || !worldCanvas) return;
  const dt = Math.min(Math.max((time - lastTime) / 1000, 0), .05);
  lastTime = time;

  const camera = getCamera();
  const blend = 1 - Math.exp(-FOOD_MAGNET_STRENGTH * dt);
  const width = camera.width;
  const height = camera.height;

  foodCtx.clearRect(0, 0, width, height);
  foodCtx.save();
  foodCtx.shadowBlur = 0;

  for (const id of activeIds) {
    const point = food.get(id);
    if (!point) continue;

    const dx = camera.x - point.displayX;
    const dy = camera.y - point.displayY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0 && distance < FOOD_MAGNET_RADIUS) {
      point.displayX += dx * blend;
      point.displayY += dy * blend;
    }

    const p = worldToScreen(point.displayX, point.displayY, camera.x, camera.y, width, height);
    if (p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30) continue;

    const pulse = .65 + .35 * Math.sin(time * .002 + point.pulse);
    const radius = point.size * pulse;
    const halo = foodCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.2);
    halo.addColorStop(0, 'rgba(210,238,255,0.38)');
    halo.addColorStop(.35, 'rgba(210,238,255,0.15)');
    halo.addColorStop(1, 'rgba(210,238,255,0)');
    foodCtx.fillStyle = halo;
    foodCtx.beginPath();
    foodCtx.arc(p.x, p.y, radius * 3.2, 0, Math.PI * 2);
    foodCtx.fill();

    foodCtx.fillStyle = `rgba(220,242,255,${.65 + .35 * pulse})`;
    foodCtx.beginPath();
    foodCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    foodCtx.fill();
  }

  foodCtx.restore();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

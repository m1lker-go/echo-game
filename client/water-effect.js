import WATER_GEOMETRY from './water-hazard-contours.js';

const ISO = { x: 0.8660254, y: 0.5 };
const WATER_MODEL_BASE_SCALE = 50;
const WAVE_STEP_DISTANCE = 30;
const WAVE_MIN_SPEED = 18;
const WAVE_DURATION = 700;
const WAVE_DELAY = 88;
const WAVE_START_RADIUS = 3;
const WAVE_MAX_RADIUS = 13;
const WAVE_LINE_WIDTH = 1.15;
const WAVE_SAMPLE_COUNT = 96;
const MAX_WAVES = 18;

const game = document.querySelector('#game');
const canvas = document.createElement('canvas');
canvas.id = 'water-waves';
canvas.setAttribute('aria-hidden', 'true');
canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:3.5;';
game?.appendChild(canvas);

const ctx = canvas?.getContext('2d', { alpha: true });
const waters = [];
const waves = [];
let width = 1;
let height = 1;
let dpr = 1;
let cameraX = 0;
let cameraY = 0;
let playerX = 0;
let playerY = 0;
let playerVX = 0;
let playerVY = 0;
let distanceAccumulator = WAVE_STEP_DISTANCE;
let lastMovementAt = 0;
let socketBound = null;

function resize() {
  if (!canvas || !ctx) return;
  const rect = game?.getBoundingClientRect();
  width = Math.max(1, rect?.width || window.innerWidth);
  height = Math.max(1, rect?.height || window.innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function isoProject(x, y) {
  return { x: (x - y) * ISO.x, y: (x + y) * ISO.y };
}

function worldToScreen(x, y) {
  const p = isoProject(x, y);
  const c = isoProject(cameraX, cameraY);
  return {
    x: width / 2 + p.x - c.x,
    y: height / 2 + p.y - c.y
  };
}

function getWaterLocalOffset(worldX, worldY, water) {
  const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
  const dx = worldX - water.x;
  const dy = worldY - water.y;
  return {
    x: dx * Math.cos(angle) + dy * Math.sin(angle),
    y: -dx * Math.sin(angle) + dy * Math.cos(angle)
  };
}

function waterLocalToWorld(localX, localY, water) {
  const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
  return {
    x: water.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: water.y + localX * Math.sin(angle) + localY * Math.cos(angle)
  };
}

function pointInPolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(xi, xj) - 1e-7 && x <= Math.max(xi, xj) + 1e-7 && y >= Math.min(yj, yi) - 1e-7 && y <= Math.max(yj, yi) + 1e-7) return true;
  }
  return inside;
}

function getWaterGeometryPoint(x, y, water) {
  const scale = WATER_MODEL_BASE_SCALE * water.scale;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const local = getWaterLocalOffset(x, y, water);
  return { x: local.x / scale, y: local.y / scale };
}

function isPointOnWater(x, y, water) {
  const vertices = WATER_GEOMETRY[water.model] || WATER_GEOMETRY['patch-water-large.glb'];
  const point = getWaterGeometryPoint(x, y, water);
  return point ? pointInPolygon(point.x, point.y, vertices) : false;
}

function getWaterAt(x, y) {
  for (const water of waters) {
    if (isPointOnWater(x, y, water)) return water;
  }
  return null;
}

function spawnWave(x, y, now) {
  const water = getWaterAt(x, y);
  if (!water) return;
  while (waves.length + 3 > MAX_WAVES) waves.shift();
  for (let ring = 0; ring < 3; ring += 1) {
    // Ripple stays at the step's world position as the camera follows the hero.
    waves.push({ x, y, water, born: now + ring * WAVE_DELAY, ring });
  }
}

function onPlayerMovement(event) {
  const detail = event.detail || {};
  if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
  playerX = detail.x;
  playerY = detail.y;
  playerVX = Number.isFinite(detail.vx) ? detail.vx : 0;
  playerVY = Number.isFinite(detail.vy) ? detail.vy : 0;
  // The game camera follows the local hero every frame.
  // Keep the wave canvas on the same camera coordinates as game.js.
  cameraX = playerX;
  cameraY = playerY;
  const speed = Math.hypot(playerVX, playerVY);
  const now = performance.now();
  if (speed < WAVE_MIN_SPEED || !getWaterAt(playerX, playerY)) {
    distanceAccumulator = WAVE_STEP_DISTANCE;
    lastMovementAt = now;
    return;
  }
  const dtDistance = speed * Math.min(.05, Math.max(0, (now - lastMovementAt) / 1000));
  distanceAccumulator += dtDistance;
  while (distanceAccumulator >= WAVE_STEP_DISTANCE) {
    distanceAccumulator -= WAVE_STEP_DISTANCE;
    spawnWave(playerX, playerY, now);
  }
  lastMovementAt = now;
}

function drawRing(wave, now) {
  const age = now - wave.born;
  if (age < 0 || age >= WAVE_DURATION) return false;
  const progress = age / WAVE_DURATION;
  const eased = 1 - Math.pow(1 - progress, 2);
  const radius = WAVE_START_RADIUS + (WAVE_MAX_RADIUS - WAVE_START_RADIUS) * eased;
  const fade = 1 - Math.pow(progress, 1.35);
  const water = wave.water;
  if (!water || !isPointOnWater(wave.x, wave.y, water)) return false;

  // Small flattened ellipses, clipped against the current water contour.
  const horizontalRadius = radius * 1.05;
  const verticalRadius = radius * 0.42;
  ctx.beginPath();
  let drawing = false;
  for (let i = 0; i <= WAVE_SAMPLE_COUNT; i += 1) {
    const a = (i / WAVE_SAMPLE_COUNT) * Math.PI * 2;
    const localX = Math.cos(a) * horizontalRadius;
    const localY = Math.sin(a) * verticalRadius;
    const offset = getWaterLocalOffset(wave.x, wave.y, water);
    const world = waterLocalToWorld(offset.x + localX, offset.y + localY, water);
    const worldX = world.x;
    const worldY = world.y;
    const inside = isPointOnWater(worldX, worldY, water);
    const p = worldToScreen(worldX, worldY);
    if (inside) {
      if (!drawing) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      drawing = true;
    } else {
      drawing = false;
      ctx.moveTo(p.x, p.y);
    }
  }
  ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, fade) * 0.82})`;
  ctx.lineWidth = WAVE_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  return true;
}

function frame(now) {
  bindSocket();
  if (!ctx) return requestAnimationFrame(frame);
  ctx.clearRect(0, 0, width, height);
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    if (!drawRing(waves[i], now)) waves.splice(i, 1);
  }
  requestAnimationFrame(frame);
}

function syncWaters(world) {
  waters.length = 0;
  if (!Array.isArray(world?.waters)) return;
  for (const water of world.waters) {
    if (!water || !Number.isFinite(water.x) || !Number.isFinite(water.y) || !Number.isFinite(water.scale)) continue;
    if (water.model !== 'patch-water.glb' && water.model !== 'patch-water-large.glb') continue;
    waters.push({ ...water });
  }
}

function bindSocket() {
  if (!window.echoSocket || window.echoSocket === socketBound) return;
  socketBound = window.echoSocket;
  socketBound.on('echo:world', syncWaters);
  // game.js may receive the first world snapshot before this module binds.
  if (Array.isArray(window.echoWorld?.waters)) syncWaters(window.echoWorld);
}

window.addEventListener('resize', resize, { passive: true });
window.addEventListener('echo:player-movement', onPlayerMovement);
resize();
requestAnimationFrame(frame);

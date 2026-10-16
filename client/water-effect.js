const ISO = { x: 0.8660254, y: 0.5 };
const STEP_DISTANCE = 12;
const MIN_SPEED = 18;
const WAVE_DURATION = 760;
const WAVE_DELAY = 75;
const START_RADIUS = 2.5;
const MAX_RADIUS = 15;
const LINE_WIDTH = 1.7;
const SAMPLE_COUNT = 72;
const MAX_WAVES = 24;

const game = document.querySelector('#game');
const canvas = document.createElement('canvas');
canvas.id = 'water-waves';
canvas.setAttribute('aria-hidden', 'true');
canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:3.5;';
game?.appendChild(canvas);

const ctx = canvas.getContext('2d', { alpha: true });
let width = 1;
let height = 1;
let dpr = 1;
let playerX = 0;
let playerY = 0;
let cameraX = 0;
let cameraY = 0;
let playerVX = 0;
let playerVY = 0;
let inWater = false;
let distanceAccumulator = STEP_DISTANCE;
let lastMovementAt = 0;
let lastWaveAt = 0;
let waves = [];

function resize() {
  const rect = game?.getBoundingClientRect();
  width = Math.max(1, rect?.width || window.innerWidth);
  height = Math.max(1, rect?.height || window.innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function isoProject(x, y) {
  return { x: (x - y) * ISO.x, y: (x + y) * ISO.y };
}

function worldToScreen(x, y) {
  const p = isoProject(x, y);
  const c = isoProject(cameraX, cameraY);
  return { x: width / 2 + p.x - c.x, y: height / 2 + p.y - c.y };
}

function spawnWave(x, y, now) {
  while (waves.length + 3 > MAX_WAVES) waves.shift();
  for (let ring = 0; ring < 3; ring += 1) {
    waves.push({ x, y, born: now + ring * WAVE_DELAY, ring });
  }
}

function onWaterState(event) {
  const detail = event.detail || {};
  if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
  const wasInWater = inWater;
  inWater = detail.inWater === true;
  playerX = detail.x;
  playerY = detail.y;
  playerVX = Number.isFinite(detail.vx) ? detail.vx : 0;
  playerVY = Number.isFinite(detail.vy) ? detail.vy : 0;
  cameraX = Number.isFinite(detail.cameraX) ? detail.cameraX : playerX;
  cameraY = Number.isFinite(detail.cameraY) ? detail.cameraY : playerY;

  const now = performance.now();
  const speed = Math.hypot(playerVX, playerVY);
  if (!inWater || speed < MIN_SPEED) {
    distanceAccumulator = STEP_DISTANCE;
    lastMovementAt = now;
    if (!inWater) lastWaveAt = 0;
    return;
  }

  // Emit an immediate first set on entering water, then one set per travelled distance.
  if (!wasInWater && inWater || !lastWaveAt) {
    spawnWave(playerX, playerY, now);
    lastWaveAt = now;
    distanceAccumulator = 0;
    lastMovementAt = now;
    return;
  }

  const elapsed = Math.min(0.05, Math.max(0, (now - lastMovementAt) / 1000));
  distanceAccumulator += speed * elapsed;
  if (distanceAccumulator >= STEP_DISTANCE) {
    distanceAccumulator %= STEP_DISTANCE;
    spawnWave(playerX, playerY, now);
    lastWaveAt = now;
  }
  lastMovementAt = now;
}

function drawRing(wave, now) {
  const age = now - wave.born;
  if (age < 0 || age >= WAVE_DURATION) return false;
  const progress = age / WAVE_DURATION;
  const eased = 1 - Math.pow(1 - progress, 2);
  const radius = START_RADIUS + (MAX_RADIUS - START_RADIUS) * eased;
  const opacity = Math.pow(1 - progress, 1.25) * 0.96;
  const center = worldToScreen(wave.x, wave.y);

  // Project the ring to the same flattened ellipse used by the isometric game.
  ctx.beginPath();
  for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
    const angle = (i / SAMPLE_COUNT) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius * 0.32;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  return true;
}

function frame(now) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  for (let i = waves.length - 1; i >= 0; i -= 1) {
    if (!drawRing(waves[i], now)) waves.splice(i, 1);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize, { passive: true });
window.addEventListener('echo:water-state', onWaterState);
resize();
requestAnimationFrame(frame);

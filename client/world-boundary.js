import { getWorldViewport } from './viewport-scale.js?v=echo-world-zoom-2';

const canvas = document.querySelector('#world');

const FIELD_CELLS = 50;
const CELL_SIZE = 84;
const FIELD_HALF = (FIELD_CELLS * CELL_SIZE) / 2;
const ISO = { x: 0.8660254, y: 0.5 };

let socket = null;
let playerX = 0;
let playerY = 0;
let targetX = 0;
let targetY = 0;
let playerVx = 0;
let playerVy = 0;
let lastSnapshotAt = 0;
let lastFrameAt = 0;

function bindSocket() {
  const current = window.echoSocket;
  if (!current || current === socket) return;

  socket = current;
  socket.on('echo:players', (players) => {
    if (!Array.isArray(players) || !socket?.id) return;
    const me = players.find((player) => player?.id === socket.id);
    if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.y)) return;

    targetX = me.x;
    targetY = me.y;
    playerVx = Number.isFinite(me.vx) ? me.vx : 0;
    playerVy = Number.isFinite(me.vy) ? me.vy : 0;

    if (!lastSnapshotAt) {
      playerX = targetX;
      playerY = targetY;
    }
    lastSnapshotAt = performance.now();
  });
}

function updatePlayerPosition(time) {
  const dt = lastFrameAt ? Math.min((time - lastFrameAt) / 1000, 0.05) : 0;
  lastFrameAt = time;

  if (!lastSnapshotAt) return;

  const since = Math.min(Math.max((time - lastSnapshotAt) / 1000, 0), 0.25);
  const predictedX = targetX + playerVx * since;
  const predictedY = targetY + playerVy * since;
  const blend = 1 - Math.exp(-18 * dt);
  playerX += (predictedX - playerX) * blend;
  playerY += (predictedY - playerY) * blend;
}

function worldToScreen(x, y, cameraX, cameraY, width, height) {
  return {
    x: width / 2 + (x - cameraX - (y - cameraY)) * ISO.x,
    y: height / 2 + (x - cameraX + (y - cameraY)) * ISO.y,
  };
}

function drawBoundary(time = performance.now()) {
  bindSocket();
  updatePlayerPosition(time);

  if (!canvas) {
    requestAnimationFrame(drawBoundary);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    requestAnimationFrame(drawBoundary);
    return;
  }

  const dpr = canvas.width / rect.width;
  const { width, height, scale } = getWorldViewport(rect.width, rect.height);
  const corners = [
    worldToScreen(-FIELD_HALF, -FIELD_HALF, playerX, playerY, width, height),
    worldToScreen(FIELD_HALF, -FIELD_HALF, playerX, playerY, width, height),
    worldToScreen(FIELD_HALF, FIELD_HALF, playerX, playerY, width, height),
    worldToScreen(-FIELD_HALF, FIELD_HALF, playerX, playerY, width, height),
  ];

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    requestAnimationFrame(drawBoundary);
    return;
  }

  const boundaryPath = () => {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
  };

  ctx.save();
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(2, 7, 14, .86)';
  ctx.fill('evenodd');

  boundaryPath();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(64, 190, 255, .95)';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(58, 181, 255, .95)';
  ctx.lineWidth = 8;
  ctx.stroke();
  boundaryPath();
  ctx.shadowColor = 'rgba(107, 214, 255, .9)';
  ctx.shadowBlur = 9;
  ctx.strokeStyle = 'rgba(104, 211, 255, 1)';
  ctx.lineWidth = 3;
  ctx.stroke();
  boundaryPath();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(190, 239, 255, .95)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  requestAnimationFrame(drawBoundary);
}

requestAnimationFrame(drawBoundary);

const jumpButton = document.querySelector('#jump');
jumpButton?.addEventListener('pointerdown', (event) => {
  const length = Math.hypot(playerVx, playerVy);
  if (length < 1) return;
  const jumpDistance = 420;
  const targetX = playerX + (playerVx / length) * jumpDistance;
  const targetY = playerY + (playerVy / length) * jumpDistance;
  if (targetX < -FIELD_HALF || targetX > FIELD_HALF || targetY < -FIELD_HALF || targetY > FIELD_HALF) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);


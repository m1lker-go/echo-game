const canvas = document.querySelector('#world');
const ctx = canvas.getContext('2d', { alpha: true });
const energyText = document.querySelector('#energy');
const coordsText = document.querySelector('#coords');
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');
const joystick = document.querySelector('#joystick');
const stick = document.querySelector('#stick');
const boostButton = document.querySelector('#boost');

const state = {
  x: 0, y: 0, vx: 0, vy: 0,
  energy: 0,
  cameraX: 0, cameraY: 0,
  inputX: 0, inputY: 0,
  width: 1, height: 1, dpr: 1,
  keys: new Set(),
  lastTime: 0,
  boostUntil: 0,
  boostCooldownUntil: 0,
  socket: null,
  others: new Map(),
  lastSent: 0,
};

const WORLD = { spacing: 62 };
const points = Array.from({ length: 34 }, (_, i) => {
  const angle = i * 2.399963229728653;
  const radius = 170 + (i % 9) * 58 + Math.floor(i / 9) * 100;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, size: 1.7 + (i % 3) * .6, pulse: i * .7, collected: false };
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}
window.addEventListener('resize', resize, { passive: true });
resize();

function setConnection(status, label) {
  connectionDot.classList.toggle('online', status === 'online');
  connectionDot.classList.toggle('offline', status === 'offline');
  connectionLabel.textContent = label;
}

function connectSocket() {
  if (!window.io) { setConnection('offline', 'режим без сервера'); return; }
  // ECHO is served at https://cat-fight.ru/echo/; Nginx proxies this dedicated path
  // to the ECHO server, keeping Cat Fighting's own Socket.IO endpoint separate.
  const url = window.ECHO_SERVER_URL || window.location.origin;
  try {
    state.socket = window.io(url, {
      path: '/echo/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 5000,
    });
    state.socket.on('connect', () => {
      setConnection('online', 'сервер подключён');
      state.socket.emit('echo:hello', { version: 1 });
    });
    state.socket.on('disconnect', () => setConnection('offline', 'нет соединения'));
    state.socket.on('connect_error', () => setConnection('offline', 'ожидаем сервер'));
    state.socket.on('echo:players', (players) => {
      if (!Array.isArray(players)) return;
      const next = new Map();
      for (const player of players) {
        if (player && player.id !== state.socket.id && Number.isFinite(player.x) && Number.isFinite(player.y)) next.set(player.id, player);
      }
      state.others = next;
    });
  } catch { setConnection('offline', 'режим без сервера'); }
}
connectSocket();

function drawGrid(time) {
  const { width, height, cameraX, cameraY } = state;
  const spacing = WORLD.spacing;
  const offsetX = ((-cameraX % spacing) + spacing) % spacing;
  const offsetY = ((-cameraY % spacing) + spacing) % spacing;
  const fade = ctx.createRadialGradient(width / 2, height / 2, 30, width / 2, height / 2, Math.max(width, height) * .68);
  fade.addColorStop(0, 'rgba(169,198,228,0.14)');
  fade.addColorStop(.55, 'rgba(115,146,181,0.055)');
  fade.addColorStop(1, 'rgba(80,105,140,0.006)');
  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offsetX; x <= width; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let y = offsetY; y <= height; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();

  ctx.fillStyle = 'rgba(195,222,247,0.12)';
  const startX = Math.floor((-cameraX - width / 2) / spacing) * spacing;
  const startY = Math.floor((-cameraY - height / 2) / spacing) * spacing;
  for (let wx = startX; wx < startX + width + spacing; wx += spacing) {
    for (let wy = startY; wy < startY + height + spacing; wy += spacing) {
      const sx = width / 2 + wx + cameraX;
      const sy = height / 2 + wy + cameraY;
      if (sx > -1 && sx < width + 1 && sy > -1 && sy < height + 1) {
        ctx.globalAlpha = .3 + .1 * Math.sin(time * .0006 + (wx + wy) * .02);
        ctx.fillRect(sx - .75, sy - .75, 1.5, 1.5);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function worldToScreen(x, y) {
  return { x: state.width / 2 + x - state.cameraX, y: state.height / 2 + y - state.cameraY };
}

function drawPoints(time) {
  for (const point of points) {
    if (point.collected) continue;
    const p = worldToScreen(point.x, point.y);
    if (p.x < -24 || p.y < -24 || p.x > state.width + 24 || p.y > state.height + 24) continue;
    const pulse = .65 + .35 * Math.sin(time * .002 + point.pulse);
    ctx.beginPath();
    ctx.fillStyle = `rgba(210,238,255,${.45 + .5 * pulse})`;
    ctx.shadowBlur = 11 * pulse;
    ctx.shadowColor = 'rgba(180,222,255,.9)';
    ctx.arc(p.x, p.y, point.size * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(235,247,255,.25)';
    ctx.arc(p.x, p.y, point.size * 3.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGhost(x, y, time, label = '0', isOther = false) {
  const p = worldToScreen(x, y);
  const bob = Math.sin(time * .0028 + (isOther ? x : 0)) * 2.2;
  const scale = isOther ? .88 : 1;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.scale(scale, scale);
  const halo = ctx.createRadialGradient(0, 4, 2, 0, 4, 45);
  halo.addColorStop(0, isOther ? 'rgba(190,222,255,.22)' : 'rgba(207,238,255,.28)');
  halo.addColorStop(1, 'rgba(168,205,245,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 4, 45, 49, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'rgba(221,244,255,.9)';
  ctx.shadowBlur = isOther ? 12 : 18;
  ctx.fillStyle = isOther ? 'rgba(184,207,229,.88)' : 'rgba(236,247,255,.95)';
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.bezierCurveTo(14, -26, 20, -13, 18, 0);
  ctx.lineTo(17, 15);
  ctx.quadraticCurveTo(10, 12, 6, 19);
  ctx.quadraticCurveTo(2, 13, -2, 19);
  ctx.quadraticCurveTo(-8, 12, -16, 16);
  ctx.lineTo(-17, 0);
  ctx.bezierCurveTo(-20, -13, -13, -26, 0, -26);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(10,16,24,.9)';
  ctx.beginPath();
  ctx.ellipse(-5.5, -8, 1.9, 3.1, -.12, 0, Math.PI * 2);
  ctx.ellipse(5.5, -8, 1.9, 3.1, .12, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isOther ? 'rgba(216,230,246,.68)' : 'rgba(244,250,255,.9)';
  ctx.shadowColor = 'rgba(193,226,255,.8)';
  ctx.shadowBlur = 7;
  ctx.fillText(String(label), 0, -39);
  ctx.restore();
}

function draw(time) {
  ctx.clearRect(0, 0, state.width, state.height);
  drawGrid(time);
  drawPoints(time);
  for (const player of state.others.values()) drawGhost(player.x, player.y, time, player.energy ?? 0, true);
  drawGhost(state.x, state.y, time, state.energy, false);
}

function beginBoost() {
  const now = performance.now();
  if (now < state.boostCooldownUntil) return;
  state.boostUntil = now + 480;
  state.boostCooldownUntil = now + 3600;
  boostButton.classList.add('active');
  setTimeout(() => boostButton.classList.remove('active'), 480);
}
boostButton.addEventListener('pointerdown', (event) => { event.preventDefault(); beginBoost(); });

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
  state.keys.add(key);
  if (key === ' ' || key === 'shift') beginBoost();
}, { passive: false });
window.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());

let joystickPointer = null;
function updateJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx;
  let dy = event.clientY - cy;
  const max = rect.width * .31;
  const length = Math.hypot(dx, dy);
  if (length > max) { dx = dx / length * max; dy = dy / length * max; }
  state.inputX = dx / max;
  state.inputY = dy / max;
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
}
joystick.addEventListener('pointerdown', (event) => { joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); updateJoystick(event); });
joystick.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointer) updateJoystick(event); });
function releaseJoystick(event) {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = null; state.inputX = 0; state.inputY = 0; stick.style.transform = 'translate(0,0)';
}
joystick.addEventListener('pointerup', releaseJoystick);
joystick.addEventListener('pointercancel', releaseJoystick);
joystick.addEventListener('lostpointercapture', () => { joystickPointer = null; state.inputX = 0; state.inputY = 0; stick.style.transform = 'translate(0,0)'; });

function getInput() {
  let x = state.inputX;
  let y = state.inputY;
  if (state.keys.has('a') || state.keys.has('arrowleft')) x -= 1;
  if (state.keys.has('d') || state.keys.has('arrowright')) x += 1;
  if (state.keys.has('w') || state.keys.has('arrowup')) y -= 1;
  if (state.keys.has('s') || state.keys.has('arrowdown')) y += 1;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y };
}

function update(dt, time) {
  const input = getInput();
  const speed = time < state.boostUntil ? 300 : 155;
  const smoothing = Math.min(1, dt * 12);
  state.vx += (input.x * speed - state.vx) * smoothing;
  state.vy += (input.y * speed - state.vy) * smoothing;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  for (const point of points) {
    if (!point.collected && Math.hypot(state.x - point.x, state.y - point.y) < 22) {
      point.collected = true;
      state.energy += 1;
      energyText.textContent = String(state.energy);
    }
  }
  if (points.every((point) => point.collected)) {
    for (const point of points) {
      point.collected = false;
      const angle = Math.random() * Math.PI * 2;
      const radius = 210 + Math.random() * 1200;
      point.x = Math.cos(angle) * radius;
      point.y = Math.sin(angle) * radius;
    }
  }
  state.cameraX += (state.x - state.cameraX) * Math.min(1, dt * 5);
  state.cameraY += (state.y - state.cameraY) * Math.min(1, dt * 5);
  coordsText.textContent = `${Math.round(state.x)} · ${Math.round(state.y)}`;
  if (state.socket?.connected && time - state.lastSent > 80) {
    state.lastSent = time;
    state.socket.emit('echo:move', { x: Math.round(state.x), y: Math.round(state.y), energy: state.energy });
  }
}
function frame(time) {
  const dt = state.lastTime ? Math.min((time - state.lastTime) / 1000, .05) : 0;
  state.lastTime = time;
  update(dt, time);
  draw(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

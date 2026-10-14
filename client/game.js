import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

const canvas = document.querySelector('#world');
const modelCanvas = document.querySelector('#models');
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

const WORLD = { spacing: 84 };
const ISO = {
  x: 0.8660254,
  y: 0.5,
};
const points = Array.from({ length: 34 }, (_, i) => {
  const angle = i * 2.399963229728653;
  const radius = 170 + (i % 9) * 58 + Math.floor(i / 9) * 100;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, size: 5 + (i % 3), pulse: i * .7, collected: false };
});

const modelScene = new THREE.Scene();
const modelCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
modelCamera.position.z = 100;
const modelRenderer = new THREE.WebGLRenderer({ canvas: modelCanvas, alpha: true, antialias: true });
modelRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
modelRenderer.outputColorSpace = THREE.SRGBColorSpace;
modelRenderer.setClearColor(0x000000, 0);
modelScene.add(new THREE.AmbientLight(0xffffff, 2.2));
const keyLight = new THREE.DirectionalLight(0xd9eeff, 3.5);
keyLight.position.set(-40, 80, 120);
modelScene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9ed7ff, 2.2);
rimLight.position.set(60, 30, 100);
modelScene.add(rimLight);

const loader = new GLTFLoader();
const MODEL_URL = './assets/models/character-female-a.glb';
const modelCache = {
  source: null,
  clips: [],
  local: null,
  localAnimation: null,
  others: new Map(),
  ready: false,
};

function prepareModel(root, isOther = false) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.color) material.color.set(isOther ? 0xb7c9d9 : 0xf0f8ff);
      if ('emissive' in material) {
        material.emissive.set(isOther ? 0x557a98 : 0x9edcff);
        material.emissiveIntensity = isOther ? 0.45 : 0.75;
      }
      if ('roughness' in material) material.roughness = 0.42;
      if ('metalness' in material) material.metalness = 0.05;
    }
  });
  root.scale.setScalar(isOther ? 44 : 52);
  return root;
}

function findClip(clips, names) {
  const wanted = names.map((name) => name.toLowerCase());
  return clips.find((clip) => wanted.some((name) => clip.name.toLowerCase() === name))
    || clips.find((clip) => wanted.some((name) => clip.name.toLowerCase().includes(name)));
}

function setupAnimation(root, clips, isOther = false) {
  if (!clips?.length) return null;
  const mixer = new THREE.AnimationMixer(root);
  const idle = findClip(clips, ['idle', 'idle_01', 'idle-01']);
  const walk = findClip(clips, ['walk', 'walk_01', 'walk-01']);
  const action = idle || clips[0];
  if (action) mixer.clipAction(action).play();
  return { mixer, idle, walk, current: action, isOther };
}

function switchAnimation(animation, moving) {
  if (!animation) return;
  const next = moving && animation.walk ? animation.walk : animation.idle;
  if (!next || next === animation.current) return;
  const current = animation.mixer.clipAction(animation.current);
  const nextAction = animation.mixer.clipAction(next);
  nextAction.reset().fadeIn(0.15).play();
  current.fadeOut(0.15);
  animation.current = next;
}

loader.load(MODEL_URL, (gltf) => {
  modelCache.source = gltf.scene;
  modelCache.clips = gltf.animations || [];

  // A separate holder applies facing rotation after the model's own transforms
  // and animation tracks, so the correction cannot be overwritten by animation.
  const local = new THREE.Group();
  local.add(prepareModel(gltf.scene, false));
  modelCache.local = local;
  modelCache.localAnimation = setupAnimation(gltf.scene, modelCache.clips, false);
  local.userData.animation = modelCache.localAnimation;
  modelScene.add(local);
  modelCache.ready = true;
  console.log(`[echo] GLB loaded: ${MODEL_URL}; animations: ${modelCache.clips.length}`);
}, undefined, (error) => {
  console.error('[echo] failed to load character GLB:', error);
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  modelRenderer.setPixelRatio(state.dpr);
  modelRenderer.setSize(state.width, state.height, false);
  modelCamera.left = -state.width / 2;
  modelCamera.right = state.width / 2;
  modelCamera.top = state.height / 2;
  modelCamera.bottom = -state.height / 2;
  modelCamera.updateProjectionMatrix();
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

function isoProject(x, y) {
  return {
    x: (x - y) * ISO.x,
    y: (x + y) * ISO.y,
  };
}

function drawIsoLine(a, b) {
  const pa = isoProject(a.x - state.cameraX, a.y - state.cameraY);
  const pb = isoProject(b.x - state.cameraX, b.y - state.cameraY);
  ctx.moveTo(Math.round(state.width / 2 + pa.x) + 0.5, Math.round(state.height / 2 + pa.y) + 0.5);
  ctx.lineTo(Math.round(state.width / 2 + pb.x) + 0.5, Math.round(state.height / 2 + pb.y) + 0.5);
}

function drawGrid(time) {
  const { width, height } = state;
  const spacing = WORLD.spacing;
  const fade = ctx.createRadialGradient(width / 2, height / 2, 30, width / 2, height / 2, Math.max(width, height) * .7);
  fade.addColorStop(0, 'rgba(169,198,228,0.15)');
  fade.addColorStop(.55, 'rgba(115,146,181,0.055)');
  fade.addColorStop(1, 'rgba(80,105,140,0.004)');

  const worldRangeX = Math.ceil(width / ISO.x) + spacing * 2;
  const worldRangeY = Math.ceil(height / ISO.y) + spacing * 2;
  const startX = Math.floor((state.cameraX - worldRangeX) / spacing) * spacing;
  const endX = Math.ceil((state.cameraX + worldRangeX) / spacing) * spacing;
  const startY = Math.floor((state.cameraY - worldRangeY) / spacing) * spacing;
  const endY = Math.ceil((state.cameraY + worldRangeY) / spacing) * spacing;

  ctx.strokeStyle = fade;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let wx = startX; wx <= endX; wx += spacing) {
    drawIsoLine(
      { x: wx, y: state.cameraY - worldRangeY },
      { x: wx, y: state.cameraY + worldRangeY },
    );
  }
  for (let wy = startY; wy <= endY; wy += spacing) {
    drawIsoLine(
      { x: state.cameraX - worldRangeX, y: wy },
      { x: state.cameraX + worldRangeX, y: wy },
    );
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(195,222,247,0.12)';
  for (let wx = startX; wx <= endX; wx += spacing) {
    for (let wy = startY; wy <= endY; wy += spacing) {
      const p = worldToScreen(wx, wy);
      if (p.x > -2 && p.x < width + 2 && p.y > -2 && p.y < height + 2) {
        ctx.globalAlpha = .25 + .1 * Math.sin(time * .0006 + (wx + wy) * .02);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function worldToScreen(x, y) {
  const p = isoProject(x, y);
  const camera = isoProject(state.cameraX, state.cameraY);
  return {
    x: Math.round(state.width / 2 + p.x - camera.x),
    y: Math.round(state.height / 2 + p.y - camera.y),
  };
}

function drawPoints(time) {
  ctx.save();
  ctx.shadowBlur = 0;
  for (const point of points) {
    if (point.collected) continue;
    const p = worldToScreen(point.x, point.y);
    if (p.x < -30 || p.y < -30 || p.x > state.width + 30 || p.y > state.height + 30) continue;
    const pulse = .65 + .35 * Math.sin(time * .002 + point.pulse);
    const radius = point.size * pulse;
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.2);
    halo.addColorStop(0, 'rgba(210,238,255,0.38)');
    halo.addColorStop(0.35, 'rgba(210,238,255,0.15)');
    halo.addColorStop(1, 'rgba(210,238,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(220,242,255,${.65 + .35 * pulse})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEnergyLabel(x, y, label, isOther = false) {
  const p = worldToScreen(x, y);
  ctx.save();
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isOther ? 'rgba(216,230,246,.68)' : 'rgba(244,250,255,.9)';
  ctx.shadowColor = 'rgba(193,226,255,.8)';
  ctx.shadowBlur = 7;
  ctx.fillText(String(label), p.x, p.y - (isOther ? 58 : 70));
  ctx.restore();
}

function updateModel(root, animation, x, y, vx, vy, time, label, isOther = false) {
  if (!root) return;
  const p = worldToScreen(x, y);
  root.position.x = p.x - state.width / 2;
  root.position.y = -(p.y - state.height / 2) + Math.sin(time * .0028 + x * .02) * (Math.hypot(vx || 0, vy || 0) > 18 ? 1.3 : 1.8);
  root.position.z = 0;

  // Rotate the holder, not the animated GLB root, so animation tracks cannot
  // reset or cancel the facing correction. A quarter turn compensates the
  // Kenney Mini Characters model's local forward axis.
  const moving = Math.hypot(vx || 0, vy || 0) > 18;
  if (moving) {
    const screenVX = ((vx || 0) - (vy || 0)) * ISO.x;
    const screenVY = ((vx || 0) + (vy || 0)) * ISO.y;
    root.rotation.y = Math.atan2(screenVX, -screenVY) + Math.PI / 2;
  }
  root.scale.setScalar(isOther ? 44 : 52);
  switchAnimation(animation, moving);
  drawEnergyLabel(x, y, label, isOther);
}

function ensureOtherModel(player) {
  if (!modelCache.source) return null;
  let entry = modelCache.others.get(player.id);
  if (entry) return entry;
  const holder = new THREE.Group();
  const clone = SkeletonUtils.clone(modelCache.source);
  prepareModel(clone, true);
  holder.add(clone);
  const animation = setupAnimation(clone, modelCache.clips, true);
  modelScene.add(holder);
  entry = { root: holder, animation };
  modelCache.others.set(player.id, entry);
  return entry;
}

function drawModels(time, dt) {
  if (!modelCache.ready) return;
  updateModel(modelCache.local, modelCache.localAnimation, state.x, state.y, state.vx, state.vy, time, state.energy, false);

  const alive = new Set();
  for (const player of state.others.values()) {
    alive.add(player.id);
    const entry = ensureOtherModel(player);
    if (!entry) continue;
    updateModel(entry.root, entry.animation, player.x, player.y, player.vx ?? 0, player.vy ?? 0, time, player.energy ?? 0, true);
  }
  for (const [id, entry] of modelCache.others) {
    if (!alive.has(id)) {
      modelScene.remove(entry.root);
      modelCache.others.delete(id);
    }
  }

  modelCache.localAnimation?.mixer.update(dt);
  for (const entry of modelCache.others.values()) entry.animation?.mixer.update(dt);
  modelRenderer.render(modelScene, modelCamera);
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

  state.cameraX = state.x;
  state.cameraY = state.y;

  coordsText.textContent = `${Math.round(state.x)} · ${Math.round(state.y)}`;
  if (state.socket?.connected && time - state.lastSent > 80) {
    state.lastSent = time;
    state.socket.emit('echo:move', { x: Math.round(state.x), y: Math.round(state.y), energy: state.energy, vx: Math.round(state.vx), vy: Math.round(state.vy) });
  }
}

function frame(time) {
  const dt = state.lastTime ? Math.min((time - state.lastTime) / 1000, .05) : 0;
  update(dt, time);
  drawGrid(time);
  drawPoints(time);
  drawModels(time, dt);
  state.lastTime = time;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

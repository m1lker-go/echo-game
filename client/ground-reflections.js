import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/SkeletonUtils.js';

const canvas = document.createElement('canvas');
canvas.id = 'ground-reflections';
canvas.setAttribute('aria-hidden', 'true');
Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' });
const game = document.querySelector('#game');
const worldCanvas = document.querySelector('#world');
const foodCanvas = document.querySelector('#shared-food');
const modelCanvas = document.querySelector('#models');
if (game) game.insertBefore(canvas, foodCanvas || modelCanvas || null);
if (worldCanvas) worldCanvas.style.zIndex = '0';
if (foodCanvas) foodCanvas.style.zIndex = '2';
if (modelCanvas) modelCanvas.style.zIndex = '3';

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
camera.position.z = 100;
const ambient = new THREE.AmbientLight(0x4f6b7d, 2.0);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xb9dcf5, 3.6);
key.position.set(-100, 57.735, 0);
scene.add(key);

const ISO = { x: 0.8660254, y: 0.5 };
const REFLECTION_OPACITY = 0.68;
const REFLECTION_OFFSET = -18;
const TREE_BASE_SCALE = 50;
const TREE_MIN = 1.5;
const TREE_MAX = 2.5;
const TREE_URL = './assets/models/objects/tree.glb';
const DEFAULT_MODEL = 'character-female-a.glb';
const ALLOWED_MODELS = new Set([
  'character-female-a.glb','character-female-b.glb','character-female-c.glb','character-female-d.glb','character-female-e.glb','character-female-f.glb',
  'character-male-a.glb','character-male-b.glb','character-male-c.glb','character-male-d.glb','character-male-e.glb','character-male-f.glb',
]);
const loader = new GLTFLoader();
const treeState = { source: null, items: new Map() };
const playerData = { selfId: null, x: 0, y: 0, others: new Map() };
const playerRender = new Map();
const modelCache = new Map();

function project(x, y) {
  const p = { x: (x - y) * ISO.x, y: (x + y) * ISO.y };
  const c = { x: (playerData.x - playerData.y) * ISO.x, y: (playerData.x + playerData.y) * ISO.y };
  return { x: p.x - c.x + canvas.clientWidth / 2, y: p.y - c.y + canvas.clientHeight / 2 };
}
function prepareReflection(root) {
  root.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    child.material = materials.map(source => {
      const material = source.clone();
      material.transparent = true;
      material.opacity = REFLECTION_OPACITY;
      material.depthWrite = false;
      material.depthTest = false;
      material.side = THREE.DoubleSide;
      material.toneMapped = false;
      return material;
    });
    child.castShadow = false;
    child.receiveShadow = false;
  });
  root.scale.y *= -1;
  root.renderOrder = -10;
  return root;
}
function createReflection(source, scale = 1) {
  const reflection = prepareReflection(cloneSkeleton(source));
  reflection.scale.multiplyScalar(scale);
  scene.add(reflection);
  return reflection;
}
function updateReflection(root, x, y, rotationY = 0) {
  if (!root) return;
  const p = project(x, y);
  root.position.set(p.x - canvas.clientWidth / 2, -(p.y - canvas.clientHeight / 2) + REFLECTION_OFFSET, -0.5);
  root.rotation.y = rotationY;
}
function loadTree() {
  loader.load(TREE_URL, gltf => {
    treeState.source = gltf.scene;
    rebuildTrees();
    console.log('[echo] glossy ground tree reflections ready');
  }, undefined, error => console.error('[echo] failed to load reflection tree', error));
}
function rebuildTrees() {
  for (const item of treeState.items.values()) scene.remove(item.root);
  treeState.items.clear();
  const trees = Array.isArray(window.echoWorld?.trees) ? window.echoWorld.trees : [];
  for (const tree of trees) {
    if (!treeState.source || !Number.isFinite(tree.x) || !Number.isFinite(tree.y)) continue;
    const scale = Math.max(TREE_MIN, Math.min(TREE_MAX, Number(tree.scale) || TREE_MIN));
    const root = createReflection(treeState.source, TREE_BASE_SCALE * scale);
    root.rotation.y = Number.isFinite(tree.rotation) ? tree.rotation : 0;
    treeState.items.set(tree.id, { root, x: tree.x, y: tree.y, rotation: root.rotation.y });
  }
}
function loadCharacter(skin) {
  const safe = ALLOWED_MODELS.has(skin) ? skin : DEFAULT_MODEL;
  if (modelCache.has(safe)) return;
  modelCache.set(safe, null);
  loader.load(`./assets/models/${safe}`, gltf => modelCache.set(safe, { scene: gltf.scene, clips: gltf.animations || [] }), undefined, error => {
    modelCache.delete(safe);
    console.error(`[echo] failed to load reflection character: ${safe}`, error);
  });
}
function ensurePlayerReflection(id, skin) {
  const existing = playerRender.get(id);
  if (existing && existing.skin === skin) return existing;
  if (existing) scene.remove(existing.root);
  const source = modelCache.get(skin);
  if (!source) { loadCharacter(skin); return null; }
  const root = createReflection(source.scene, id === playerData.selfId ? 50 : 42);
  const mixer = source.clips.length ? new THREE.AnimationMixer(root) : null;
  const idle = source.clips.find(c => /idle/i.test(c.name)) || source.clips[0];
  if (mixer && idle) mixer.clipAction(idle).play();
  const entry = { root, mixer, skin };
  playerRender.set(id, entry);
  return entry;
}
function updatePlayers() {
  const alive = new Set();
  if (playerData.selfId) {
    const skin = ALLOWED_MODELS.has(localStorage.getItem('echo.selectedModel')) ? localStorage.getItem('echo.selectedModel') : DEFAULT_MODEL;
    const entry = ensurePlayerReflection(playerData.selfId, skin);
    if (entry) {
      updateReflection(entry.root, playerData.x, playerData.y);
      entry.root.visible = true;
      alive.add(playerData.selfId);
    }
  }
  for (const [id, p] of playerData.others) {
    const entry = ensurePlayerReflection(id, p.skin);
    if (!entry) continue;
    updateReflection(entry.root, p.x, p.y);
    alive.add(id);
  }
  for (const [id, entry] of playerRender) {
    if (!alive.has(id)) {
      scene.remove(entry.root);
      entry.mixer?.stopAllAction();
      playerRender.delete(id);
    }
  }
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  renderer.setPixelRatio(dpr);
  renderer.setSize(rect.width, rect.height, false);
  camera.left = -rect.width / 2;
  camera.right = rect.width / 2;
  camera.top = rect.height / 2;
  camera.bottom = -rect.height / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize, { passive: true });
resize();

const waitForSocket = setInterval(() => {
  const socket = window.echoSocket;
  if (!socket) return;
  clearInterval(waitForSocket);
  socket.on('echo:world', world => { window.echoWorld = world; rebuildTrees(); });
  socket.on('echo:players', players => {
    if (!Array.isArray(players)) return;
    const next = new Map();
    for (const p of players) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.id === socket.id) {
        playerData.selfId = p.id;
        playerData.x = p.x;
        playerData.y = p.y;
      } else {
        const skin = ALLOWED_MODELS.has(p.skin) ? p.skin : DEFAULT_MODEL;
        next.set(p.id, { x: p.x, y: p.y, skin });
        loadCharacter(skin);
      }
    }
    playerData.others = next;
  });
}, 50);
loadTree();
for (const skin of ALLOWED_MODELS) loadCharacter(skin);
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  updatePlayers();
  for (const item of treeState.items.values()) updateReflection(item.root, item.x, item.y, item.rotation);
  for (const entry of playerRender.values()) entry.mixer?.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

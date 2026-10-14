// ECHO main menu, character selection and menu background animation.
// Character selection is persisted locally and passed to the game through localStorage.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const characters = [
  ['character-female-a.glb', 'Девушка A'],
  ['character-female-b.glb', 'Девушка B'],
  ['character-female-c.glb', 'Девушка C'],
  ['character-female-d.glb', 'Девушка D'],
  ['character-female-e.glb', 'Девушка E'],
  ['character-female-f.glb', 'Девушка F'],
  ['character-male-a.glb', 'Парень A'],
  ['character-male-b.glb', 'Парень B'],
  ['character-male-c.glb', 'Парень C'],
  ['character-male-d.glb', 'Парень D'],
  ['character-male-e.glb', 'Парень E'],
  ['character-male-f.glb', 'Парень F'],
];

const storageKey = 'echo.selectedModel';
const defaultModel = characters[0][0];
let selectedModel = localStorage.getItem(storageKey) || defaultModel;
window.ECHO_SELECTED_MODEL = selectedModel;

const menu = document.querySelector('#main-menu');
const mainScreen = document.querySelector('#menu-main');
const characterScreen = document.querySelector('#menu-character');
const placeholderScreen = document.querySelector('#menu-placeholder');
const placeholderTitle = document.querySelector('#placeholder-title');
const characterGrid = document.querySelector('#character-grid');
const previewCanvas = document.querySelector('#character-preview');
const startButton = document.querySelector('#menu-start');
const characterButton = document.querySelector('#menu-character-button');
const settingsButton = document.querySelector('#menu-settings');
const ratingButton = document.querySelector('#menu-rating');
const characterBack = document.querySelector('#character-back');
const placeholderBack = document.querySelector('#placeholder-back');
const foodCanvas = document.querySelector('#menu-food');

function showScreen(screen) {
  mainScreen.hidden = screen !== 'main';
  characterScreen.hidden = screen !== 'character';
  placeholderScreen.hidden = screen !== 'placeholder';
}

function openMenu() {
  menu.classList.remove('is-hidden');
  showScreen('main');
}

function startGame() {
  window.ECHO_SELECTED_MODEL = selectedModel;
  const url = new URL(window.location.href);
  url.searchParams.set('play', '1');
  window.location.href = url.toString();
}

function openPlaceholder(title) {
  placeholderTitle.textContent = title;
  showScreen('placeholder');
}

startButton.addEventListener('click', startGame);
characterButton.addEventListener('click', () => showScreen('character'));
settingsButton.addEventListener('click', () => openPlaceholder('НАСТРОЙКИ'));
ratingButton.addEventListener('click', () => openPlaceholder('РЕЙТИНГ'));
characterBack.addEventListener('click', openMenu);
placeholderBack.addEventListener('click', openMenu);

for (const [file, label] of characters) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'character-card';
  button.dataset.model = file;
  button.innerHTML = `<span class="character-card-name">${label}</span><span class="character-card-mark">${file.includes('female') ? '♀' : '♂'}</span>`;
  button.addEventListener('click', () => {
    selectedModel = file;
    localStorage.setItem(storageKey, selectedModel);
    window.ECHO_SELECTED_MODEL = selectedModel;
    renderCharacterState();
    loadPreview(selectedModel);
  });
  characterGrid.appendChild(button);
}

function renderCharacterState() {
  for (const card of characterGrid.children) {
    card.classList.toggle('selected', card.dataset.model === selectedModel);
  }
}
renderCharacterState();

const renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-120, 120, 120, -120, 0.1, 1000);
camera.position.set(0, 20, 260);
camera.lookAt(0, 30, 0);
scene.add(new THREE.AmbientLight(0xffffff, 2.3));
const light = new THREE.DirectionalLight(0xffffff, 3.2);
light.position.set(-60, 100, 180);
scene.add(light);
const loader = new GLTFLoader();
let previewRoot = null;
let previewMixer = null;
let previewRequest = 0;

function resizePreview() {
  const rect = previewCanvas.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.left = -Math.max(1, rect.width) / 2;
  camera.right = Math.max(1, rect.width) / 2;
  camera.top = Math.max(1, rect.height) / 2;
  camera.bottom = -Math.max(1, rect.height) / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizePreview, { passive: true });
resizePreview();

function disposePreview(root) {
  if (!root) return;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose?.();
  });
}

function loadPreview(file) {
  const request = ++previewRequest;
  loader.load(`./assets/models/${file}`, (gltf) => {
    if (request !== previewRequest) {
      disposePreview(gltf.scene);
      return;
    }
    if (previewRoot) {
      scene.remove(previewRoot);
      disposePreview(previewRoot);
    }
    previewRoot = gltf.scene;
    previewRoot.scale.setScalar(46);
    previewRoot.position.set(0, -55, 0);
    scene.add(previewRoot);
    previewMixer = gltf.animations?.length ? new THREE.AnimationMixer(previewRoot) : null;
    const idle = gltf.animations?.find((clip) => /idle/i.test(clip.name));
    if (previewMixer && idle) previewMixer.clipAction(idle).play();
  }, undefined, (error) => console.error('[echo] character preview failed:', error));
}

function renderPreview(time) {
  previewMixer?.update(0.016);
  if (previewRoot) previewRoot.rotation.y = Math.sin(time * 0.00035) * 0.12;
  renderer.render(scene, camera);
  requestAnimationFrame(renderPreview);
}
loadPreview(selectedModel);
requestAnimationFrame(renderPreview);

const food = Array.from({ length: 46 }, (_, index) => ({
  x: Math.random(), y: Math.random(), size: 1.8 + Math.random() * 2.6,
  phase: Math.random() * Math.PI * 2,
  speed: 0.00008 + Math.random() * 0.00012,
  drift: 0.00015 + Math.random() * 0.00025,
  seed: index,
}));
const foodCtx = foodCanvas.getContext('2d');
function resizeFood() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  foodCanvas.width = Math.round(window.innerWidth * dpr);
  foodCanvas.height = Math.round(window.innerHeight * dpr);
  foodCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeFood, { passive: true });
resizeFood();
function drawFood(time) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  foodCtx.clearRect(0, 0, w, h);
  for (const point of food) {
    const x = (point.x * w + Math.sin(time * point.speed + point.phase) * 28 + w) % w;
    const y = (point.y * h + Math.cos(time * point.drift + point.phase) * 22 + h) % h;
    const pulse = 0.55 + 0.45 * Math.sin(time * 0.0022 + point.phase);
    const r = point.size * pulse;
    const halo = foodCtx.createRadialGradient(x, y, 0, x, y, r * 4.2);
    halo.addColorStop(0, 'rgba(220,242,255,.38)');
    halo.addColorStop(.3, 'rgba(220,242,255,.14)');
    halo.addColorStop(1, 'rgba(220,242,255,0)');
    foodCtx.fillStyle = halo;
    foodCtx.beginPath(); foodCtx.arc(x, y, r * 4.2, 0, Math.PI * 2); foodCtx.fill();
    foodCtx.fillStyle = `rgba(235,248,255,${0.28 + pulse * 0.42})`;
    foodCtx.beginPath(); foodCtx.arc(x, y, r, 0, Math.PI * 2); foodCtx.fill();
  }
  requestAnimationFrame(drawFood);
}
requestAnimationFrame(drawFood);

const params = new URLSearchParams(window.location.search);
if (params.get('play') === '1') {
  menu.classList.add('is-hidden');
}

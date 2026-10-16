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
const settingsScreen = document.querySelector('#menu-settings-screen');
const characterGrid = document.querySelector('#character-grid');
const startButton = document.querySelector('#menu-start');
const characterButton = document.querySelector('#menu-character-button');
const settingsButton = document.querySelector('#menu-settings');
const ratingButton = document.querySelector('#menu-rating');
const characterBack = document.querySelector('#character-back');
const placeholderBack = document.querySelector('#placeholder-back');
const settingsBack = document.querySelector('#settings-back');
const languageButtons = document.querySelectorAll('.language-option');
const i18nReady = window.ECHO_I18N_READY || Promise.resolve(false);

function showScreen(screen) {
  mainScreen.hidden = screen !== 'main';
  characterScreen.hidden = screen !== 'character';
  placeholderScreen.hidden = screen !== 'placeholder';
  if (settingsScreen) settingsScreen.hidden = screen !== 'settings';
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

function openSettings() {
  showScreen('settings');
  refreshLocalizedUI();
}

startButton.addEventListener('click', startGame);
characterButton.addEventListener('click', () => showScreen('character'));
settingsButton.addEventListener('click', openSettings);
ratingButton.addEventListener('click', () => openPlaceholder('РЕЙТИНГ'));
characterBack.addEventListener('click', openMenu);
placeholderBack.addEventListener('click', openMenu);
settingsBack?.addEventListener('click', openMenu);

const loader = new GLTFLoader();
const cardViews = new Map();

// Keep a single WebGL context for all character previews. Mobile browsers limit
// the number of simultaneously active WebGL contexts; one renderer per card
// causes some previews to turn white or lose their context on phones.
let previewRenderer = null;
let previewPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
try {
  previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  previewRenderer.setPixelRatio(previewPixelRatio);
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewRenderer.setClearColor(0x000000, 0);
} catch (error) {
  console.error('[echo] shared character preview renderer failed to initialize', error);
}

const cardObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const view = cardViews.get(entry.target.dataset.model);
        if (view) view.visible = entry.isIntersecting;
      }
    }, { root: characterGrid, rootMargin: '100px 0px', threshold: 0 })
  : null;

function disposeScene(root) {
  if (!root) return;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose?.();
  });
}

function frameCharacter(root, camera, width, height, baseScale, basePosition) {
  // Always start from the original GLB transform. Re-framing must not compound scale/position.
  root.scale.copy(baseScale);
  root.position.copy(basePosition);
  root.updateMatrixWorld(true);

  const initialBox = new THREE.Box3().setFromObject(root);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const initialMax = Math.max(initialSize.x, initialSize.y, initialSize.z) || 1;
  const targetHeight = 2.2;
  root.scale.copy(baseScale).multiplyScalar(targetHeight / initialMax);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 0.75);

  root.position.set(
    basePosition.x - center.x,
    basePosition.y - center.y + 0.15,
    basePosition.z - center.z,
  );
  root.updateMatrixWorld(true);

  const aspect = Math.max(0.5, width / Math.max(1, height));
  camera.aspect = aspect;
  camera.fov = 25;

  const verticalDistance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const horizontalFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * aspect);
  const horizontalDistance = radius / Math.tan(horizontalFov * 0.5);
  const distance = Math.max(verticalDistance, horizontalDistance) * 1.22;

  camera.position.set(0, 0.15, distance);
  camera.near = Math.max(0.01, distance - radius * 2.2);
  camera.far = distance + radius * 3;
  camera.lookAt(0, 0.15, 0);
  camera.updateProjectionMatrix();
}

function createCharacterCard(file, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'character-card';
  button.dataset.model = file;
  const labelKey = file.replace('character-', '').replace('.glb', '').replaceAll('-', '_');
  button.setAttribute('aria-label', label);

  const canvas = document.createElement('canvas');
  canvas.className = 'character-card-preview';
  canvas.setAttribute('aria-hidden', 'true');

  const caption = document.createElement('span');
  caption.className = 'character-card-name';
  caption.textContent = label;

  button.append(canvas, caption);
  button.addEventListener('click', () => {
    selectedModel = file;
    localStorage.setItem(storageKey, selectedModel);
    window.ECHO_SELECTED_MODEL = selectedModel;
    renderCharacterState();
  });
  characterGrid.appendChild(button);

  // A 2D canvas receives the shared WebGL render, avoiding one GPU context per card.
  const context = canvas.getContext('2d', { alpha: true });

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7480, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 3.5);
  light.position.set(-3, 6, 7);
  scene.add(light);

  const camera = new THREE.PerspectiveCamera(25, 1, 0.01, 1000);
  const view = {
    button,
    canvas,
    context,
    scene,
    camera,
    root: null,
    mixer: null,
    visible: !cardObserver,
    baseScale: null,
    basePosition: null,
    lastTime: 0,
    width: 0,
    height: 0,
  };
  cardViews.set(file, view);
  cardObserver?.observe(button);

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const bufferWidth = Math.round(width * dpr);
    const bufferHeight = Math.round(height * dpr);
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.width = width;
    view.height = height;
    if (view.root && view.baseScale && view.basePosition) {
      frameCharacter(view.root, camera, width, height, view.baseScale, view.basePosition);
    }
  }

  loader.load(`./assets/models/${file}`, (gltf) => {
    const current = cardViews.get(file);
    if (!current || current !== view) {
      disposeScene(gltf.scene);
      return;
    }
    view.root = gltf.scene;
    view.baseScale = view.root.scale.clone();
    view.basePosition = view.root.position.clone();
    scene.add(view.root);
    resize();

    view.mixer = gltf.animations?.length ? new THREE.AnimationMixer(view.root) : null;
    const idle = gltf.animations?.find((clip) => /idle/i.test(clip.name));
    if (view.mixer && idle) view.mixer.clipAction(idle).play();

    // Wait for the grid/canvas layout to settle. F12 was accidentally triggering this via resize.
    requestAnimationFrame(() => resize());
    requestAnimationFrame(() => requestAnimationFrame(() => resize()));
  }, undefined, (error) => {
    console.error(`[echo] character card failed: ${file}`, error);
    if (context) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#080808';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#aeb8c4';
      context.font = '12px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText('МОДЕЛЬ НЕ ЗАГРУЖЕНА', canvas.width / 2, canvas.height / 2);
    }
  });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  resize();
  window.addEventListener('resize', resize, { passive: true });
}

function renderCharacterState() {
  for (const card of characterGrid.children) {
    card.classList.toggle('selected', card.dataset.model === selectedModel);
  }
}

for (const [file, label] of characters) createCharacterCard(file, label);
renderCharacterState();


function applyStaticTranslations() {
  if (typeof window.$t !== 'function') return;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) return;
    const translation = window.$t(key, element.textContent);
    if (element.tagName === 'INPUT' && element.hasAttribute('placeholder')) {
      element.placeholder = translation;
    } else if (element.classList.contains('brand') && element.querySelector('.brand-dot')) {
      // Keep the blue dot in its own span when changing the game logo language.
      const dot = element.querySelector('.brand-dot');
      element.replaceChildren(document.createTextNode(translation.replace(/\.$/, '')), dot);
    } else {
      element.textContent = translation;
    }
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', window.$t(element.dataset.i18nAriaLabel, element.getAttribute('aria-label') || ''));
  });
}

function updateLanguageButtons() {
  const current = window.ECHOI18n?.language || 'ru';
  document.querySelectorAll('.language-option').forEach((button) => {
    const active = button.dataset.language === current;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function refreshLocalizedUI() {
  applyStaticTranslations();
  updateLanguageButtons();
  const placeholderTitle = document.querySelector('#placeholder-title');
  if (placeholderTitle) {
    const currentTitle = placeholderTitle.textContent;
    if (currentTitle === 'РЕЙТИНГ' || currentTitle === 'LEADERBOARD') {
      placeholderTitle.textContent = window.$t('menu:rating_title', currentTitle);
    }
  }
  const placeholderDescription = document.querySelector('#placeholder-description');
  if (placeholderDescription) {
    placeholderDescription.textContent = window.$t('menu:placeholder_preparing', placeholderDescription.textContent);
  }
  const currentScreen = document.querySelector('#menu-character:not([hidden])')
    ? 'character'
    : document.querySelector('#menu-settings-screen:not([hidden])')
      ? 'settings'
      : document.querySelector('#menu-placeholder:not([hidden])')
        ? 'placeholder'
        : 'main';
  if (currentScreen === 'character') {
    for (const card of characterGrid.children) {
      const model = card.dataset.model || '';
      const labelKey = model.replace('character-', '').replace('.glb', '').replaceAll('-', '_');
      const caption = card.querySelector('.character-card-name');
      if (caption) caption.textContent = window.$t('menu:' + labelKey, caption?.textContent || '');
      card.setAttribute('aria-label', window.$t('menu:' + labelKey, caption?.textContent || ''));
    }
  }
}
window.addEventListener('echo:i18n-ready', refreshLocalizedUI);
window.addEventListener('echo:language-changed', refreshLocalizedUI);


i18nReady.then(() => {
  refreshLocalizedUI();
  for (const button of languageButtons) {
    button.addEventListener('click', async () => {
      const language = button.dataset.language;
      if (!window.ECHOI18n?.setLanguage) return;
      const changed = await window.ECHOI18n.setLanguage(language);
      if (changed) refreshLocalizedUI();
    });
  }
});

// Render visible previews sequentially through one shared GPU context.
let lastPreviewTime = 0;
function renderCharacterPreviews(time) {
  if (previewRenderer) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (dpr !== previewPixelRatio) {
      previewPixelRatio = dpr;
      previewRenderer.setPixelRatio(dpr);
    }

    for (const view of cardViews.values()) {
      if (!view.visible || !view.root || !view.context) continue;
      const width = Math.max(1, view.canvas.clientWidth);
      const height = Math.max(1, view.canvas.clientHeight);
      if (width !== view.width || height !== view.height) {
        const backingWidth = Math.round(width * dpr);
        const backingHeight = Math.round(height * dpr);
        if (view.canvas.width !== backingWidth || view.canvas.height !== backingHeight) {
          view.canvas.width = backingWidth;
          view.canvas.height = backingHeight;
        }
        view.context.setTransform(dpr, 0, 0, dpr, 0, 0);
        view.width = width;
        view.height = height;
        if (view.baseScale && view.basePosition) {
          frameCharacter(view.root, view.camera, width, height, view.baseScale, view.basePosition);
        }
      }

      const delta = view.lastTime ? Math.min((time - view.lastTime) / 1000, 0.05) : 0.016;
      view.lastTime = time;
      view.mixer?.update(delta);
      view.root.rotation.y = Math.sin(time * 0.00035 + view.button.dataset.model.length) * 0.08;

      previewRenderer.setSize(width, height, false);
      previewRenderer.render(view.scene, view.camera);
      view.context.clearRect(0, 0, width, height);
      view.context.drawImage(
        previewRenderer.domElement,
        0, 0, previewRenderer.domElement.width, previewRenderer.domElement.height,
        0, 0, width, height,
      );
    }
  }
  lastPreviewTime = time;
  requestAnimationFrame(renderCharacterPreviews);
}
requestAnimationFrame(renderCharacterPreviews);

const foodCanvas = document.querySelector('#menu-food');
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
  // Only remove auto-start; later modules still need debugWater/noReflections.
  const cleanedUrl = new URL(window.location.href);
  cleanedUrl.searchParams.delete('play');
  window.history.replaceState({}, document.title, cleanedUrl.pathname + cleanedUrl.search + cleanedUrl.hash);
}

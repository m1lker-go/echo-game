// ECHO main menu, character selection and menu background animation.
// Character selection is persisted locally and passed to the game through localStorage.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacterLoaderSelector } from './character-textures.js?v=echo-isolated-character-atlas-1';
import { getCharacterRarity } from './character-rarity.js';

const RARITY_CARDS = {
  common: { art: 'card_common.webp', ru: 'ОБЫЧНЫЙ', en: 'COMMON' },
  uncommon: { art: 'card_uncommon.webp', ru: 'НЕОБЫЧНЫЙ', en: 'UNCOMMON' },
  rare: { art: 'card_rare.webp', ru: 'РЕДКИЙ', en: 'RARE' },
  epic: { art: 'card_epic.webp', ru: 'ЭПИЧЕСКИЙ', en: 'EPIC' },
  legendary: { art: 'card_legend.webp', ru: 'ЛЕГЕНДАРНЫЙ', en: 'LEGENDARY' },
};
function rarityLabel(rarity) {
  const item = RARITY_CARDS[rarity] || RARITY_CARDS.common;
  return document.documentElement.lang?.startsWith('en') ? item.en : item.ru;
}

const characters = [
  ['character-female-a.glb', 'Костыль'],
  ['character-female-b.glb', 'Девчонка'],
  ['character-female-c.glb', 'Бабуся'],
  ['character-female-d.glb', 'Бизнес леди'],
  ['character-female-e.glb', 'Медсестра'],
  ['character-female-f.glb', 'Хвостики'],
  ['character-male-a.glb', 'Зоркий'],
  ['character-male-b.glb', 'Дедок'],
  ['character-male-c.glb', 'Полицай'],
  ['character-male-d.glb', 'Бизнесмен'],
  ['character-male-e.glb', 'Учёный'],
  ['character-male-f.glb', 'Злюка'],
  ['character-ghost.glb', 'Призрак'],
  ['character-keeper.glb', 'Фермер'],
  ['character-skeleton.glb', 'Скелет'],
  ['character-zombie.glb', 'Зомби'],
  ['character-human.glb', 'Воин'],
  ['character-orc.glb', 'Орк'],
];

const STARTER_HEROES = new Set(['character-female-b.glb','character-male-a.glb','character-female-c.glb']);
const GUEST_HEROES = new Set(characters.filter(([file])=>getCharacterRarity(file)==='common').map(([file])=>file));
let accessRegistered = Boolean(localStorage.getItem('echo.authToken'));
let heroCollection = {};
const HERO_REQUIREMENTS = {common:25,uncommon:30,rare:40,epic:50,legendary:60};
const heroText=(key,ru,en)=>window.$t?.('menu:'+key,document.documentElement.lang?.startsWith('en')?en:ru) || (document.documentElement.lang?.startsWith('en')?en:ru);
const heroCount=file=>Math.max(0,Number(heroCollection[file]?.fragments)||0);
async function loadHeroCollection(){
 if(!accessRegistered){heroCollection={};renderCharacterState();return;}
 try{
  const response=await fetch('/echo/api/heroes',{headers:{Authorization:'Bearer '+localStorage.getItem('echo.authToken')},cache:'no-store'});
  if(!response.ok)throw new Error('HTTP '+response.status);
  heroCollection=(await response.json()).heroes||{};
  ensureUnlockedSelection();renderCharacterState();
 }catch(err){console.warn('[echo heroes] Collection unavailable',err);heroCollection={};renderCharacterState();}
}
async function claimHero(file){
 if(!accessRegistered||heroUnlocked(file)||heroCount(file)<HERO_REQUIREMENTS[getCharacterRarity(file)])return;
 try{
  const response=await fetch('/echo/api/heroes/claim',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('echo.authToken'),'Content-Type':'application/json'},body:JSON.stringify({model:file})});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const data=await response.json();
  if(data.claimed){heroCollection[file]={fragments:data.fragments,claimed:true};renderCharacterState();}
 }catch(err){console.warn('[echo heroes] Claim failed',err);window.ECHOToast?.show(heroText('hero_claim_error','Не удалось получить персонажа','Could not claim character'));await loadHeroCollection();}
}
function heroUnlocked(file) {
  return accessRegistered ? (STARTER_HEROES.has(file)||Boolean(heroCollection[file]?.claimed)) : GUEST_HEROES.has(file);
}
function ensureUnlockedSelection() {
  if(heroUnlocked(selectedModel))return;
  selectedModel = accessRegistered ? 'character-female-b.glb' : 'character-female-a.glb';
  localStorage.setItem(storageKey,selectedModel);
  window.ECHO_SELECTED_MODEL=selectedModel;
}
const storageKey = 'echo.selectedModel';
const defaultModel = characters[0][0];
let selectedModel = localStorage.getItem(storageKey) || defaultModel;
window.ECHO_SELECTED_MODEL = selectedModel;
ensureUnlockedSelection();

const menu = document.querySelector('#main-menu');
const mainScreen = document.querySelector('#menu-main');
const characterScreen = document.querySelector('#menu-character');
const placeholderScreen = document.querySelector('#menu-placeholder');
const placeholderTitle = document.querySelector('#placeholder-title');
const settingsScreen = document.querySelector('#menu-settings-screen');
const shopScreen = document.querySelector('#menu-shop-screen');
const questsScreen = document.querySelector('#menu-quests-screen');
const characterGrid = document.querySelector('#character-grid');
const startButton = document.querySelector('#menu-start');
const characterButton = document.querySelector('#menu-character-button');
const settingsButton = document.querySelector('#menu-settings');
const shopButton = document.querySelector('#menu-shop');
const questsButton = document.querySelector('#menu-quests');
const characterBack = document.querySelector('#character-back');
const placeholderBack = document.querySelector('#placeholder-back');
const settingsBack = document.querySelector('#settings-back');
const languageButtons = document.querySelectorAll('.language-option');
const sharedBack=document.getElementById('game-exit');
const i18nReady = window.ECHO_I18N_READY || Promise.resolve(false);

function showScreen(screen) {
  mainScreen.hidden = screen !== 'main';
  characterScreen.hidden = screen !== 'character';
  placeholderScreen.hidden = screen !== 'placeholder';
  if (shopScreen) shopScreen.hidden = screen !== 'shop';
  if (questsScreen) questsScreen.hidden = screen !== 'quests';
  if (settingsScreen) settingsScreen.hidden = screen !== 'settings';
  syncSharedNav();
}


function syncSharedNav(){
 const inBattle=menu.classList.contains('is-hidden');
 const mainVisible=!mainScreen.hidden;
 document.getElementById('game')?.classList.toggle('echo-menu-subpage',!inBattle&&!mainVisible);
 sharedBack.hidden=!inBattle&&mainVisible;
 sharedBack.classList.toggle('is-menu-back',!inBattle);
 sharedBack.setAttribute('aria-label',inBattle?'Покинуть игру':'Назад');
 sharedBack.setAttribute('title',inBattle?'Покинуть игру':'Назад');
}
sharedBack?.addEventListener('click',event=>{
 if(menu.classList.contains('is-hidden'))return;
 event.stopImmediatePropagation();
 if(!mainScreen.hidden)return;
 const active=[
  ['character',characterBack],['quests',document.getElementById('quests-back')],
  ['shop',document.getElementById('shop-back')],['placeholder',placeholderBack],
  ['settings',settingsBack]
 ].find(([screen])=>!document.getElementById(screen==='shop'?'menu-shop-screen':screen==='quests'?'menu-quests-screen':screen==='settings'?'menu-settings-screen':screen==='placeholder'?'menu-placeholder':'menu-character')?.hidden);
 if(active?.[1])active[1].click();else openMenu();
});

function openMenu() {
  menu.classList.remove('is-hidden');
  document.getElementById('game')?.classList.remove('echo-in-battle');
  showScreen('main');
  syncSharedNav();
}

let battleStartPending=false;
async function startGame() {
  if(battleStartPending)return;
  battleStartPending=true;
  startButton.disabled=true;
  // Temporary VK test: every battle entry from #3 requests interstitial.
  // All ad errors and no-fill results fall through to battle.
  try{
    const ads=await import('./battle-entry-ads.js?v=echo-interstitial-2097075-test-from-3-1');
    await ads.showAdBeforeBattle();
  }catch(error){
    console.warn('[ECHO interstitial] continuing without ad',error);
  }finally{
    window.ECHO_SELECTED_MODEL = selectedModel;
    const url=new URL(window.location.href);
    url.searchParams.set('play','1');
    window.location.href=url.toString();
    // If location navigation is blocked, restore the menu button.
    battleStartPending=false;
    startButton.disabled=false;
  }
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
characterButton.addEventListener('click', () => {showScreen('character');void loadHeroCollection();});
settingsButton.addEventListener('click', openSettings);
shopButton.addEventListener('click', () => showScreen('shop'));
document.querySelector('#shop-back')?.addEventListener('click', openMenu);
questsButton.addEventListener('click', () => { showScreen('quests'); window.dispatchEvent(new Event('echo:quests-open')); });
document.querySelector('#quests-back')?.addEventListener('click', openMenu);
characterBack.addEventListener('click', openMenu);
placeholderBack.addEventListener('click', openMenu);
settingsBack?.addEventListener('click', openMenu);
console.info('[echo menu] Main menu click handlers ready');

const loader = new GLTFLoader();
const characterLoader = createCharacterLoaderSelector(THREE, GLTFLoader, loader);
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
  const rarity = getCharacterRarity(file) || 'common';
  button.dataset.rarity = rarity;
  const art = document.createElement('img');
  art.className = 'character-card-art';
  art.src = './assets/packs/' + RARITY_CARDS[rarity].art;
  art.alt = '';
  art.draggable = false;
  art.setAttribute('aria-hidden', 'true');
  const rarityText = document.createElement('span');
  rarityText.className = 'character-card-rarity';
  rarityText.textContent = rarityLabel(rarity);
  const labelKey = file.replace('character-', '').replace('.glb', '').replaceAll('-', '_');
  button.setAttribute('aria-label', label);

  const canvas = document.createElement('canvas');
  canvas.className = 'character-card-preview';
  canvas.setAttribute('aria-hidden', 'true');

  const caption = document.createElement('span');
  caption.className = 'character-card-name';
  caption.textContent = label;

  const status=document.createElement('span');
  status.className='character-card-status';
  status.setAttribute('aria-hidden','true');
  button.append(art, canvas, rarityText, caption, status);
  button.addEventListener('click', () => {
    if(!heroUnlocked(file)){
      if(accessRegistered&&heroCount(file)>=HERO_REQUIREMENTS[rarity])void claimHero(file);
      return;
    }
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

  characterLoader(file).load(`./assets/models/${file}`, (gltf) => {
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
      const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--echo-font-family').trim() || 'system-ui, sans-serif';
      context.font = '12px ' + fontFamily;
      context.textAlign = 'center';
      context.fillText('МОДЕЛЬ НЕ ЗАГРУЖЕНА', canvas.width / 2, canvas.height / 2);
    }
  });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  resize();
  window.addEventListener('resize', resize, { passive: true });
}

const RARITY_ORDER = ['common','uncommon','rare','epic','legendary'];
function renderCharacterState() {
  const cards=Array.from(characterGrid.children);
  for (const card of cards) {
    const unlocked=heroUnlocked(card.dataset.model);
    card.classList.toggle('selected',card.dataset.model===selectedModel);
    card.classList.toggle('is-locked',!unlocked);
    card.setAttribute('aria-disabled',String(!unlocked));
    card.title=unlocked?'':(document.documentElement.lang?.startsWith('en')?'Locked — collect character fragments':'Заблокирован — собирай фрагменты персонажа');
    const status=card.querySelector('.character-card-status');
    if(status){
      const selected=card.dataset.model===selectedModel;
      const required=HERO_REQUIREMENTS[card.dataset.rarity];
      const ready=accessRegistered&&heroCount(card.dataset.model)>=required;
      status.classList.toggle('is-progress',!unlocked&&!ready);
      status.classList.toggle('is-claim',!unlocked&&ready);
      status.classList.toggle('is-active',selected);
      status.hidden=unlocked&&!selected;
      status.replaceChildren();
      if(selected)status.textContent=heroText('hero_active','Активный','Active');
      else if(!unlocked){
        if(ready)status.textContent=heroText('hero_claim','Получить','Claim');
        else{
          const image=document.createElement('img');image.src='./assets/packs/card_rubashkaa.webp';image.alt='';
          status.append(image,document.createTextNode(heroCount(card.dataset.model)+'/'+required));
        }
      }
    }
  }
  // Active hero first; unlocked heroes rarest first, locked heroes commonest first.
  // Stable sort retains the original character order within equal rarities.
  cards.sort((a,b)=>{
    const selectedA=a.dataset.model===selectedModel,selectedB=b.dataset.model===selectedModel;
    if(selectedA!==selectedB)return selectedA?-1:1;
    const openA=heroUnlocked(a.dataset.model),openB=heroUnlocked(b.dataset.model);
    if(openA!==openB)return openA?-1:1;
    const rarityA=RARITY_ORDER.indexOf(a.dataset.rarity),rarityB=RARITY_ORDER.indexOf(b.dataset.rarity);
    return openA ? rarityB-rarityA : rarityA-rarityB;
  });
  characterGrid.append(...cards);
}

for (const [file, label] of characters) createCharacterCard(file, label);
renderCharacterState();
window.addEventListener('echo:hero-collection-refresh',()=>{void loadHeroCollection();});
document.addEventListener('echo:auth-changed',event=>{
 accessRegistered=Boolean(event.detail?.authenticated);
 ensureUnlockedSelection();
 renderCharacterState();
 void loadHeroCollection();
});


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
  document.querySelectorAll('[data-i18n-alt]').forEach((element) => {
    element.setAttribute('alt', window.$t(element.dataset.i18nAlt, element.getAttribute('alt') || ''));
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
  renderCharacterState();
  updateLanguageButtons();
  const placeholderTitle = document.querySelector('#placeholder-title');
  if (placeholderTitle) {
    const currentTitle = placeholderTitle.textContent;
    if (currentTitle === 'МАГАЗИН' || currentTitle === 'SHOP') placeholderTitle.textContent = window.$t('menu:shop_title', currentTitle);
    if (currentTitle === 'ЗАДАНИЯ' || currentTitle === 'QUESTS') placeholderTitle.textContent = window.$t('menu:quests_title', currentTitle);
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
      const rarity = card.querySelector('.character-card-rarity');
      if (rarity) rarity.textContent = rarityLabel(card.dataset.rarity);
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
  document.getElementById('game')?.classList.add('echo-in-battle');
  // Only remove auto-start; later modules still need debugWater/noReflections.
  const cleanedUrl = new URL(window.location.href);
  cleanedUrl.searchParams.delete('play');
  window.history.replaceState({}, document.title, cleanedUrl.pathname + cleanedUrl.search + cleanedUrl.hash);
}

syncSharedNav();

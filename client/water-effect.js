import * as THREE from 'three';
import { Line2 } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/lines/LineMaterial.js';
import WATER_GEOMETRY from './water-hazard-contours.js';

const WATER_CENTER_COLOR = new THREE.Color(0x38d8ff);
const WATER_EDGE_COLOR = new THREE.Color(0x06245f);
const EDGE_FADE_START = 0.035;
const EDGE_FADE_END = 0.24;
const DEBUG_WATER_BOUNDARY = true;
const DEBUG_WATER_BOUNDARY_WIDTH_PX = 3.5;

const game = document.querySelector('#game');
const WATER_GIF_MIN_WIDTH = 40;
const WATER_GIF_MAX_WIDTH = 80;
const WATER_GIF_PULSE_MS = 500;
const WATER_GIF_MOVEMENT_THRESHOLD = 1;

const effect = document.createElement('img');
effect.id = 'water-step-effect';
effect.src = './assets/textures/water02.gif';
effect.alt = '';
effect.setAttribute('aria-hidden', 'true');
effect.draggable = false;
effect.style.cssText = [
  'position:absolute','left:50%','top:50%',`width:${WATER_GIF_MIN_WIDTH}px`,'height:auto','max-width:none','max-height:none',
  'transform:translate(-50%,-50%)','display:block','pointer-events:none','z-index:2.5','opacity:0',
  `transition:width ${WATER_GIF_PULSE_MS}ms ease-in-out`
].join(';');
game?.appendChild(effect);

let pulseTimer = null;
let isMoving = false;
let isOnWater = false;
let pulseRunning = false;

function ensureOpacityAnimation() {
  if (!effect.animate) return null;
  return effect.animate([
    { opacity: 0, offset: 0 }, { opacity: 0.7, offset: 0.2 }, { opacity: 0.7, offset: 0.4 },
    { opacity: 0.5, offset: 0.6 }, { opacity: 0.3, offset: 0.8 }, { opacity: 0.1, offset: 1 }
  ], { duration: WATER_GIF_PULSE_MS, easing: 'ease-in-out', fill: 'forwards' });
}
let opacityAnimation = null;
function stopPulse() {
  clearTimeout(pulseTimer); pulseTimer = null; pulseRunning = false;
  opacityAnimation?.cancel(); opacityAnimation = null;
  effect.style.transition = 'none'; effect.style.width = `${WATER_GIF_MIN_WIDTH}px`; effect.style.opacity = '0';
}
function pulse() {
  if (!isMoving || !isOnWater || pulseRunning) return;
  pulseRunning = true; opacityAnimation?.cancel(); opacityAnimation = ensureOpacityAnimation();
  effect.style.transition = `width ${WATER_GIF_PULSE_MS}ms ease-in-out`; effect.style.width = `${WATER_GIF_MAX_WIDTH}px`;
  pulseTimer = setTimeout(() => {
    pulseTimer = null; opacityAnimation?.cancel(); opacityAnimation = null;
    effect.style.transition = 'none'; effect.style.width = `${WATER_GIF_MIN_WIDTH}px`; effect.style.opacity = '0'; pulseRunning = false;
    if (isMoving && isOnWater) { void effect.offsetWidth; pulse(); }
  }, WATER_GIF_PULSE_MS);
}
function updateEffectState() { if (isMoving && isOnWater) pulse(); else stopPulse(); }
window.addEventListener('echo:water-state', (event) => {
  isOnWater = Boolean(event.detail?.inWater ?? event.detail?.isInWater ?? event.detail?.water); updateEffectState();
});
window.addEventListener('echo:player-movement', (event) => {
  const vx = Number(event.detail?.vx) || 0, vy = Number(event.detail?.vy) || 0;
  const movingNow = Math.hypot(vx, vy) > WATER_GIF_MOVEMENT_THRESHOLD;
  if (movingNow === isMoving) return; isMoving = movingNow; updateEffectState();
});

function distanceToContour(point, vertices) {
  let minDistanceSquared = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const abx = b[0] - a[0], aby = b[1] - a[1], apx = point[0] - a[0], apy = point[1] - a[1];
    const lengthSquared = abx * abx + aby * aby;
    const t = lengthSquared > 0 ? THREE.MathUtils.clamp((apx * abx + apy * aby) / lengthSquared, 0, 1) : 0;
    const dx = point[0] - (a[0] + abx * t), dy = point[1] - (a[1] + aby * t);
    minDistanceSquared = Math.min(minDistanceSquared, dx * dx + dy * dy);
  }
  return Math.sqrt(minDistanceSquared);
}

const contourMaterials = new WeakSet();
const debugWaterRoots = new WeakSet();

function addDebugWaterBoundary(root, modelName) {
  if (!DEBUG_WATER_BOUNDARY || debugWaterRoots.has(root)) return;
  const contour = WATER_GEOMETRY[modelName];
  if (!Array.isArray(contour) || contour.length < 3) {
    console.warn('[echo] missing server water contour for debug line:', modelName);
    return;
  }

  // Draw the server polygon as real mesh strips. This avoids browser/WebGL line-width differences.
  // The strips use the exact same local XY plane as the contour and then the same X rotation as water.
  const ring = new THREE.Group();
  ring.name = 'echo-server-water-boundary-debug';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  ring.renderOrder = 1000;

  const surface = root.children.find(child => child.isObject3D && child !== ring);
  const waterScale = surface?.scale?.x || 1;
  const widthLocal = DEBUG_WATER_BOUNDARY_WIDTH_PX / waterScale;
  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < contour.length; i += 1) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const segment = new THREE.Mesh(new THREE.PlaneGeometry(length, widthLocal), material);
    segment.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    segment.rotation.z = Math.atan2(dy, dx);
    segment.renderOrder = 1000;
    ring.add(segment);
  }

  root.add(ring);
  debugWaterRoots.add(root);
}

function handleWaterModel(root, modelName) {
  if (!root || !modelName) return;
  addDebugWaterBoundary(root, modelName);
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) applyContourShader(material, modelName);
  });
}

function applyContourShader(material, modelName) {
  if (!material || contourMaterials.has(material)) return;
  const contour = WATER_GEOMETRY[modelName];
  if (!Array.isArray(contour) || contour.length < 3) return;
  const segments = contour.map((point, index) => ({ a: point, b: contour[(index + 1) % contour.length] }));
  const maxSegments = Math.max(...Object.values(WATER_GEOMETRY).map(points => points.length));
  const aX = new Float32Array(maxSegments), aY = new Float32Array(maxSegments), bX = new Float32Array(maxSegments), bY = new Float32Array(maxSegments);
  for (let i = 0; i < segments.length; i += 1) { aX[i] = segments[i].a[0]; aY[i] = segments[i].a[1]; bX[i] = segments[i].b[0]; bY[i] = segments[i].b[1]; }

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEchoWaterModelXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEchoWaterModelXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vEchoWaterModelXZ;\nuniform float echoContourCount;\nuniform float echoContourAX[${maxSegments}];\nuniform float echoContourAY[${maxSegments}];\nuniform float echoContourBX[${maxSegments}];\nuniform float echoContourBY[${maxSegments}];`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat echoMinDistance = 10000.0;\nfor (int i = 0; i < ${maxSegments}; i++) {\n  if (float(i) >= echoContourCount) break;\n  vec2 a = vec2(echoContourAX[i], echoContourAY[i]);\n  vec2 b = vec2(echoContourBX[i], echoContourBY[i]);\n  vec2 ab = b - a;\n  float denom = max(dot(ab, ab), 0.000001);\n  float t = clamp(dot(vEchoWaterModelXZ - a, ab) / denom, 0.0, 1.0);\n  float d = length(vEchoWaterModelXZ - (a + t * ab));\n  echoMinDistance = min(echoMinDistance, d);\n}\nfloat echoEdgeMask = smoothstep(${EDGE_FADE_START.toFixed(3)}, ${EDGE_FADE_END.toFixed(3)}, echoMinDistance);\nvec3 echoWaterColor = mix(vec3(${WATER_CENTER_COLOR.r}, ${WATER_CENTER_COLOR.g}, ${WATER_CENTER_COLOR.b}), vec3(${WATER_EDGE_COLOR.r}, ${WATER_EDGE_COLOR.g}, ${WATER_EDGE_COLOR.b}), echoEdgeMask);\ndiffuseColor.rgb = echoWaterColor;`);
    shader.uniforms.echoContourCount = { value: segments.length };
    shader.uniforms.echoContourAX = { value: Array.from(aX) };
    shader.uniforms.echoContourAY = { value: Array.from(aY) };
    shader.uniforms.echoContourBX = { value: Array.from(bX) };
    shader.uniforms.echoContourBY = { value: Array.from(bY) };
  };
  material.customProgramCacheKey = () => `echo-water-contour-${modelName}`;
  material.needsUpdate = true;
  contourMaterials.add(material);
}

function watchWaterModels() {
  const renderer = document.querySelector('#models');
  if (!renderer) return;
  window.addEventListener('echo:water-model-created', (event) => {
    const { root, model } = event.detail || {};
    handleWaterModel(root, model);
  });
  window.addEventListener('echo:water-models-ready', (event) => {
    for (const water of event.detail?.waters || []) handleWaterModel(water?.root, water?.model);
  });
}

window.addEventListener('resize', () => {}, { passive: true });
watchWaterModels();

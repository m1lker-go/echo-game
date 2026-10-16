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

// Keep the animated footstep GIF separate from the rendered water surface.
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
  'position:absolute',
  'left:50%',
  'top:50%',
  `width:${WATER_GIF_MIN_WIDTH}px`,
  'height:auto',
  'max-width:none',
  'max-height:none',
  'transform:translate(-50%,-50%)',
  'display:block',
  'pointer-events:none',
  'z-index:2.5',
  'opacity:0',
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
    { opacity: 0, offset: 0 },
    { opacity: 0.7, offset: 0.2 },
    { opacity: 0.7, offset: 0.4 },
    { opacity: 0.5, offset: 0.6 },
    { opacity: 0.3, offset: 0.8 },
    { opacity: 0.1, offset: 1 }
  ], {
    duration: WATER_GIF_PULSE_MS,
    easing: 'ease-in-out',
    fill: 'forwards'
  });
}

let opacityAnimation = null;

function stopPulse() {
  clearTimeout(pulseTimer);
  pulseTimer = null;
  pulseRunning = false;
  opacityAnimation?.cancel();
  opacityAnimation = null;
  effect.style.transition = 'none';
  effect.style.width = `${WATER_GIF_MIN_WIDTH}px`;
  effect.style.opacity = '0';
}

function pulse() {
  if (!isMoving || !isOnWater || pulseRunning) return;

  pulseRunning = true;
  opacityAnimation?.cancel();
  opacityAnimation = ensureOpacityAnimation();
  effect.style.transition = `width ${WATER_GIF_PULSE_MS}ms ease-in-out`;
  effect.style.width = `${WATER_GIF_MAX_WIDTH}px`;

  pulseTimer = setTimeout(() => {
    pulseTimer = null;
    opacityAnimation?.cancel();
    opacityAnimation = null;
    effect.style.transition = 'none';
    effect.style.width = `${WATER_GIF_MIN_WIDTH}px`;
    effect.style.opacity = '0';
    pulseRunning = false;

    if (isMoving && isOnWater) {
      void effect.offsetWidth;
      pulse();
    }
  }, WATER_GIF_PULSE_MS);
}

function updateEffectState() {
  if (isMoving && isOnWater) pulse();
  else stopPulse();
}

window.addEventListener('echo:water-state', (event) => {
  isOnWater = Boolean(event.detail?.inWater ?? event.detail?.isInWater ?? event.detail?.water);
  updateEffectState();
});

window.addEventListener('echo:player-movement', (event) => {
  const vx = Number(event.detail?.vx) || 0;
  const vy = Number(event.detail?.vy) || 0;
  const movingNow = Math.hypot(vx, vy) > WATER_GIF_MOVEMENT_THRESHOLD;
  if (movingNow === isMoving) return;
  isMoving = movingNow;
  updateEffectState();
});

// Distance to the nearest actual contour segment, in the contour's model units.
// This produces an edge mask from the irregular polygon rather than a radial ellipse.
function distanceToContour(point, vertices) {
  let minDistanceSquared = Infinity;

  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const apx = point[0] - a[0];
    const apy = point[1] - a[1];
    const lengthSquared = abx * abx + aby * aby;
    const t = lengthSquared > 0
      ? THREE.MathUtils.clamp((apx * abx + apy * aby) / lengthSquared, 0, 1)
      : 0;
    const dx = point[0] - (a[0] + abx * t);
    const dy = point[1] - (a[1] + aby * t);
    minDistanceSquared = Math.min(minDistanceSquared, dx * dx + dy * dy);
  }

  return Math.sqrt(minDistanceSquared);
}

const contourMaterials = new WeakSet();
const debugWaterLines = new Set();

function updateDebugWaterLineResolution() {
  const canvas = document.querySelector('#models');
  if (!canvas) return;
  const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
  const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
  for (const material of debugWaterLines) material.resolution.set(width, height);
}

function addDebugWaterBoundary(root, modelName) {
  if (!DEBUG_WATER_BOUNDARY) return;
  const contour = WATER_GEOMETRY[modelName];
  if (!Array.isArray(contour) || contour.length < 3) return;

  // This is the SERVER collision polygon itself — not the visible OBJ/GLB edge.
  // It is a line only, with no fill, and inherits the exact water holder transform.
  const positions = [];
  for (const [x, y] of contour) positions.push(x, y, 0);
  positions.push(contour[0][0], contour[0][1], 0);

  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: 0xff0000,
    linewidth: DEBUG_WATER_BOUNDARY_WIDTH_PX,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new Line2(geometry, material);
  line.name = 'echo-server-water-boundary-debug';
  line.rotation.x = Math.PI / 2;
  line.position.y = 0.012;
  const surface = root.children.find(child => child.isObject3D && child !== line);
  if (surface?.scale?.x) line.scale.setScalar(surface.scale.x);
  line.renderOrder = 20;
  root.add(line);
  line.computeLineDistances();
  debugWaterLines.add(material);
  updateDebugWaterLineResolution();
}

function applyContourShader(material, modelName) {
  if (!material || contourMaterials.has(material)) return;

  const contour = WATER_GEOMETRY[modelName];
  if (!Array.isArray(contour) || contour.length < 3) return;

  // Pass the collision contour to the GPU as line-segment endpoint pairs.
  // A fixed-size uniform array keeps this compatible with WebGL 1 / mobile browsers.
  const segments = contour.map((point, index) => ({
    a: point,
    b: contour[(index + 1) % contour.length]
  }));
  const maxSegments = Math.max(...Object.values(WATER_GEOMETRY).map(points => points.length));
  const aX = new Float32Array(maxSegments);
  const aY = new Float32Array(maxSegments);
  const bX = new Float32Array(maxSegments);
  const bY = new Float32Array(maxSegments);
  for (let i = 0; i < segments.length; i += 1) {
    aX[i] = segments[i].a[0];
    aY[i] = segments[i].a[1];
    bX[i] = segments[i].b[0];
    bY[i] = segments[i].b[1];
  }

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vEchoWaterModelXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEchoWaterModelXZ = position.xz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vEchoWaterModelXZ;
        uniform float echoContourCount;
        uniform float echoContourAX[${maxSegments}];
        uniform float echoContourAY[${maxSegments}];
        uniform float echoContourBX[${maxSegments}];
        uniform float echoContourBY[${maxSegments}];`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float echoMinDistance = 10000.0;
        for (int i = 0; i < ${maxSegments}; i++) {
          if (float(i) >= echoContourCount) break;
          vec2 a = vec2(echoContourAX[i], echoContourAY[i]);
          vec2 b = vec2(echoContourBX[i], echoContourBY[i]);
          vec2 ab = b - a;
          float denom = max(dot(ab, ab), 0.000001);
          float t = clamp(dot(vEchoWaterModelXZ - a, ab) / denom, 0.0, 1.0);
          float d = length(vEchoWaterModelXZ - (a + t * ab));
          echoMinDistance = min(echoMinDistance, d);
        }
        float echoEdgeMask = smoothstep(${EDGE_FADE_START.toFixed(3)}, ${EDGE_FADE_END.toFixed(3)}, echoMinDistance);
        vec3 echoWaterColor = mix(vec3(${WATER_CENTER_COLOR.r}, ${WATER_CENTER_COLOR.g}, ${WATER_CENTER_COLOR.b}), vec3(${WATER_EDGE_COLOR.r}, ${WATER_EDGE_COLOR.g}, ${WATER_EDGE_COLOR.b}), echoEdgeMask);
        diffuseColor.rgb = echoWaterColor;`
      );

    shader.uniforms.echoContourCount = { value: segments.length };
    shader.uniforms.echoContourAX = { value: Array.from(aX) };
    shader.uniforms.echoContourAY = { value: Array.from(aY) };
    shader.uniforms.echoContourBX = { value: Array.from(bX) };
    shader.uniforms.echoContourBY = { value: Array.from(bY) };
  };

  // Each contour/material is unique, so cache keys must include the water model.
  material.customProgramCacheKey = () => `echo-water-contour-${modelName}`;
  material.needsUpdate = true;
  contourMaterials.add(material);
}

function watchWaterModels() {
  const renderer = document.querySelector('#models');
  if (!renderer) return;

  // game.js creates each water mesh with a neutral MeshBasicMaterial and tags
  // its source model here when it creates the water root.
  window.addEventListener('echo:water-model-created', (event) => {
    const { root, model } = event.detail || {};
    if (!root || !model) return;
    addDebugWaterBoundary(root, model);
    root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) applyContourShader(material, model);
    });
  });
}

window.addEventListener('resize', updateDebugWaterLineResolution, { passive: true });
watchWaterModels();
updateDebugWaterLineResolution();

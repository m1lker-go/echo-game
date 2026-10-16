import * as THREE from 'three';

const WATER_CENTER_COLOR = new THREE.Color(0x38d8ff);
const WATER_EDGE_COLOR = new THREE.Color(0x06245f);

const previousMeshBasicOnBeforeCompile = THREE.MeshBasicMaterial.prototype.onBeforeCompile;
THREE.MeshBasicMaterial.prototype.onBeforeCompile = function(shader, renderer) {
  previousMeshBasicOnBeforeCompile?.call(this, shader, renderer);

  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec2 vEchoWaterPosition;'
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvEchoWaterPosition = position.xy;'
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec2 vEchoWaterPosition;'
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float echoWaterEdgeDistance = max(abs(vEchoWaterPosition.x) / 0.7, abs(vEchoWaterPosition.y) / 0.6);
      float echoWaterEdge = smoothstep(0.22, 0.58, echoWaterEdgeDistance);
      vec3 echoWaterColor = mix(vec3(${WATER_CENTER_COLOR.r}, ${WATER_CENTER_COLOR.g}, ${WATER_CENTER_COLOR.b}), vec3(${WATER_EDGE_COLOR.r}, ${WATER_EDGE_COLOR.g}, ${WATER_EDGE_COLOR.b}), echoWaterEdge);
      diffuseColor.rgb = echoWaterColor;`
    );
};

const game = document.querySelector('#game');

// Temporary diagnostic: use the real animated water texture directly under the player.
// The player is always kept at the center of the camera, so no world projection is needed yet.
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
  if (isMoving && isOnWater) {
    pulse();
  } else {
    stopPulse();
  }
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

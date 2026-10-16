const game = document.querySelector('#game');

// Temporary diagnostic: use the real animated water texture directly under the player.
// The player is always kept at the center of the camera, so no world projection is needed yet.
const WATER_GIF_MIN_WIDTH = 40;
const WATER_GIF_MAX_WIDTH = 80;
const WATER_GIF_PULSE_MS = 300;
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
let pulseRunning = false;

function stopPulse() {
  clearTimeout(pulseTimer);
  pulseTimer = null;
  pulseRunning = false;
  effect.style.transition = 'none';
  effect.style.width = `${WATER_GIF_MIN_WIDTH}px`;
  effect.style.opacity = '0';
}

function pulse() {
  if (!isMoving || pulseRunning) return;

  pulseRunning = true;
  effect.style.opacity = '1';
  effect.style.transition = `width ${WATER_GIF_PULSE_MS}ms ease-in-out`;
  effect.style.width = `${WATER_GIF_MAX_WIDTH}px`;

  pulseTimer = setTimeout(() => {
    pulseTimer = null;
    effect.style.transition = 'none';
    effect.style.width = `${WATER_GIF_MIN_WIDTH}px`;
    pulseRunning = false;

    if (isMoving) {
      void effect.offsetWidth;
      pulse();
    }
  }, WATER_GIF_PULSE_MS);
}

window.addEventListener('echo:player-movement', (event) => {
  const vx = Number(event.detail?.vx) || 0;
  const vy = Number(event.detail?.vy) || 0;
  const movingNow = Math.hypot(vx, vy) > WATER_GIF_MOVEMENT_THRESHOLD;

  if (movingNow === isMoving) return;

  isMoving = movingNow;
  if (isMoving) {
    pulse();
  } else {
    stopPulse();
  }
});

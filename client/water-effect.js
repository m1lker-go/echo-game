const game = document.querySelector('#game');

// Temporary diagnostic: use the real animated water texture directly under the player.
// The player is always kept at the center of the camera, so no world projection is needed yet.
const WATER_GIF_MIN_WIDTH = 40;
const WATER_GIF_MAX_WIDTH = 80;
const WATER_GIF_PULSE_MS = 300;

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
  `transition:width ${WATER_GIF_PULSE_MS}ms ease-in-out`
].join(';');

game?.appendChild(effect);

let pulseTimer = null;

function pulse() {
  effect.style.width = `${WATER_GIF_MAX_WIDTH}px`;

  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    effect.style.transition = 'none';
    effect.style.width = `${WATER_GIF_MIN_WIDTH}px`;
    void effect.offsetWidth;
    effect.style.transition = `width ${WATER_GIF_PULSE_MS}ms ease-in-out`;
    pulse();
  }, WATER_GIF_PULSE_MS);
}

pulse();

const game = document.querySelector('#game');

// Temporary diagnostic: use the real animated water texture directly under the player.
// The player is always kept at the center of the camera, so no world projection is needed yet.
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
  'width:auto',
  'height:auto',
  'max-width:none',
  'max-height:none',
  'transform:translate(-50%,-50%)',
  'display:block',
  'pointer-events:none',
  'z-index:2.5'
].join(';');

game?.appendChild(effect);

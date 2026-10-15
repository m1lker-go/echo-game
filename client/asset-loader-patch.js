import * as THREE from 'three';

// Kenney Mini Characters reference Textures/colormap.png beside the GLB.
// Our project keeps the shared atlas in client/assets/textures/.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  const selectedModel = window.localStorage?.getItem('echo.selectedModel');
  const defaultModel = '/assets/models/character-female-a.glb';
  if (selectedModel && url.endsWith(defaultModel)) {
    return new URL(`./assets/models/${selectedModel}`, window.location.href).href;
  }
  if (url.endsWith('/assets/models/Textures/colormap.png') || url.endsWith('/assets/models/objects/Textures/colormap.png')) {
    return new URL('./assets/textures/colormap.png', window.location.href).href;
  }
  return url;
});

// The world snapshot can be emitted immediately when Socket.IO connects, before
// the game module finishes installing all of its listeners. Ask for it again
// shortly after connect so the shared tree layout is always received.
const originalIo = window.io;
if (typeof originalIo === 'function') {
  window.io = function (...args) {
    const socket = originalIo(...args);
    socket.on('connect', () => {
      setTimeout(() => {
        if (socket.connected) {
          const activityProfileId = window.localStorage?.getItem('echo.activityProfileId');
          const selectedModel = window.localStorage?.getItem('echo.selectedModel') || 'character-female-a.glb';
          socket.emit('echo:hello', { version: 1, skin: selectedModel, activityProfileId });
        }
      }, 150);
    });
    return socket;
  };
}

// game.js passes triggerBoost into player-controls.js. Keep the boost handler
// available globally so a missing local declaration cannot abort the game module.
// player-controls.js exposes the live game state when controls are bound.
globalThis.triggerBoost = function triggerBoost() {
  const state = globalThis.echoGameState;
  const boostButton = document.querySelector('#boost');
  if (!state || !boostButton) return;

  const now = performance.now();
  if (now < state.boostCooldownUntil || state.defeated || state.combatUntil > now) return;

  state.boostUntil = now + 700;
  state.boostCooldownUntil = now + 3000;
  boostButton.classList.remove('cooldown', 'ready');
  boostButton.classList.add('active');
  setTimeout(() => boostButton.classList.remove('active'), 700);

  const countdown = document.createElement('span');
  countdown.className = 'ability-cooldown';
  countdown.setAttribute('aria-hidden', 'true');
  boostButton.appendChild(countdown);
  boostButton.classList.add('cooldown');

  const phases = [
    { value: '2', start: 0, duration: 850 },
    { value: '1', start: 1150, duration: 1550 }
  ];
  let last = -1;
  const tick = () => {
    const elapsed = performance.now() - now;
    if (elapsed >= 3000) {
      countdown.remove();
      boostButton.classList.remove('cooldown');
      boostButton.classList.add('ready');
      setTimeout(() => boostButton.classList.remove('ready'), 450);
      return;
    }
    const i = phases.findIndex(p => elapsed >= p.start && elapsed < p.start + p.duration);
    if (i !== last) {
      last = i;
      countdown.classList.remove('countdown-pop');
      if (i >= 0) {
        countdown.textContent = phases[i].value;
        countdown.style.animationDuration = `${phases[i].duration}ms`;
        void countdown.offsetWidth;
        countdown.classList.add('countdown-pop');
      } else {
        countdown.textContent = '';
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
};

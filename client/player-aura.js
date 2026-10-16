const game = document.querySelector('#game');
const worldCanvas = document.querySelector('#world');

if (game && worldCanvas) {
  const canvas = document.createElement('canvas');
  canvas.id = 'player-aura';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '1.5',
  });

  game.insertBefore(canvas, document.querySelector('#shared-food') || null);

  const ctx = canvas.getContext('2d');
  const state = { width: 0, height: 0, dpr: 1 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = rect.width;
    state.height = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
  }

  function drawAura(time) {
    if (!ctx || !state.width || !state.height) {
      requestAnimationFrame(drawAura);
      return;
    }

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    // The camera is locked to our own player, so the player's floor position
    // is always the center of the viewport. Other players never receive this glow.
    const x = state.width / 2;
    const y = state.height / 2;
    const pulse = 1 + Math.sin(time * 0.0014) * 0.025;
    const radius = Math.min(state.width, state.height) * 0.62 * pulse;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, 'rgba(190, 225, 239, .22)');
    glow.addColorStop(.16, 'rgba(150, 190, 207, .16)');
    glow.addColorStop(.42, 'rgba(115, 153, 171, .09)');
    glow.addColorStop(.72, 'rgba(67, 100, 118, .03)');
    glow.addColorStop(1, 'rgba(20, 35, 47, 0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, state.width, state.height);

    requestAnimationFrame(drawAura);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();
  requestAnimationFrame(drawAura);
}

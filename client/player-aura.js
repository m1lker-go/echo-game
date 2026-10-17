const game = document.querySelector('#game');
const worldCanvas = document.querySelector('#world');

// Multiplier for the local hero's floor glow; alpha values are capped at 1.
const AURA_STRENGTH = 5;
const AURA_RADIUS_SCALE = 1.5;
const AURA_RGB = '20, 35, 47'; // #14232F — dark blue-gray throughout the aura

// Soft local highlight above the wide dark aura, still behind the hero.
const INNER_GLOW_RADIUS = 0.36; // 1.5x the former 0.24 viewport radius
const INNER_GLOW_STRENGTH = 0.55; // brighter near the hero; quickly fades into the outer aura
const INNER_GLOW_RGB = '168, 206, 224'; // #A8CEE0, cool muted blue

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
    // Above the ground (#world: 1), below food (2) and 3D heroes (3).
    zIndex: '2',
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
    const radius = Math.min(state.width, state.height) * 0.62 * AURA_RADIUS_SCALE * pulse;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = base => Math.min(1, base * AURA_STRENGTH);
    glow.addColorStop(0, `rgba(${AURA_RGB}, ${alpha(.22)})`);
    glow.addColorStop(.16, `rgba(${AURA_RGB}, ${alpha(.16)})`);
    glow.addColorStop(.42, `rgba(${AURA_RGB}, ${alpha(.09)})`);
    glow.addColorStop(.72, `rgba(${AURA_RGB}, ${alpha(.03)})`);
    glow.addColorStop(1, `rgba(${AURA_RGB}, 0)`);

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, state.width, state.height);

    // Brighten only the center, then blend the glow toward the wide dark aura.
    // Keep it on the same canvas so it never covers the 3D character.
    const innerRadius = Math.min(state.width, state.height) * INNER_GLOW_RADIUS * pulse;
    const innerGlow = ctx.createRadialGradient(x, y, 0, x, y, innerRadius);
    innerGlow.addColorStop(0, `rgba(${INNER_GLOW_RGB}, ${INNER_GLOW_STRENGTH})`);
    innerGlow.addColorStop(.09, `rgba(148, 190, 210, ${INNER_GLOW_STRENGTH * .8})`);
    innerGlow.addColorStop(.2, `rgba(112, 156, 178, ${INNER_GLOW_STRENGTH * .49})`);
    innerGlow.addColorStop(.38, `rgba(66, 103, 122, ${INNER_GLOW_STRENGTH * .22})`);
    innerGlow.addColorStop(.6, `rgba(32, 56, 72, ${INNER_GLOW_STRENGTH * .065})`);
    innerGlow.addColorStop(.82, `rgba(${AURA_RGB}, ${INNER_GLOW_STRENGTH * .015})`);
    innerGlow.addColorStop(1, `rgba(${AURA_RGB}, 0)`);
    ctx.fillStyle = innerGlow;
    ctx.fillRect(0, 0, state.width, state.height);

    requestAnimationFrame(drawAura);
  }

  window.addEventListener('resize', resize, { passive: true });
  resize();
  requestAnimationFrame(drawAura);
}

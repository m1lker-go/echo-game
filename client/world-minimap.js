// ECHO: lightweight isometric minimap driven by game.js player snapshots.
// No extra sockets, WebGL passes, changes to gameplay, or changes to world zoom.
const MAP_HALF = (50 * 84) / 2;
const ISO_X = 0.8660254, ISO_Y = 0.5;

export function makeMapProjection(width, height, padding = 8) {
  const scale = Math.min(
    Math.max(1, width - 2 * padding) / (4 * MAP_HALF * ISO_X),
    Math.max(1, height - 2 * padding) / (4 * MAP_HALF * ISO_Y)
  );
  return { cx: width / 2, cy: height / 2, scale };
}

export function worldToMap(x, y, projection) {
  return {
    x: projection.cx + (x - y) * ISO_X * projection.scale,
    y: projection.cy + (x + y) * ISO_Y * projection.scale,
  };
}

export function createWorldMinimap() {
  const button = document.querySelector('#echo-minimap-open');
  const miniCanvas = document.querySelector('#echo-minimap-mini');
  const overlay = document.querySelector('#echo-minimap-overlay');
  const fullCanvas = document.querySelector('#echo-minimap-full');
  const closeButton = document.querySelector('#echo-minimap-close');
  const playerCount = document.querySelector('#echo-minimap-player-count');
  if (!button || !miniCanvas || !overlay || !fullCanvas || !closeButton) return { render() {} };

  let localX = 0, localY = 0, remotePlayers = new Map(), lastDrawAt = -Infinity;

  function setup(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, width: rect.width, height: rect.height };
  }

  function drawDot(ctx, projection, x, y, isLocal, big) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = worldToMap(
      Math.max(-MAP_HALF, Math.min(MAP_HALF, x)),
      Math.max(-MAP_HALF, Math.min(MAP_HALF, y)),
      projection
    );
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, big ? (isLocal ? 8 : 6) : (isLocal ? 5.2 : 3.7), 0, Math.PI * 2);
    ctx.fillStyle = isLocal ? '#6be6ff' : '#ff4f5e';
    ctx.shadowColor = isLocal ? '#29cdff' : '#ff344b';
    ctx.shadowBlur = big ? 15 : 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (isLocal) {
      ctx.lineWidth = big ? 2 : 1.3;
      ctx.strokeStyle = '#e5fbff';
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(canvas, big) {
    const surface = setup(canvas);
    if (!surface) return;
    const { ctx, width, height } = surface;
    const padding = big ? Math.max(32, Math.min(width, height) * 0.075) : 8;
    const projection = makeMapProjection(width, height, padding);
    const corners = [
      [-MAP_HALF, -MAP_HALF], [MAP_HALF, -MAP_HALF],
      [MAP_HALF, MAP_HALF], [-MAP_HALF, MAP_HALF]
    ].map(([x, y]) => worldToMap(x, y, projection));

    function diamondPath() {
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
    }

    ctx.save();
    diamondPath();
    const fill = ctx.createLinearGradient(0, height * 0.18, 0, height * 0.84);
    fill.addColorStop(0, 'rgba(25, 65, 89, 0.53)');
    fill.addColorStop(1, 'rgba(4, 16, 34, 0.66)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.clip();

    // A world-aligned grid. Both diamond views cover the complete 50×50 field.
    const divisions = big ? 10 : 4;
    ctx.strokeStyle = big ? 'rgba(135, 203, 246, 0.17)' : 'rgba(135, 203, 246, 0.14)';
    ctx.lineWidth = big ? 1 : 0.6;
    for (let i = 1; i < divisions; i++) {
      const coordinate = -MAP_HALF + (2 * MAP_HALF * i) / divisions;
      const a = worldToMap(coordinate, -MAP_HALF, projection);
      const b = worldToMap(coordinate, MAP_HALF, projection);
      const c = worldToMap(-MAP_HALF, coordinate, projection);
      const d = worldToMap(MAP_HALF, coordinate, projection);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    diamondPath();
    ctx.lineWidth = big ? 2 : 1.25;
    ctx.strokeStyle = 'rgba(123, 220, 255, 0.85)';
    ctx.shadowColor = 'rgba(73, 189, 245, 0.65)';
    ctx.shadowBlur = big ? 15 : 7;
    ctx.stroke();
    ctx.restore();

    let count = 0;
    for (const player of remotePlayers.values()) {
      const x = Number.isFinite(player.displayX) ? player.displayX : player.targetX;
      const y = Number.isFinite(player.displayY) ? player.displayY : player.targetY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      drawDot(ctx, projection, x, y, false, big);
      count++;
    }
    drawDot(ctx, projection, localX, localY, true, big);
    if (big && playerCount) playerCount.textContent = String(count);
  }

  function paint() {
    draw(miniCanvas, false);
    if (!overlay.hidden) draw(fullCanvas, true);
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  }
  button.addEventListener('click', () => {
    overlay.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    paint();
    closeButton.focus();
  });
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target === fullCanvas) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.preventDefault();
      close();
    }
  });
  window.addEventListener('resize', () => {
    lastDrawAt = -Infinity;
    paint();
  }, { passive: true });

  function render(time, x, y, others) {
    localX = Number.isFinite(x) ? x : 0;
    localY = Number.isFinite(y) ? y : 0;
    remotePlayers = others instanceof Map ? others : new Map();
    if (document.hidden || time - lastDrawAt < 100) return;
    lastDrawAt = time;
    paint();
  }

  return { render };
}

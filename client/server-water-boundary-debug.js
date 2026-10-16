// Diagnostics only: server-authoritative water collision contours drawn above WebGL.
// Opt in via ?play=1&debugWater=1. HUD, game physics and water meshes are unchanged.
export function createServerWaterBoundaryDebug(game) {
  const enabled = new URLSearchParams(location.search).get('debugWater') === '1';
  const inactive = { resize() {}, render() {} };
  if (!enabled || !game) return inactive;

  const canvas = document.createElement('canvas');
  canvas.id = 'server-water-boundary-debug';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return inactive;
  game.appendChild(canvas);

  let scale = 1;
  let viewWidth = 1;
  let viewHeight = 1;

  function resize(pixelWidth, pixelHeight, dpr, worldScale) {
    const width = Math.max(1, pixelWidth);
    const height = Math.max(1, pixelHeight);
    scale = Math.max(0.01, worldScale);
    viewWidth = width / scale;
    viewHeight = height / scale;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }

  function render(waters, cameraX, cameraY) {
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    let outlined = 0;
    const total = Array.isArray(waters) ? waters.length : 0;

    for (const water of Array.isArray(waters) ? waters : []) {
      // These exact collision vertices are sent from the server, not an
      // approximation based on the client's visible water model.
      const contour = water.serverContour;
      if (!Array.isArray(contour) || contour.length < 3) continue;
      const angle = (Number.isFinite(water.rotation) ? water.rotation : 0) + Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const size = 50 * water.scale; // server getWaterScale(water)
      if (!Number.isFinite(size) || size <= 0) continue;

      let valid = true;
      const screenPoints = [];
      for (const point of contour) {
        if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          valid = false;
          break;
        }
        // Inverse of server getWaterLocalPosition; then normal isometric camera.
        const dx = size * (point[0] * cos - point[1] * sin);
        const dy = size * (point[0] * sin + point[1] * cos);
        const relativeX = water.x + dx - cameraX;
        const relativeY = water.y + dy - cameraY;
        screenPoints.push({
          x: viewWidth / 2 + (relativeX - relativeY) * 0.8660254,
          y: viewHeight / 2 + (relativeX + relativeY) * 0.5,
        });
      }
      if (!valid) continue;

      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.closePath();
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ff1717';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 6 / scale;
      ctx.lineWidth = 4 / scale; // 4 CSS pixels, regardless of display height
      ctx.stroke();
      ctx.restore();
      outlined++;
    }

    ctx.save();
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4 / scale;
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + (12 / scale) + 'px monospace';
    ctx.fillStyle = outlined ? '#ff5a5a' : '#ffacac';
    ctx.fillText(
      'SERVER WATER: ' + outlined + '/' + total + (outlined ? ' (collision outlines)' : ' (waiting for contours)'),
      viewWidth / 2,
      24 / scale
    );
    ctx.restore();
  }

  return { resize, render };
}

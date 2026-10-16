// Minimal floating labels: equal silhouette-to-text distance above and below.
// The character's actual model bounds are measured once, not each frame.
const ISO_X = 0.8660254, ISO_Y = 0.5;

export function measurePlayerLabelBounds(THREE, root) {
  if (!root) return null;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const top = box.max.y - root.position.y;
  const bottom = box.min.y - root.position.y;
  if (!Number.isFinite(top) || !Number.isFinite(bottom) ||
      top <= bottom || top - bottom < 10 || top - bottom > 210) return null;
  return { top, bottom };
}

export function createPlayerLabels(canvas) {
  const ctx = canvas?.getContext('2d', { alpha: true });
  if (!ctx) return { resize() {}, render() {} };
  let width = 1, height = 1;
  let energyFont = 15, nameFont = 9, localGap = 8, enemyGap = 8;
  let fontFamily = 'system-ui, sans-serif';

  function resize(pixelWidth, pixelHeight, dpr, worldScale) {
    const scale = Math.max(0.01, worldScale);
    width = Math.max(1, pixelWidth) / scale;
    height = Math.max(1, pixelHeight) / scale;
    canvas.width = Math.max(1, Math.round(pixelWidth * dpr));
    canvas.height = Math.max(1, Math.round(pixelHeight * dpr));
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    const game = document.querySelector('#game');
    const style = game ? getComputedStyle(game) : null;
    const read = (key, fallback) => {
      const n = parseFloat(style?.getPropertyValue(key));
      return Number.isFinite(n) ? n : fallback;
    };
    energyFont = read('--echo-player-energy-font', 15);
    nameFont = read('--echo-player-name-font', 9);
    localGap = read('--echo-player-label-gap', 8);
    enemyGap = read('--echo-enemy-label-gap', 8);
    fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--echo-font-family').trim() || 'system-ui, sans-serif';
  }

  function textMetrics(text, fontSize) {
    const metrics = ctx.measureText(text);
    return {
      top: Number.isFinite(metrics.actualBoundingBoxAscent)
        ? metrics.actualBoundingBoxAscent : fontSize * 0.76,
      bottom: Number.isFinite(metrics.actualBoundingBoxDescent)
        ? metrics.actualBoundingBoxDescent : fontSize * 0.20,
    };
  }

  function drawLabel(x, y, energy, name, enemy, cameraX, cameraY, bounds) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dx = x - cameraX, dy = y - cameraY;
    const px = width / 2 + (dx - dy) * ISO_X;
    const py = height / 2 + (dx + dy) * ISO_Y;
    if (px < -130 || px > width + 130 || py < -140 || py > height + 140) return;

    // Cache model head/feet heights per character, including different skins.
    const top = Number.isFinite(bounds?.top) ? bounds.top : 5;
    const bottom = Number.isFinite(bounds?.bottom) ? bounds.bottom : (enemy ? -52 : -62);
    const gap = enemy ? enemyGap : localGap;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const value = String(Math.max(0, Math.round(Number(energy) || 0)));
    ctx.font = '500 ' + energyFont + 'px ' + fontFamily;
    const numberHeight = textMetrics(value, energyFont);
    ctx.fillStyle = '#eaf1f7';
    // Bottom of the energy text is exactly gap above the model's head.
    ctx.fillText(value, px, py - top - gap - numberHeight.bottom);

    const displayName = typeof name === 'string' && name.trim() ? name : 'Игрок';
    ctx.font = '400 ' + nameFont + 'px ' + fontFamily;
    const nameHeight = textMetrics(displayName, nameFont);
    ctx.fillStyle = enemy ? '#d95b65' : '#c3cfda';
    // Top of the name text is exactly gap below the model's feet.
    ctx.fillText(displayName, px, py - bottom + gap + nameHeight.top, 130);
    ctx.restore();
  }

  function render(local, others, cameraX, cameraY, loadedModels) {
    ctx.clearRect(0, 0, width, height);
    if (others instanceof Map) {
      for (const [id, player] of others) {
        const model = loadedModels instanceof Map ? loadedModels.get(id) : null;
        if (loadedModels instanceof Map && !model) continue;
        const x = Number.isFinite(player.displayX) ? player.displayX : player.targetX;
        const y = Number.isFinite(player.displayY) ? player.displayY : player.targetY;
        drawLabel(x, y, player.energy, player.name, true, cameraX, cameraY, model?.root?.userData?.labelBounds);
      }
    }
    if (local?.visible) {
      drawLabel(local.x, local.y, local.energy, local.name, false, cameraX, cameraY, local.bounds);
    }
  }
  return { resize, render };
}

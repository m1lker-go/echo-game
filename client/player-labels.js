// A lightweight overlay above WebGL for character energy and public names.
// Uses the same virtual world camera and ISO projection as game.js.
const ISO_X = 0.8660254, ISO_Y = 0.5;

export function createPlayerLabels(canvas) {
  const unused = { resize() {}, render() {} };
  const ctx = canvas?.getContext('2d', { alpha: true });
  if (!ctx) return unused;
  let width = 1, height = 1;
  let energyFont = 16, localEnergyY = 54, enemyEnergyY = 47;
  let nameFont = 9.5, localNameY = 49, enemyNameY = 47;

  function resize(pixelWidth, pixelHeight, dpr, worldScale) {
    const scale = Math.max(0.01, worldScale);
    width = Math.max(1, pixelWidth) / scale;
    height = Math.max(1, pixelHeight) / scale;
    canvas.width = Math.max(1, Math.round(pixelWidth * dpr));
    canvas.height = Math.max(1, Math.round(pixelHeight * dpr));
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    // Each label size and position remains tunable in ui-layout.css.
    const element = document.querySelector('#game');
    const style = element ? getComputedStyle(element) : null;
    const read = (key, fallback) => {
      const n = parseFloat(style?.getPropertyValue(key));
      return Number.isFinite(n) ? n : fallback;
    };
    energyFont = read('--echo-player-energy-font', 16);
    localEnergyY = read('--echo-player-energy-offset', 54);
    enemyEnergyY = read('--echo-enemy-energy-offset', 47);
    nameFont = read('--echo-player-name-font', 9.5);
    localNameY = read('--echo-player-name-offset', 49);
    enemyNameY = read('--echo-enemy-name-offset', 47);
  }

  function drawLabel(x, y, energy, name, enemy, cameraX, cameraY) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dx = x - cameraX, dy = y - cameraY;
    const px = width / 2 + (dx - dy) * ISO_X;
    const py = height / 2 + (dx + dy) * ISO_Y;
    if (px < -130 || px > width + 130 || py < -140 || py > height + 140) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 4, 12, 0.85)';

    const value = String(Math.max(0, Math.round(Number(energy) || 0)));
    ctx.font = '700 ' + energyFont + 'px Inter, system-ui, sans-serif';
    ctx.lineWidth = 2.7;
    ctx.shadowColor = 'rgba(200, 234, 255, 0.68)';
    ctx.shadowBlur = 7;
    const energyY = py - (enemy ? enemyEnergyY : localEnergyY);
    ctx.strokeText(value, px, energyY);
    ctx.fillStyle = '#f2f9ff';
    ctx.fillText(value, px, energyY);

    const displayName = typeof name === 'string' && name.trim() ? name : 'Игрок';
    ctx.font = '600 ' + nameFont + 'px Inter, system-ui, sans-serif';
    ctx.lineWidth = 2.2;
    ctx.shadowColor = enemy ? 'rgba(255, 70, 84, 0.72)' : 'rgba(167, 219, 255, 0.52)';
    ctx.shadowBlur = 5;
    const nameY = py + (enemy ? enemyNameY : localNameY);
    ctx.strokeText(displayName, px, nameY, 130);
    ctx.fillStyle = enemy ? '#ff5967' : '#edf7ff';
    ctx.fillText(displayName, px, nameY, 130);
    ctx.restore();
  }

  function render(local, others, cameraX, cameraY, loadedModels) {
    ctx.clearRect(0, 0, width, height);
    if (others instanceof Map) {
      for (const [id, player] of others) {
        if (loadedModels instanceof Map && !loadedModels.has(id)) continue;
        const x = Number.isFinite(player.displayX) ? player.displayX : player.targetX;
        const y = Number.isFinite(player.displayY) ? player.displayY : player.targetY;
        drawLabel(x, y, player.energy, player.name, true, cameraX, cameraY);
      }
    }
    if (local?.visible) {
      drawLabel(local.x, local.y, local.energy, local.name, false, cameraX, cameraY);
    }
  }

  return { resize, render };
}

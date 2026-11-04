// The arena boundary is drawn into the SAME #world canvas and frame as the grid.
// No independent RAF, socket interpolation or second camera.
const FIELD_HALF = (50 * 84) / 2;
const ISO_X = 0.8660254, ISO_Y = 0.5;
let localX = 0, localY = 0, velocityX = 0, velocityY = 0;

export function renderWorldBoundary(ctx, cameraX, cameraY, width, height, playerX, playerY, vx, vy) {
  localX = playerX; localY = playerY; velocityX = vx; velocityY = vy;
  const project = (x, y) => ({
    x: width / 2 + ((x - cameraX) - (y - cameraY)) * ISO_X,
    y: height / 2 + ((x - cameraX) + (y - cameraY)) * ISO_Y,
  });
  const corners = [
    project(-FIELD_HALF, -FIELD_HALF), project(FIELD_HALF, -FIELD_HALF),
    project(FIELD_HALF, FIELD_HALF), project(-FIELD_HALF, FIELD_HALF),
  ];
  const boundaryPath = () => {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
  };
  ctx.save();
  // Cut away the grid outside the authoritative, fixed world rectangle.
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(2, 7, 14, .86)';
  ctx.fill('evenodd');
  boundaryPath();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(64, 190, 255, .95)';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(58, 181, 255, .95)';
  ctx.lineWidth = 8;
  ctx.stroke();
  boundaryPath();
  ctx.shadowColor = 'rgba(107, 214, 255, .9)';
  ctx.shadowBlur = 9;
  ctx.strokeStyle = 'rgba(104, 211, 255, 1)';
  ctx.lineWidth = 3;
  ctx.stroke();
  boundaryPath();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(190, 239, 255, .95)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// Preserve the previous client-side jump guard without a separate predicted camera.
document.querySelector('#jump')?.addEventListener('pointerdown', event => {
  const speed = Math.hypot(velocityX, velocityY);
  if (speed < 1) return;
  const targetX = localX + velocityX / speed * 420;
  const targetY = localY + velocityY / speed * 420;
  if (targetX < -FIELD_HALF || targetX > FIELD_HALF ||
      targetY < -FIELD_HALF || targetY > FIELD_HALF) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

// Character rotation lives here. Do not put movement/input logic in this file.

export function updateCharacterFacing(root, vx, vy, ISO) {
  if (!root) return;

  const moving = Math.hypot(vx || 0, vy || 0) > 18;
  if (!moving) return;

  const screenVX = ((vx || 0) - (vy || 0)) * ISO.x;
  const screenVY = ((vx || 0) + (vy || 0)) * ISO.y;
  const angle = Math.atan2(screenVX, screenVY);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;

  // Current character-facing calibration. Movement is deliberately not changed here.
  const horizontal = Math.abs(Math.sin(snapped)) > 0.01;
  root.rotation.y = -snapped + (horizontal ? Math.PI : 0);
}

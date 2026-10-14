// Explicit 8-direction facing calibration. Each entry owns its yaw;
// angles are spaced by exactly 45 degrees and cover one full 360-degree turn.
// Tune individual values here after checking the model in-game; don't touch controls.
const DEG = Math.PI / 180;

export const CHARACTER_FACING = Object.freeze({
  UP:          0 * DEG,
  UP_RIGHT:    45 * DEG,
  RIGHT:       90 * DEG,
  DOWN_RIGHT: 135 * DEG,
  DOWN:       180 * DEG,
  DOWN_LEFT:  225 * DEG,
  LEFT:       270 * DEG,
  UP_LEFT:    315 * DEG,
});

const DIRECTION_ORDER = [
  'UP',
  'UP_RIGHT',
  'RIGHT',
  'DOWN_RIGHT',
  'DOWN',
  'DOWN_LEFT',
  'LEFT',
  'UP_LEFT',
];

const MOVEMENT_THRESHOLD = 18;
const DIRECTION_STEP = Math.PI / 4;

export function updateCharacterFacing(root, vx, vy, ISO) {
  if (!root) return;

  const worldVX = Number.isFinite(vx) ? vx : 0;
  const worldVY = Number.isFinite(vy) ? vy : 0;
  if (Math.hypot(worldVX, worldVY) < MOVEMENT_THRESHOLD) return;

  // Convert world velocity back to its visible screen-space direction.
  const screenX = (worldVX - worldVY) * ISO.x;
  const screenY = (worldVX + worldVY) * ISO.y;
  const angle = Math.atan2(screenX, -screenY);
  const index = ((Math.round(angle / DIRECTION_STEP) % 8) + 8) % 8;
  const direction = DIRECTION_ORDER[index];

  // Only this table controls the model yaw.
  root.rotation.y = CHARACTER_FACING[direction];
}

export { DIRECTION_ORDER };

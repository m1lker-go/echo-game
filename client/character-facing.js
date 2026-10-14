// Character-facing calibration table. Each of the eight compass directions has
// its own explicit yaw. The values go around one complete 360-degree turn in
// 45-degree increments. If a particular view is reversed, adjust only that entry.
//
// IMPORTANT: these are starting calibration values based on the current mapping.
// The model's local forward axis may require a shared offset after visual testing.
const DEG = Math.PI / 180;

export const CHARACTER_FACING = Object.freeze({
  UP:         0,
  UP_RIGHT:  45 * DEG,
  RIGHT:     90 * DEG,
  DOWN_RIGHT:135 * DEG,
  DOWN:     180 * DEG,
  DOWN_LEFT:225 * DEG,
  LEFT:     270 * DEG,
  UP_LEFT:  315 * DEG,
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

/**
 * Applies one explicit yaw from CHARACTER_FACING based on the on-screen
 * direction of the hero's velocity. Movement/input code lives elsewhere.
 *
 * Direction convention assumes screen X positive = right and screen Y positive
 * = down. The isometric velocity projection is converted back into a screen
 * direction before choosing the nearest 45-degree sector.
 */
export function updateCharacterFacing(root, vx, vy, ISO) {
  if (!root) return;

  const worldVX = Number.isFinite(vx) ? vx : 0;
  const worldVY = Number.isFinite(vy) ? vy : 0;
  if (Math.hypot(worldVX, worldVY) < MOVEMENT_THRESHOLD) return;

  const screenX = (worldVX - worldVY) * ISO.x;
  const screenY = (worldVX + worldVY) * ISO.y;
  const angle = Math.atan2(screenX, -screenY);
  const index = ((Math.round(angle / DIRECTION_STEP) % 8) + 8) % 8;
  const direction = DIRECTION_ORDER[index];
  root.rotation.y = CHARACTER_FACING[direction];
}

export { DIRECTION_ORDER };

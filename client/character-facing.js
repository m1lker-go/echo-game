// Explicit eight-direction facing table. Every direction has its own yaw.
// The table contains one complete 360-degree revolution in 45-degree steps.
// Calibrate individual entries here after visually testing the character model;
// do not change movement/input logic for orientation tweaks.
const DEG = Math.PI / 180;

export const CHARACTER_FACING = Object.freeze({
  DOWN:       0 * DEG,
  DOWN_RIGHT: 45 * DEG,
  RIGHT:       90 * DEG,
  UP_RIGHT:    135 * DEG,
  UP:           180 * DEG,
  UP_LEFT:    225 * DEG,
  LEFT:       270 * DEG,
  DOWN_LEFT:  315 * DEG,
});

const MOVEMENT_THRESHOLD = 18;
const DIRECTION_STEP = Math.PI / 4;

// Index order mirrors CHARACTER_FACING's compass order clockwise from screen-up.
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

export function updateCharacterFacing(root, vx, vy, ISO) {
  if (!root) return;

  const worldVX = Number.isFinite(vx) ? vx : 0;
  const worldVY = Number.isFinite(vy) ? vy : 0;
  if (Math.hypot(worldVX, worldVY) < MOVEMENT_THRESHOLD) return;

  // Convert isometric world velocity back to the visible screen direction.
  const screenX = (worldVX - worldVY) * ISO.x;
  const screenY = (worldVX + worldVY) * ISO.y;
  const angle = Math.atan2(screenX, -screenY);
  const index = ((Math.round(angle / DIRECTION_STEP) % 8) + 8) % 8;
  root.rotation.y = CHARACTER_FACING[DIRECTION_ORDER[index]];
}

export { DIRECTION_ORDER };

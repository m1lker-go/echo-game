// Player movement/input lives here. Keep this file independent from character-facing.js.
// Screen-space controls are intentional:
//   Up    = straight up on screen
//   Down  = straight down on screen
//   Left  = straight left on screen
//   Right = straight right on screen
//   Two keys = 45-degree diagonal on screen

const WORLD_HALF_SIZE = 2100;

// Map physical WASD positions, independent of Russian/English layout or
// Caps Lock. Keep arrow keys and a fallback for browsers without event.code.
const MOVEMENT_BY_CODE = new Map([
  ['KeyW', 'w'], ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'],
  ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'],
  ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight']
]);
const MOVEMENT_BY_KEY = new Map([
  ['w', 'w'], ['a', 'a'], ['s', 's'], ['d', 'd'],
  ['ц', 'w'], ['ф', 'a'], ['ы', 's'], ['в', 'd'],
  ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'],
  ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight']
]);

function normalizeMovementKey(event) {
  const physical = MOVEMENT_BY_CODE.get(event.code);
  if (physical) return physical;
  const key = typeof event.key === 'string' ? event.key : '';
  return MOVEMENT_BY_KEY.get(key) || MOVEMENT_BY_KEY.get(key.toLowerCase()) || null;
}

export function bindPlayerControls({ state, joystick, stick, boostButton, triggerBoost }) {

  function setJoystick(clientX, clientY) {
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * .31;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    state.inputX = dx / max;
    state.inputY = dy / max;
  }

  function resetJoystick() {
    stick.style.transform = 'translate(0, 0)';
    state.inputX = 0;
    state.inputY = 0;
  }

  let joystickActive = false;
  joystick.addEventListener('pointerdown', (e) => {
    joystickActive = true;
    joystick.setPointerCapture(e.pointerId);
    setJoystick(e.clientX, e.clientY);
  });
  joystick.addEventListener('pointermove', (e) => {
    if (joystickActive) setJoystick(e.clientX, e.clientY);
  });
  joystick.addEventListener('pointerup', resetJoystick);
  joystick.addEventListener('pointercancel', resetJoystick);

  // Boost cooldown visuals are owned by the global handler in asset-loader-patch.js
  // so there is only one cooldown timer.
  boostButton.addEventListener('pointerdown', triggerBoost);
  window.addEventListener('keydown', (e) => {
    const key = normalizeMovementKey(e);
    if (key) {
      state.keys.add(key);
      if (key.startsWith('Arrow')) e.preventDefault();
    }
    if (e.code === 'Space') triggerBoost();
  });
  window.addEventListener('keyup', (e) => {
    const key = normalizeMovementKey(e);
    if (key) state.keys.delete(key);
  });
  // Avoid a stuck movement key when focus is lost while holding it.
  window.addEventListener('blur', () => state.keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.keys.clear();
  });
}

export function updatePlayerMovement(state, dt, time, ISO, obstacles = []) {
  let screenX = state.inputX;
  let screenY = state.inputY;

  if (state.keys.has('ArrowLeft') || state.keys.has('a')) screenX -= 1;
  if (state.keys.has('ArrowRight') || state.keys.has('d')) screenX += 1;
  if (state.keys.has('ArrowUp') || state.keys.has('w')) screenY -= 1;
  if (state.keys.has('ArrowDown') || state.keys.has('s')) screenY += 1;

  const len = Math.hypot(screenX, screenY);
  if (len > 1) {
    screenX /= len;
    screenY /= len;
  }

  // Inverse of the isometric projection. This converts the desired screen
  // direction into world velocity, so controls stay visually top-down while
  // the world itself remains isometric.
  const worldX = screenX / (2 * ISO.x) + screenY / (2 * ISO.y);
  const worldY = -screenX / (2 * ISO.x) + screenY / (2 * ISO.y);

  const boosted = time < state.boostUntil;
  const waterMultiplier = Number.isFinite(state.speedMultiplier) ? Math.max(0, Math.min(1, state.speedMultiplier)) : 1;
  const speed = (boosted ? 300 : 155) * waterMultiplier;
  const smoothing = Math.min(1, dt * 12);

  state.vx += (worldX * speed - state.vx) * smoothing;
  state.vy += (worldY * speed - state.vy) * smoothing;
  const oldX = state.x;
  const oldY = state.y;
  const nextX = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, oldX + state.vx * dt));
  const nextY = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, oldY + state.vy * dt));
  const playerRadius = 24;
  const blocked = (x, y) => obstacles.some(tree =>
    Math.hypot(x - tree.x, y - tree.y) < (Number(tree.collisionRadius) || 0) + playerRadius
  );

  if (!blocked(nextX, nextY)) {
    state.x = nextX;
    state.y = nextY;
  } else {
    if (!blocked(nextX, oldY)) {
      state.x = nextX;
      state.y = oldY;
    } else if (!blocked(oldX, nextY)) {
      state.x = oldX;
      state.y = nextY;
    } else {
      state.x = oldX;
      state.y = oldY;
    }
    state.vx = 0;
    state.vy = 0;
  }

  window.dispatchEvent(new CustomEvent('echo:player-movement', {
    detail: { x: state.x, y: state.y, vx: state.vx, vy: state.vy }
  }));
}
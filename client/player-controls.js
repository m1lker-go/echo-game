// Player movement/input lives here. Keep this file independent from character-facing.js.
// Screen-space controls are intentional:
//   Up    = straight up on screen
//   Down  = straight down on screen
//   Left  = straight left on screen
//   Right = straight right on screen
//   Two keys = 45-degree diagonal on screen

const WORLD_HALF_SIZE = 4200;

export function bindPlayerControls({ state, joystick, stick, boostButton, triggerBoost }) {
  // Expose the live state only for the compatibility boost handler installed by
  // asset-loader-patch.js. The game itself remains the owner of movement state.
  globalThis.echoGameState = state;

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
    state.keys.add(e.key);
    if (e.code === 'Space') triggerBoost();
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.key));
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
  const speed = boosted ? 300 : 155;
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
}

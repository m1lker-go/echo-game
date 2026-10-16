const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Test the actual browser input module, not a duplicate keyboard mapping.
// Node's test runner loads the ESM source into an isolated DOM-less harness.
const code = fs.readFileSync(
  path.join(__dirname, '../../client/player-controls.js'), 'utf8'
).replace(/^export\s+/gm, '');
const load = new Function(
  'window', 'document', 'CustomEvent',
  code + '\nreturn { normalizeMovementKey, bindPlayerControls, updatePlayerMovement };'
);

function rig() {
  const windowEvents = new Map(), documentEvents = new Map();
  const fakeWindow = {
    addEventListener(type, listener) { windowEvents.set(type, listener); },
    dispatchEvent() {}
  };
  const fakeDocument = {
    hidden: false,
    addEventListener(type, listener) { documentEvents.set(type, listener); }
  };
  const FakeCustomEvent = class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  };
  const controls = load(fakeWindow, fakeDocument, FakeCustomEvent);
  const element = () => ({
    style: {},
    addEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 112, height: 112 }; }
  });
  const state = {
    keys: new Set(), inputX: 0, inputY: 0,
    x: 0, y: 0, vx: 0, vy: 0, boostUntil: 0, speedMultiplier: 1
  };
  let boosts = 0;
  controls.bindPlayerControls({
    state, joystick: element(), stick: element(), boostButton: element(),
    triggerBoost() { boosts++; }
  });
  const emit = (type, code, key) => {
    let prevented = false;
    windowEvents.get(type)?.({
      code, key, preventDefault() { prevented = true; }
    });
    return prevented;
  };
  return { ...controls, state, emit, windowEvents, documentEvents, fakeDocument, getBoosts: () => boosts };
}

test('WASD works on both layouts and with Shift/Caps Lock', () => {
  const { normalizeMovementKey } = rig();
  for (const [code, latin, russian, expected] of [
    ['KeyW', 'W', 'Ц', 'w'], ['KeyA', 'A', 'Ф', 'a'],
    ['KeyS', 'S', 'Ы', 's'], ['KeyD', 'D', 'В', 'd']
  ]) {
    assert.equal(normalizeMovementKey({ code, key: latin }), expected);
    assert.equal(normalizeMovementKey({ code, key: russian }), expected);
    assert.equal(normalizeMovementKey({ code: 'Unidentified', key: russian }), expected);
  }
  assert.equal(normalizeMovementKey({ code: 'KeyQ', key: 'й' }), null);
});

test('arrow keys remain functional; blur and hidden tabs release held keys', () => {
  const r = rig();
  assert.equal(r.emit('keydown', 'ArrowUp', 'ArrowUp'), true);
  assert.equal(r.state.keys.has('ArrowUp'), true);
  r.emit('keyup', 'ArrowUp', 'ArrowUp');
  assert.equal(r.state.keys.size, 0);

  r.emit('keydown', 'KeyW', 'ц');
  r.emit('keydown', 'KeyD', 'в');
  assert.deepEqual(Array.from(r.state.keys).sort(), ['d', 'w']);
  r.emit('keyup', 'KeyW', 'Ц');
  r.emit('keyup', 'KeyD', 'В');
  assert.equal(r.state.keys.size, 0);

  r.emit('keydown', 'KeyS', 'ы');
  r.windowEvents.get('blur')();
  assert.equal(r.state.keys.size, 0);
  r.emit('keydown', 'KeyA', 'ф');
  r.fakeDocument.hidden = true;
  r.documentEvents.get('visibilitychange')();
  assert.equal(r.state.keys.size, 0);

  r.emit('keydown', 'Space', ' ');
  assert.equal(r.getBoosts(), 1);
});

test('Russian-layout W+D diagonal moves screen-right and screen-up', () => {
  const r = rig();
  r.emit('keydown', 'KeyW', 'ц');
  r.emit('keydown', 'KeyD', 'в');
  r.updatePlayerMovement(r.state, 0.05, 1000, { x: .8660254, y: .5 }, []);
  const screenRight = (r.state.x - r.state.y) * .8660254;
  const screenDown = (r.state.x + r.state.y) * .5;
  assert.ok(screenRight > 0, 'D should move toward screen right');
  assert.ok(screenDown < 0, 'W should move toward screen top');
});

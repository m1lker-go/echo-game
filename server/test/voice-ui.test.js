'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../client/voice-ui.css'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../../client/voice-ui.js'), 'utf8');

function harness() {
  const nodes = new Map();
  const events = new Map();
  const messages = [];
  const store = new Map();
  const requests = [];
  let stopped = 0;
  function element() {
    const handlers = new Map();
    const attrs = new Map();
    const classes = new Set();
    return {
      children: [], textContent: '', hidden: false, tagName: 'DIV',
      className: '',
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, enabled) => { if (enabled) classes.add(name); else classes.delete(name); }
      },
      setAttribute: (name, value) => attrs.set(name, value),
      getAttribute: name => attrs.get(name),
      setPointerCapture() {},
      addEventListener: (name, callback) => { handlers.set(name, callback); },
      trigger: (name, event = {}) => handlers.get(name)?.(event),
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; }
    };
  }
  for (const id of ['#echo-voice-mic', '#echo-voice-speakers', '#echo-voice-speakers-list', '#main-menu'])
    nodes.set(id, element());
  nodes.get('#main-menu').classList.add('is-hidden');
  const document = {
    hidden: false, documentElement: { lang: 'ru' },
    querySelector: selector => nodes.get(selector) || null,
    createElement: element, createElementNS: (_, name) => element(name),
    addEventListener: (name, fn) => { const list = events.get(name) || []; list.push(fn); events.set(name, list); },
    dispatchEvent: evt => { for (const fn of events.get(evt.type) || []) fn(evt); }
  };
  const windowEvents = new Map();
  const window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    ECHOToast: { show: value => messages.push(value) },
    ECHOVoiceTransport: null
  };
  const sessionStorage = {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, value)
  };
  const navigator = { mediaDevices: { async getUserMedia() {
    requests.push(1);
    return { getTracks: () => [{ stop: () => { stopped++; } }] };
  } } };
  const CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts.detail; } };
  vm.runInNewContext(source, { window, document, navigator, sessionStorage, CustomEvent, setInterval() {}, Date, console }, { filename: 'voice-ui.js' });
  return {
    window, document, navigator, nodes, messages, requests, store,
    get stopped() { return stopped; },
    enterRoom(roomId, roundId) { const socket = new EventEmitter(); socket.connected = false;
      document.dispatchEvent({ type: 'echo:socket-ready', detail: { socket } });
      socket.emit('echo:room', { roomId, round: { id: roundId } });
      return socket;
    },
    speaking(data) { document.dispatchEvent({ type: 'echo:voice-speaking', detail: data }); },
    pointer(name, pointerId=3) { nodes.get('#echo-voice-mic').trigger(name, { pointerId, button: 0, preventDefault() {} }); },
    tap() { nodes.get('#echo-voice-mic').trigger('click', {preventDefault() {}}); },
    windowEvent(name) { windowEvents.get(name)?.({}); },
    hidePage() { document.hidden = true; document.dispatchEvent({type:'visibilitychange'}); },
    desktopV() { windowEvents.get('keydown')?.({code:'KeyV',repeat:false,target:{tagName:'BODY'},preventDefault() {}}); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('voice HUD uses current abilities, hidden speaking panel and no fake speakers', () => {
  assert.match(html, /id="echo-voice-mic"[^>]*class="ability echo-voice-mic"/);
  assert.match(html, /id="echo-voice-speakers"[^>]*aria-label="Говорят рядом" hidden/);
  assert.match(html, /src="\.\/voice-ui\.js\?v=echo-voice-ui-8"/);
  assert.match(css, /--echo-jump-size/);
  const app = harness();
  assert.equal(app.nodes.get('#echo-voice-speakers').hidden, true);
  assert.equal(app.nodes.get('#echo-voice-speakers-list').children.length, 0);
  app.tap();
  assert.equal(app.messages.length, 1);
  assert.equal(app.requests.length, 0, 'no microphone request without an audio transport');
});

test('Android first press requests permission even when LiveKit is still connecting', async () => {
  const app = harness();
  app.window.ECHO_ANDROID_ARENA = true;
  app.tap();
  await app.flush();
  assert.equal(app.requests.length, 1, 'Android getUserMedia must run on the first tap');
  assert.equal(app.stopped, 1, 'capture is closed when voice is still disconnected');
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'false');
  assert.match(app.messages.at(-1), /пока не подключён/);
});

test('Android tapping off during permission request prevents late audio publication', async () => {
  const app = harness();
  app.window.ECHO_ANDROID_ARENA = true;
  let grantPermission;
  let starts = 0, stops = 0;
  app.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grantPermission = resolve; });
  const transport = { ready: false, start: async () => { starts++; }, stop() {} };
  app.window.ECHOVoiceTransport = transport;

  app.tap();
  assert.equal(typeof grantPermission, 'function', 'request starts immediately');
  app.tap();
  transport.ready = true;
  grantPermission({getTracks: () => [{stop: () => { stops++; }}]});
  await app.flush();

  assert.equal(starts, 0, 'late permission must not publish microphone');
  assert.equal(stops, 1, 'late audio capture must be closed');
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'false');
});

test('Android first tap turns voice on when LiveKit connects during permission dialog', async () => {
  const app = harness();
  app.window.ECHO_ANDROID_ARENA = true;
  let grantPermission;
  let starts = 0, stops = 0;
  app.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grantPermission = resolve; });
  const transport = { ready: false, start: async () => { starts++; }, stop() {} };
  app.window.ECHOVoiceTransport = transport;

  app.tap();
  transport.ready = true;
  grantPermission({getTracks: () => [{stop: () => { stops++; }}]});
  await app.flush();
  assert.equal(starts, 1, 'first tap must start when transport is ready');
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'true');
  app.tap();
  assert.equal(stops, 1, 'stops after second tap');
});

test('speaker list filters by room and round, mute persists within one round and resets at the boundary', () => {
  const app = harness();
  const socket = app.enterRoom(1, 'round-1');
  app.speaking({ id: 'user-alex', name: 'Alex', active: true, roomId: 2, roundId: 'round-1' });
  assert.equal(app.nodes.get('#echo-voice-speakers').hidden, true);
  app.speaking({ id: 'user-alex', name: 'Alex', active: true, roomId: 1, roundId: 'round-1' });
  const list = app.nodes.get('#echo-voice-speakers-list');
  assert.equal(list.children.length, 1);
  assert.equal(app.nodes.get('#echo-voice-speakers').hidden, false);
  assert.equal(list.children[0].children[1].textContent, 'Alex');
  assert.equal(list.children[0].children[0].children.length, 1, 'microphone icon visible');
  assert.ok(list.children[0].className.includes('is-speaking'));
  list.children[0].children[2].trigger('click');
  assert.equal(app.window.ECHOVoiceUI.isMuted('user-alex'), true);
  assert.ok(list.children[0].className.includes('is-muted'));
  app.speaking({ id: 'user-alex', name: 'Alex', active: false, roomId: 1, roundId: 'round-1' });
  assert.ok(list.children[0].className.includes('is-idle'));
  socket.emit('disconnect');
  socket.emit('echo:room', { roomId: 1, round: { id: 'round-1' } });
  assert.equal(app.window.ECHOVoiceUI.isMuted('user-alex'), true);
  socket.emit('echo:room', { roomId: 1, round: { id: 'round-2' } });
  assert.equal(app.window.ECHOVoiceUI.isMuted('user-alex'), false);
  assert.equal(app.nodes.get('#echo-voice-speakers').hidden, true);
});

test('tap toggles voice on and off without holding the button', async () => {
  const app = harness();
  app.enterRoom(1, 'round');
  const operations = [];
  const localState = [];
  app.document.addEventListener('echo:voice-self-speaking', e => localState.push(e.detail.active));
  app.window.ECHOVoiceTransport = {
    ready: true,
    start: async () => { operations.push('start'); },
    stop: () => { operations.push('stop'); }
  };
  app.tap();
  await app.flush();
  assert.equal(app.requests.length, 1);
  assert.equal(operations.includes('start'), true);
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.stringify(localState), '[true]');
  app.pointer('pointerup');
  app.pointer('pointercancel');
  app.windowEvent('blur');
  assert.equal(app.stopped, 0, 'finger release and Safari blur do not stop a toggle');
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'true');
  assert.ok(app.nodes.get('#echo-voice-mic').classList.contains('is-transmitting'));
  app.tap();
  assert.equal(app.stopped, 1);
  assert.equal(app.nodes.get('#echo-voice-mic').getAttribute('aria-pressed'), 'false');
  assert.ok(operations.includes('stop'));
  assert.equal(JSON.stringify(localState), '[true,false]');
});


test('microphone is anchored above jump without shifting boost/jump horizontally', () => {
  assert.ok(css.includes('#game .ability-stack { position: relative; }'));
  const start = css.indexOf('#game #echo-voice-mic {');
  assert.ok(start >= 0, 'voice microphone style exists');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.ok(rule.includes('position: absolute;'));
  assert.ok(rule.includes('bottom: calc(100% +'));
  assert.ok(rule.includes('right: calc(var(--echo-jump-size'));
  assert.ok(rule.includes('width: calc(var(--echo-jump-size'));
  assert.ok(html.includes('voice-ui.css?v=echo-voice-ui-6'));
  assert.ok(html.indexOf('id="boost"') < html.indexOf('id="jump"'));
});

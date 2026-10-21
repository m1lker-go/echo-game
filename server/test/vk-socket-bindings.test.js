'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function makeDom(initialSocket = null) {
  const elements = new Map();
  const listeners = new Map();
  function element() {
    return {
      textContent: '', children: [], dataset: {}, className: '',
      classList: { contains: () => true, add() {} },
      setAttribute() {}, addEventListener() {},
      replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; },
      append(...nodes) { this.children.push(...nodes); },
    };
  }
  const selectors = ['#echo-room-leaderboard', '#echo-board-clock',
    '#echo-board-room', '#echo-board-list', '#echo-board-me', '#main-menu'];
  for (const selector of selectors) elements.set(selector, element());
  const tabs = [element(), element()];
  tabs[0].dataset.boardTab = 'rating';
  tabs[1].dataset.boardTab = 'energy';
  const document = {
    documentElement: { lang: 'ru' },
    querySelector: (selector) => elements.get(selector) || null,
    querySelectorAll: (selector) => selector === '[data-board-tab]' ? tabs : [],
    createElement: element,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
  };
  const opened = [];
  const window = {
    echoSocket: initialSocket,
    addEventListener() {},
    $t: (_key, fallback) => fallback,
    ECHOModal: { open: (item) => opened.push(item) },
  };
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
  };
  return { document, window, localStorage, elements, opened };
}

function loadClient(file, context) {
  const source = fs.readFileSync(path.join(__dirname, '../../client', file), 'utf8');
  vm.runInNewContext(source, {
    ...context,
    Date,
    setInterval() {},
  }, { filename: file });
}

test('VK delayed Socket.IO initialization fills the room leaderboard', () => {
  const env = makeDom();
  loadClient('room-leaderboard.js', env);
  assert.equal(env.elements.get('#echo-board-list').textContent, 'Ожидание игроков…');
  const socket = new EventEmitter();
  socket.connected = false;
  env.window.echoSocket = socket;
  env.document.dispatchEvent({ type: 'echo:socket-ready', detail: { socket } });
  socket.emit('echo:room', { roomId: 3, round: { id: 'round-1', endsAt: Date.now() + 90000 } });
  socket.emit('echo:leaderboard', {
    roundId: 'round-1',
    rating: { top: [{ place: 1, name: 'Player', value: 42 }], me: null },
    energy: { top: [], me: null },
  });
  assert.equal(env.elements.get('#echo-board-room').textContent, 'Комната 3');
  assert.match(env.elements.get('#echo-board-clock').textContent, /^\d\d:\d\d$/);
  assert.equal(env.elements.get('#echo-board-list').children.length, 1);
  assert.equal(env.elements.get('#echo-board-list').children[0].children[0].textContent, '1. Player');
});

test('a widget that loads after socket connection requests a fresh room snapshot', () => {
  const socket = new EventEmitter();
  socket.connected = true;
  let helloCount = 0;
  socket.on('echo:hello', () => { helloCount += 1; });
  const env = makeDom(socket);
  loadClient('room-leaderboard.js', env);
  assert.equal(helloCount, 1);
  env.document.dispatchEvent({ type: 'echo:socket-ready', detail: { socket } });
  assert.equal(helloCount, 1, 'duplicate socket-ready event must not resubscribe');
});

test('late VK socket also delivers 15-minute round results', () => {
  const env = makeDom();
  loadClient('round-results.js', env);
  const socket = new EventEmitter();
  env.window.echoSocket = socket;
  env.document.dispatchEvent({ type: 'echo:socket-ready', detail: { socket } });
  socket.emit('echo:roundResults', [{ round_id: '1234', place: 1, authenticated: true, coins: 50 }]);
  assert.equal(env.opened.length, 1);
  assert.equal(env.localStorage.getItem('echo.lastRoundResult'), '1234');
  env.document.dispatchEvent({ type: 'echo:socket-ready', detail: { socket } });
  socket.emit('echo:roundResults', [{ round_id: '1234', place: 1, authenticated: true, coins: 50 }]);
  assert.equal(env.opened.length, 1, 'repeated events should not redisplay a claimed result');
});

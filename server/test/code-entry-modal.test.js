'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clientDir = path.join(__dirname, '../../client');

function loadFixture() {
  let openCode = null;
  let modal = null;
  let focused = null;
  const toasts = [];
  const confirmClicks = [];
  const trigger = {
    addEventListener(event, handler) {
      if (event === 'click') openCode = handler;
    }
  };
  function makeElement(tag) {
    return {
      tag,
      value: '',
      handlers: {},
      isConnected: true,
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, handler) { this.handlers[key] = handler; },
      append(child) { this.child = child; },
      focus() { focused = this; },
      closest() { return { querySelector() { return { click() { confirmClicks.push('ok'); modal.buttons[0].onClick(); } }; } }; }
    };
  }
  const document = {
    querySelector(selector) { return selector === '#settings-enter-code' ? trigger : null; },
    createElement: makeElement
  };
  const window = {
    $t: (_key, fallback) => fallback,
    ECHOToast: { show(text) { toasts.push(text); } },
    ECHOModal: { open(options) { modal = options; return { close() {} }; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(clientDir, 'code-entry.js'), 'utf8'), {
    document, window, requestAnimationFrame: fn => fn()
  }, {filename:'code-entry.js'});
  return {
    open() { assert.equal(typeof openCode, 'function'); openCode(); return modal; },
    toasts,
    confirmClicks,
    get focused() { return focused; }
  };
}

test('Enter Code is directly above Clear Cache and uses its button classes', () => {
  const html = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
  const codeButton = html.match(/<button id="settings-enter-code"[^>]*>/);
  const cacheButton = html.match(/<button id="settings-clear-cache"[^>]*>/);
  assert.ok(codeButton);
  assert.ok(cacheButton);
  assert.ok(codeButton[0].includes('menu-button settings-cache-button settings-code-button'));
  assert.ok(html.indexOf(codeButton[0]) < html.indexOf(cacheButton[0]));
  assert.match(html, /<script type="module" src="\.\/code-entry\.js\?v=[^"]+"><\/script>/);
  const css = fs.readFileSync(path.join(clientDir, 'settings-refresh.css'), 'utf8');
  assert.match(css, /\.echo-code-input\s*\{[^}]*border:\s*1px solid #fff/s);
});

test('Code modal accepts pasted text and does not claim an unavailable reward', () => {
  const fixture = loadFixture();
  const modal = fixture.open();
  assert.equal(modal.title, 'ВВЕДИТЕ КОД');
  assert.equal(modal.buttons.length, 1);
  assert.equal(modal.buttons[0].label, 'ОК');
  const input = modal.contentElement.child;
  assert.equal(input.type, 'text');
  assert.equal(input.placeholder, 'Введите код');
  assert.equal(input.autocomplete, 'off');
  assert.equal(fixture.focused, input);

  assert.equal(modal.buttons[0].onClick(), false);
  assert.deepEqual(fixture.toasts, ['Введите код']);
  input.value = ' CF-K8P42 ';
  assert.equal(modal.buttons[0].onClick(), undefined);
  assert.deepEqual(fixture.toasts, ['Введите код', 'Активация кодов пока не подключена']);

  const event = { key: 'Enter', isComposing: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.handlers.keydown(event);
  assert.equal(event.prevented, true);
  assert.equal(fixture.confirmClicks.length, 1);
});

test('Code translations are present for Russian and English', () => {
  for (const lang of ['ru', 'en']) {
    const dict = JSON.parse(fs.readFileSync(path.join(clientDir, 'locales', lang + '.json'), 'utf8'));
    for (const key of ['enter_code', 'code_modal_title', 'code_placeholder', 'code_ok', 'code_empty', 'code_unavailable']) {
      assert.equal(typeof dict.menu[key], 'string');
      assert.ok(dict.menu[key].length);
    }
  }
});

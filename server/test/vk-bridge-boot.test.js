'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const client = join(__dirname, '../../client');
const bootstrap = readFileSync(join(client, 'vk-mini-bootstrap.js'), 'utf8');

function simulate(search, { failPrimary = false, existingBridge = false, inVK = true } = {}) {
  const scripts = [];
  const methods = [];
  const host = { send(method) { methods.push(method); return Promise.resolve({}); } };
  const win = { location: { search, hash: '' } };
  win.self = {};
  win.top = inVK ? {} : win.self;
  if (existingBridge) win.vkBridge = host;

  const doc = {
    referrer: inVK ? 'https://vk.com/feed' : '',
    createElement() { return { remove() {} }; },
    head: {
      appendChild(script) {
        scripts.push(script.src);
        queueMicrotask(() => {
          if (failPrimary && scripts.length === 1) {
            script.onerror();
            return;
          }
          win.vkBridge = host;
          script.onload();
        });
      }
    }
  };
  vm.runInNewContext(bootstrap, {
    window: win,
    document: doc,
    navigator: { userAgent: '' },
    URL, URLSearchParams, Promise, setTimeout, clearTimeout,
    console: { error() {}, warn() {} }
  });
  return { win, scripts, methods };
}

test('VK Mini App initializes early and exactly once', async () => {
  const app = simulate('?vk_app_id=54838920&vk_user_id=123&sign=dummy');
  assert.equal(app.win.isVKMiniApp, true);
  assert.ok(app.win.ECHOVKBridgeReady);
  assert.equal(app.scripts.length, 1);
  await app.win.ECHOVKBridgeReady;
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('VK Mini App tries alternate CDN when the first script fails', async () => {
  const app = simulate('?vk_app_id=54838920', { failPrimary: true });
  await app.win.ECHOVKBridgeReady;
  assert.equal(app.scripts.length, 2);
  assert.match(app.scripts[0], /unpkg.com/);
  assert.match(app.scripts[1], /jsdelivr.net/);
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('existing bridge avoids a redundant download or initialization', async () => {
  const app = simulate('?vk_app_id=54838920', { existingBridge: true });
  await app.win.ECHOVKBridgeReady;
  assert.equal(app.scripts.length, 0);
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('regular browser launch does not initialize VK Bridge', () => {
  const app = simulate('', { inVK: false });
  assert.equal(app.win.isVKMiniApp, false);
  assert.equal(app.win.ECHOVKBridgeReady, undefined);
  assert.equal(app.scripts.length, 0);
});

test('bootstrap loads before ESM imports and auth reuses its initialization', () => {
  const html = readFileSync(join(client, 'index.html'), 'utf8');
  const auth = readFileSync(join(client, 'auth-ui.js'), 'utf8');
  const bootPosition = html.indexOf('src="./vk-mini-bootstrap.js');
  assert.ok(bootPosition > 0);
  assert.ok(bootPosition < html.indexOf('<script type="importmap">'));
  assert.ok(auth.includes('await window.ECHOVKBridgeReady'));
  assert.ok(!auth.includes("bridge.send('VKWebAppInit')"));
});

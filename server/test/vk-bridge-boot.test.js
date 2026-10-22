'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const client = join(__dirname, '../../client');
const bootstrap = readFileSync(join(client, 'vk-mini-bootstrap.js'), 'utf8');

function simulate(search, { failures = 0, existingBridge = false, inVK = true } = {}) {
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
          if (scripts.length <= failures) {
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
    console: { error() {}, warn() {}, info() {} }
  });
  return { win, scripts, methods };
}

test('VK Mini App loads local Bridge first and initializes exactly once', async () => {
  const app = simulate('?vk_app_id=54838920&vk_user_id=123&sign=dummy');
  assert.equal(app.win.isVKMiniApp, true);
  assert.ok(app.win.ECHOVKBridgeReady);
  assert.deepEqual(app.scripts, ['./vendor/vk-bridge-2.15.12.min.js']);
  await app.win.ECHOVKBridgeReady;
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('if local Bridge fails, VK Mini App uses pinned unpkg version', async () => {
  const app = simulate('?vk_app_id=54838920', { failures: 1 });
  await app.win.ECHOVKBridgeReady;
  assert.equal(app.scripts.length, 2);
  assert.match(app.scripts[0], /vk-bridge-2\.15\.12\.min\.js/);
  assert.match(app.scripts[1], /unpkg\.com.*@2\.15\.12/);
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('if local and unpkg fail, use pinned jsDelivr', async () => {
  const app = simulate('?vk_app_id=54838920', { failures: 2 });
  await app.win.ECHOVKBridgeReady;
  assert.equal(app.scripts.length, 3);
  assert.match(app.scripts[2], /jsdelivr\.net.*@2\.15\.12/);
  assert.deepEqual(app.methods, ['VKWebAppInit']);
});

test('existing bridge avoids redundant downloads or initialization', async () => {
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

test('bootstrap runs before game modules and auth reuses one init', () => {
  const html = readFileSync(join(client, 'index.html'), 'utf8');
  const auth = readFileSync(join(client, 'auth-ui.js'), 'utf8');
  const bootPosition = html.indexOf('src="./vk-mini-bootstrap.js');
  assert.ok(bootPosition > 0);
  assert.ok(bootPosition < html.indexOf('<script type="importmap">'));
  assert.ok(auth.includes('await window.ECHOVKBridgeReady'));
  assert.ok(!auth.includes("bridge.send('VKWebAppInit')"));
});

test('deploy installs pinned local bridge asset', () => {
  const workflow = readFileSync(join(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');
  const installer = readFileSync(join(__dirname, '../../scripts/install-vk-bridge.sh'), 'utf8');
  assert.match(workflow, /scripts\/install-vk-bridge\.sh/);
  assert.match(installer, /@vkontakte\/vk-bridge@2\.15\.12/);
  assert.match(installer, /client\/vendor\/vk-bridge-2\.15\.12\.min\.js/);
});

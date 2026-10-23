'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const client = join(__dirname, '../../client');
const bootstrap = readFileSync(join(client, 'vk-mini-bootstrap.js'), 'utf8');

function simulate(search, { failures = 0, existingBridge = false, inVK = true, userAgent = '' } = {}) {
  const scripts = [];
  const methods = [];
  const host = { send(method) { methods.push(method); return Promise.resolve({}); } };
  const win = { location: { search, hash: '' } };
  win.self = {};
  win.top = inVK ? {} : win.self;
  if (existingBridge) win.vkBridge = host;

  const classes = new Set();
  const doc = {
    documentElement: { classList: { add(name) { classes.add(name); }, contains(name) { return classes.has(name); } } },
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
    navigator: { userAgent },
    URL, URLSearchParams, Promise, setTimeout, clearTimeout,
    console: { error() {}, warn() {}, info() {} }
  });
  return { win, scripts, methods, classes };
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

test('VK mobile launch hides fullscreen via early document class', async () => {
  for (const platform of ['mobile_android', 'mobile_iphone', 'mobile_ipad', 'mobile_web']) {
    const app = simulate('?vk_app_id=54838920&vk_platform=' + platform);
    assert.equal(app.win.isVKMobileMiniApp, true, platform);
    assert.equal(app.classes.has('echo-vk-mobile-mini'), true, platform);
    await app.win.ECHOVKBridgeReady;
  }
});

test('VK desktop and ordinary browsers keep fullscreen available', async () => {
  const desktop = simulate('?vk_app_id=54838920&vk_platform=desktop_web');
  assert.equal(desktop.win.isVKMobileMiniApp, false);
  assert.equal(desktop.classes.has('echo-vk-mobile-mini'), false);
  await desktop.win.ECHOVKBridgeReady;

  const browser = simulate('', { inVK: false, userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/120' });
  assert.equal(browser.win.isVKMobileMiniApp, false);
  assert.equal(browser.classes.has('echo-vk-mobile-mini'), false);
  assert.equal(browser.scripts.length, 0);
});

test('VK mobile app without platform falls back to phone UA, explicit desktop stays desktop', async () => {
  const fallback = simulate('', { userAgent: 'Mozilla/5.0 (Linux; Android 15) VkAndroidApp' });
  assert.equal(fallback.win.isVKMobileMiniApp, true);
  await fallback.win.ECHOVKBridgeReady;

  const explicitDesktop = simulate('?vk_platform=desktop_web', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' });
  assert.equal(explicitDesktop.win.isVKMobileMiniApp, false);
  await explicitDesktop.win.ECHOVKBridgeReady;
});

test('fullscreen button stays hidden and cannot auto-restore on mobile VK', () => {
  const css = readFileSync(join(client, 'fullscreen.css'), 'utf8');
  const logic = readFileSync(join(client, 'fullscreen.js'), 'utf8');
  const html = readFileSync(join(client, 'index.html'), 'utf8');
  assert.match(css, /html\.echo-vk-mobile-mini #game > #echo-fullscreen-toggle\s*\{\s*display:\s*none\s*!important/);
  assert.match(logic, /const allowFullscreenButton=!window\.isVKMobileMiniApp/);
  assert.match(logic, /if\(allowFullscreenButton\) button\?\.addEventListener/);
  assert.match(logic, /if\(allowFullscreenButton && sessionStorage\.getItem\(preferenceKey\)===/);
  assert.match(html, /vk-mini-bootstrap\.js\?v=echo-vk-mobile-fullscreen-1/);
  assert.match(html, /fullscreen\.css\?v=echo-vk-mobile-fullscreen-1/);
});

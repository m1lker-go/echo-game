'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const client = path.join(__dirname, '../../client');

test('Quest navigation has equally sized Daily and Special tabs below Moscow reset', () => {
  const html = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
  const screen = html.slice(html.indexOf('id="menu-quests-screen"'), html.indexOf('id="menu-shop-screen"'));
  const resetAt = screen.indexOf('id="quests-reset"');
  const tabsAt = screen.indexOf('id="quests-tabs"');
  const dailyAt = screen.indexOf('id="quests-tab-daily"');
  const specialAt = screen.indexOf('id="quests-tab-special"');
  assert.ok(resetAt >= 0 && resetAt < tabsAt && tabsAt < dailyAt && dailyAt < specialAt);
  assert.ok(!screen.includes('Выполняй задания каждый день'));
  assert.ok(screen.includes('id="quests-special-list"'));
  assert.match(html,/special-quests\.js\?v=/);
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  assert.match(css,/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test('Daily quest HUD code and API remain unchanged', () => {
  const source=fs.readFileSync(path.join(client,'daily-quests.js'),'utf8');
  assert.match(source,/\/api\/daily-quests\/claim/);
  assert.match(source,/echo-quest-hud/);
  const special=fs.readFileSync(path.join(client,'special-quests.js'),'utf8');
  assert.match(special,/\/api\/special-quests\/check/);
  assert.match(special,/echo\.specialCopied/);
  assert.match(special,/special_go/);
});

test('Special quest uses the existing Cat Fighting image and black-white styling', () => {
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  const js = fs.readFileSync(path.join(client, 'special-quests.js'), 'utf8');
  const html = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
  // Same responsive width restriction as daily quests (100dvh and 650px).
  assert.match(css, /\.echo-quests-tabs\s*\{[^}]*width:\s*min\(100%,\s*100dvh,\s*650px\)/s);
  assert.match(css, /\.echo-special-list\s*\{[^}]*width:\s*min\(100%,\s*100dvh,\s*650px\)/s);
  assert.match(css, /\.echo-quests-tab\.is-active\s*\{[^}]*background:\s*#fff/s);
  assert.match(css, /\.echo-special-logo-image\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(js, /assets\/icons\/icon_cf\.webp/);
  assert.doesNotMatch(js, /'echo-special-logo', 'CF'/);
  assert.match(html, /special-quests\.css\?v=6/);
  assert.match(html, /special-quests\.js\?v=6/);
});

test('Special quest has a permanent icon-only visit link, code/copy row, and no extra hints', () => {
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  const js = fs.readFileSync(path.join(client, 'special-quests.js'), 'utf8');
  assert.match(js, /head\.append\(logo, heading, link\)/);
  assert.match(js, /codeRow\.append\(code, copyButton\)/);
  assert.match(js, /copyButton\.setAttribute\('aria-label'/);
  assert.match(js, /link\.setAttribute\('aria-label'/);
  assert.doesNotMatch(js, /special_copy_first/);
  assert.doesNotMatch(js, /special_expires/);
  assert.match(css, /\.echo-special-code-row\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.echo-special-copy\s*\{[^}]*border-left:\s*1px solid #fff/s);
});


test('Main menu buttons follow requested order', () => {
  const html = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
  const opening = html.match(/<div id="menu-main"[\s\S]*?<div class="menu-buttons">([\s\S]*?)<\/div>/);
  assert.ok(opening, 'Main menu buttons exist');
  const order = [...opening[1].matchAll(/id="(menu-(?:start|character-button|shop|quests|settings))"/g)]
    .map(match => match[1]);
  assert.deepEqual(order, [
    'menu-start', 'menu-character-button', 'menu-shop', 'menu-quests', 'menu-settings'
  ]);
});

test('Special quest visit button uses black background and white icon/border', () => {
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  const visit = css.match(/\.echo-special-visit\s*\{([^}]*)\}/);
  assert.ok(visit, 'Visit button rule exists');
  assert.match(visit[1], /border:\s*1px solid #fff/);
  assert.match(visit[1], /background:\s*#000/);
  assert.match(visit[1], /color:\s*#fff/);
});

test('Quest screen maintains fixed, symmetrical scrollbar gutters across tabs', () => {
  const css = fs.readFileSync(path.join(client, 'landscape-menu-layout.css'), 'utf8');
  assert.match(css, /\.echo-quests-screen\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable both-edges;/s);
  const html = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
  assert.match(html, /landscape-menu-layout\.css\?v=echo-quests-scrollbar-gutter-2/);
});


test('Special Cat Fighting mission shows a premium pack reward and daily-style toast', () => {
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  const js = fs.readFileSync(path.join(client, 'special-quests.js'), 'utf8');
  const daily = fs.readFileSync(path.join(client, 'daily-quests.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../special-quests.js'), 'utf8');
  assert.match(js, /assets\/packs\/icon_echocard_special\.webp/);
  assert.match(js, /echo-special-reward-label/);
  assert.match(js, /echo-special-reward-quantity/);
  assert.match(js, /echo-quest-reward-toast/);
  assert.match(daily, /echo-quest-reward-toast/);
  assert.match(js, /echo:shop-balance-refresh/);
  assert.doesNotMatch(js, /quest\.rewardCoins/);
  assert.match(css, /\.echo-special-reward-icon\s*\{/);
  assert.match(server, /await grantPack\(accountId,\s*'premium',\s*1,\s*client\)/);
  assert.doesNotMatch(server, /INSERT INTO echo_wallets/);
});


test('Special quest check shares reward row and instruction follows smaller code', () => {
  const js = fs.readFileSync(path.join(client, 'special-quests.js'), 'utf8');
  const css = fs.readFileSync(path.join(client, 'special-quests.css'), 'utf8');
  const ru = JSON.parse(fs.readFileSync(path.join(client, 'locales/ru.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(client, 'locales/en.json'), 'utf8'));
  assert.match(js, /if \(canCheck\) rewardLine\.append\(action\(t\('special_check'/);
  assert.doesNotMatch(js, /article\.append\(action\(t\('special_check'/);
  const code = js.indexOf('article.append(codeRow)');
  const instruction = js.indexOf("article.append(node('p', 'echo-special-instruction'");
  assert.ok(code >= 0 && instruction > code, 'Instruction is below the code row');
  assert.match(css, /\.echo-special-reward\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.echo-special-reward \.echo-special-check\s*\{[^}]*margin:\s*0 0 0 auto/s);
  assert.match(css, /\.echo-special-code\s*\{[^}]*font-size:\s*clamp\(12px,\s*2\.8vw,\s*20px\)/s);
  assert.equal(ru.menu.special_instruction, 'Введи код в настройках Cat Fighting');
  assert.equal(en.menu.special_instruction, 'Enter the code in Cat Fighting settings');
});


test('VK Mini App opens the separate Cat Fighting application, browser opens the website', () => {
  const js = fs.readFileSync(path.join(client, 'special-quests.js'), 'utf8');
  const ru = JSON.parse(fs.readFileSync(path.join(client, 'locales/ru.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(client, 'locales/en.json'), 'utf8'));
  assert.match(js, /CAT_FIGHT_VK_APP_ID = 54671077/);
  assert.match(js, /VKWebAppOpenApp', \{ app_id: CAT_FIGHT_VK_APP_ID \}/);
  assert.match(js, /window\.isVKMiniApp \? CAT_FIGHT_VK_URL : safeLink\(\)/);
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(js, /window\.ECHOVKBridgeReady/);
  assert.match(js, /link\.target = '_blank'/);
  assert.ok(ru.menu.special_open_failed);
  assert.ok(en.menu.special_open_failed);
});

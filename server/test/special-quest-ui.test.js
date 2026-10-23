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
  assert.match(html, /special-quests\.css\?v=2/);
  assert.match(html, /special-quests\.js\?v=2/);
});

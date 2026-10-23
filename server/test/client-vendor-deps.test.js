'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '../..');
const file = path => readFileSync(join(root, path), 'utf8');

test('ECHO menu scripts do not depend on third-party CDNs', () => {
  const html = file('client/index.html');
  assert.match(html, /"three":"\.\/vendor\/three\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/":"\.\/vendor\/three\/examples\/jsm\/"/);
  assert.match(html, /src="\.\/vendor\/socket\.io-4\.8\.1\.min\.js"/);
  assert.match(html, /href="\.\/vendor\/fontawesome\/css\/all\.min\.css"/);
  assert.doesNotMatch(html, /cdn\.socket\.io|cdn\.jsdelivr\.net\/npm\/three|cdnjs\.cloudflare\.com/);
  assert.match(file('client/game.js'), /from 'three\/addons\/utils\/SkeletonUtils\.js'/);
  assert.doesNotMatch(file('client/game.js'), /https:\/\/cdn\.jsdelivr\.net\/npm\/three/);
  assert.match(file('client/menu.js'), /\[echo menu\] Main menu click handlers ready/);
});

test('Both VPS deploy attempts install the pinned browser assets', () => {
  const workflow = file('.github/workflows/deploy.yml');
  const script = file('scripts/install-client-deps.sh');
  assert.equal(workflow.split('timeout 180s bash scripts/install-client-deps.sh').length - 1, 2);
  assert.match(script, /three@0\.180\.0/);
  assert.match(script, /socket\.io@4\.8\.1/);
  assert.match(script, /@fortawesome\/fontawesome-free@6\.7\.2/);
  assert.match(script, /node --check/);
});

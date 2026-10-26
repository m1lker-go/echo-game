'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Web and Android VK ID tokens are verified using separate configured client IDs', () => {
  const auth = source('auth.js');
  const example = source('.env.example');
  assert.match(auth, /const APP_ID = String\(process\.env\.VK_ID_APP_ID/);
  assert.match(auth, /const ANDROID_APP_ID = String\(process\.env\.ECHO_VK_ANDROID_APP_ID/);
  assert.match(auth, /router\.post\('\/vk', vkLoginHandler\(APP_ID\)\)/);
  assert.match(auth, /router\.post\('\/vk\/android', vkLoginHandler\(ANDROID_APP_ID\)\)/);
  assert.match(auth, /user_info\?client_id=' \+ encodeURIComponent\(appId\)/);
  assert.match(example, /^VK_ID_APP_ID=54832804$/m);
  assert.match(example, /^ECHO_VK_ANDROID_APP_ID=54853387$/m);
});

test('APK uses the Android-only VK ID token exchange endpoint when Android sources are present', () => {
  const androidFile = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'ru', 'echo', 'game', 'EchoAuthSession.kt');
  if (!fs.existsSync(androidFile)) return;
  const code = fs.readFileSync(androidFile, 'utf8');
  assert.match(code, /request\("POST", "vk\/android", body\)/);
});

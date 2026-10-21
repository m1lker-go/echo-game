'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { verifyVKMiniAppLaunch } = require('../vk-launch');

const secret = 'test-protected-key-not-a-real-secret';
const appId = '54838920';
function signedLaunch(extra = {}) {
  const data = {
    vk_app_id: appId, vk_user_id: '12345', vk_platform: 'mobile_web',
    vk_language: 'ru', vk_access_token_settings: 'friends,wall', ...extra,
  };
  const query = Object.keys(data).sort()
    .map(key => key + '=' + encodeURIComponent(data[key])).join('&');
  return { ...data, sign: crypto.createHmac('sha256', secret).update(query).digest('base64url') };
}

test('accepts a properly signed VK Mini App launch', () => {
  assert.equal(verifyVKMiniAppLaunch(signedLaunch(), secret, appId), true);
});
test('rejects changed user, app ID, and signed parameters', () => {
  const signed = signedLaunch();
  assert.equal(verifyVKMiniAppLaunch({ ...signed, vk_user_id: '99999' }, secret, appId), false);
  assert.equal(verifyVKMiniAppLaunch(signed, secret, '99999'), false);
  assert.equal(verifyVKMiniAppLaunch({ ...signed, vk_language: 'en' }, secret, appId), false);
});
test('rejects missing secret, missing or forged signature, invalid input', () => {
  const signed = signedLaunch();
  assert.equal(verifyVKMiniAppLaunch(signed, '', appId), false);
  assert.equal(verifyVKMiniAppLaunch({ ...signed, sign: 'X'.repeat(43) }, secret, appId), false);
  assert.equal(verifyVKMiniAppLaunch({ ...signed, sign: undefined }, secret, appId), false);
  assert.equal(verifyVKMiniAppLaunch({ ...signed, vk_user_id: '1 OR 1=1' }, secret, appId), false);
  assert.equal(verifyVKMiniAppLaunch(null, secret, appId), false);
});
test('supports empty and URL-escaped launch values', () => {
  const signed = signedLaunch({ vk_access_token_settings: '', vk_ref: 'group name + invite' });
  assert.equal(verifyVKMiniAppLaunch(signed, secret, appId), true);
});

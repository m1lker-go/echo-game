'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { verifyNotification, PREMIUM_PRICE } = require('../vk-payments');

const secret = 'this-is-a-fake-protected-test-key';
const appId = '54838920';
function signedNotification(fields = {}) {
  const data = {
    notification_type: 'get_item_test',
    app_id: appId,
    user_id: '12345',
    item: 'echo_premium_pack_' + 'a'.repeat(32),
    ...fields,
  };
  const signed = Object.keys(data).sort().map(k => k + '=' + data[k]).join('');
  return { ...data, sig: crypto.createHash('md5').update(signed + secret).digest('hex') };
}

test('VK callback signature accepts an authentic get_item notification', () => {
  assert.equal(verifyNotification(signedNotification(), appId, secret), true);
});
test('VK callback signature accepts valid chargeable notification', () => {
  assert.equal(verifyNotification(signedNotification({
    notification_type: 'order_status_change',
    order_id: '9876', status: 'chargeable', item_id: '1', item_price: 40,
  }), appId, secret), true);
});
test('VK callback rejects other app IDs and modified callback fields', () => {
  const data = signedNotification();
  assert.equal(verifyNotification(data, '54832804', secret), false);
  assert.equal(verifyNotification({ ...data, user_id: '56789' }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, item_price: 1 }, appId, secret), false);
  assert.equal(verifyNotification(data, appId, 'wrong-secret'), false);
});
test('VK callback rejects missing or forged signatures and nonscalar data', () => {
  const data = signedNotification();
  assert.equal(verifyNotification({ ...data, sig: '' }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, sig: 'f'.repeat(32) }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, sig: undefined }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, user_id: { id: '12345' } }, appId, secret), false);
  assert.equal(verifyNotification(null, appId, secret), false);
});
test('ECHO premium pack is priced at 40 VK votes', () => {
  assert.equal(PREMIUM_PRICE, 40);
});

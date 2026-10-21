'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountSessionRegistry } = require('../account-session-registry');

test('only the first verified account connection can claim the active session', () => {
  const registry=createAccountSessionRegistry();
  assert.equal(registry.claim('account-A','phone'),true);
  assert.equal(registry.activate('phone'),true);
  assert.equal(registry.claim('account-A','browser'),false);
  assert.equal(registry.claim('account-B','browser'),true);
  assert.equal(registry.activate('browser'),true);
  assert.equal(registry.release('browser'),true);
  assert.equal(registry.claim('account-A','tablet'),false);
  assert.equal(registry.release('phone'),true);
  assert.equal(registry.claim('account-A','tablet'),true);
  assert.equal(registry.activate('tablet'),true);
  assert.equal(registry.release('tablet'),true);
});

test('guest connections are unrestricted, and old disconnects cannot release new sessions', () => {
  const registry=createAccountSessionRegistry();
  assert.equal(registry.claim(null,'guest-1'),true);
  assert.equal(registry.claim(null,'guest-2'),true);
  assert.equal(registry.claim('account-A','socket-1'),true);
  assert.equal(registry.activate('socket-1'),true);
  assert.equal(registry.release('socket-1'),true);
  assert.equal(registry.claim('account-A','socket-2'),true);
  assert.equal(registry.release('socket-1'),false);
  assert.equal(registry.claim('account-A','socket-3'),false);
  assert.equal(registry.activate('socket-2'),true);
  assert.equal(registry.release('socket-2'),true);
});

test('a cancelled handshake expires its reservation without blocking the account', async () => {
  const registry=createAccountSessionRegistry({pendingTimeoutMs:5});
  assert.equal(registry.claim('account-A','abandoned'),true);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(registry.claim('account-A','new-connection'),true);
  assert.equal(registry.activate('new-connection'),true);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(registry.claim('account-A','duplicate'),false);
  assert.equal(registry.release('new-connection'),true);
});

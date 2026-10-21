'use strict';

// One live Socket.IO connection per verified ECHO account (across VK/web).
// Reserve during the authenticated handshake to prevent simultaneous joins.
function createAccountSessionRegistry({ pendingTimeoutMs = 15000 } = {}) {
  const owners = new Map();
  const sockets = new Map();

  function release(socketId) {
    const entry = sockets.get(socketId);
    if (!entry) return false;
    sockets.delete(socketId);
    if (entry.timer) clearTimeout(entry.timer);
    if (owners.get(entry.accountId) === socketId) owners.delete(entry.accountId);
    return true;
  }

  function claim(accountId, socketId) {
    if (!accountId || !socketId) return true; // Guests are not account-locked.
    const previous = owners.get(accountId);
    if (previous && previous !== socketId) return false;
    if (previous === socketId) return true;
    // If a handshake is abandoned before the Socket.IO connection event,
    // release the pending reservation rather than locking out this account.
    const timer = setTimeout(() => {
      if (!sockets.get(socketId)?.active) release(socketId);
    }, pendingTimeoutMs);
    timer.unref?.();
    owners.set(accountId, socketId);
    sockets.set(socketId, { accountId, timer, active: false });
    return true;
  }

  function activate(socketId) {
    const entry = sockets.get(socketId);
    if (!entry) return false;
    entry.active = true;
    clearTimeout(entry.timer);
    entry.timer = null;
    return true;
  }

  return { claim, activate, release };
}

module.exports = { createAccountSessionRegistry };

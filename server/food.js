'use strict';

function createFoodPoint(id, {
  isValidFoodPosition,
  maxAttempts = 5000,
  createCandidate,
} = {}) {
  if (typeof isValidFoodPosition !== 'function') {
    throw new TypeError('createFoodPoint requires the server world-position validator');
  }
  if (typeof createCandidate !== 'function') {
    throw new TypeError('createFoodPoint requires the server candidate factory');
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const point = createCandidate(id);
    if (isValidFoodPosition(point)) return point;
  }
  throw new Error(`Unable to place food point ${id} in a valid world position after ${maxAttempts} attempts`);
}

function collectFood(player, food, {
  radius = 60,
  now = Date.now(),
  random = Math.random,
  respawnMinMs = 10_000,
  respawnMaxMs = 25_000,
} = {}) {
  let collected = 0;
  for (const point of food.values()) {
    if (!point.active) continue;
    if (Math.hypot(player.x - point.x, player.y - point.y) > radius) continue;
    point.active = false;
    point.respawnAt = now + respawnMinMs
      + Math.floor(random() * (respawnMaxMs - respawnMinMs + 1));
    collected += 1;
  }
  return collected;
}

function refillFood(food, { now = Date.now(), createFoodPoint }) {
  if (typeof createFoodPoint !== 'function') throw new TypeError('refillFood requires a server point generator');
  let changed = false;
  for (const point of food.values()) {
    if (point.active || !point.respawnAt || point.respawnAt > now) continue;
    const replacement = createFoodPoint(point.id);
    point.x = replacement.x;
    point.y = replacement.y;
    point.size = replacement.size;
    point.pulse = replacement.pulse;
    point.active = replacement.active;
    point.respawnAt = replacement.respawnAt;
    changed = true;
  }
  return changed;
}

function createFoodSnapshot(food) {
  return Array.from(food.values())
    .filter((point) => point.active)
    .map(({ id, x, y, size, pulse }) => ({ id, x, y, size, pulse }));
}

module.exports = { createFoodPoint, collectFood, refillFood, createFoodSnapshot };

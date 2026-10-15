'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFoodPoint, collectFood, refillFood, createFoodSnapshot } = require('../food');

function sequenceRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('food placement only accepts a position passed by the server validator', () => {
  const point = createFoodPoint(7, {
    isValidFoodPosition: (candidate) => candidate.x === 10 && candidate.y === 10,
    random: sequenceRandom([0.5, 0.5, 0.5, 0.5]),
    worldHalfSize: 100,
    maxAttempts: 5,
  });
  assert.deepEqual({ x: point.x, y: point.y }, { x: 10, y: 10 });
  assert.equal(point.id, 7);
  assert.equal(point.active, true);
});

test('food placement fails closed when no valid position exists', () => {
  assert.throws(() => createFoodPoint(19, {
    isValidFoodPosition: () => false,
    random: () => 0.5,
    worldHalfSize: 100,
    maxAttempts: 3,
  }), /Unable to place food point 19/);
});

test('one active food point can be collected only once', () => {
  const points = new Map([
    [1, { id: 1, x: 0, y: 0, active: true, respawnAt: 0 }],
    [2, { id: 2, x: 500, y: 500, active: true, respawnAt: 0 }],
    [3, { id: 3, x: 5, y: 0, active: false, respawnAt: 0 }],
  ]);
  const player = { x: 0, y: 0 };
  const options = { radius: 60, now: 1000, random: () => 0, respawnMinMs: 10_000, respawnMaxMs: 25_000 };
  assert.equal(collectFood(player, points, options), 1);
  assert.equal(points.get(1).active, false);
  assert.equal(points.get(1).respawnAt, 11_000);
  assert.equal(collectFood(player, points, { ...options, now: 2000 }), 0);
});

test('refillFood respawns only points whose server-owned deadline elapsed', () => {
  const points = new Map([
    [1, { id: 1, x: 0, y: 0, active: false, respawnAt: 2000 }],
    [2, { id: 2, x: 0, y: 0, active: false, respawnAt: 5000 }],
    [3, { id: 3, x: 1, y: 1, active: true, respawnAt: 0 }],
  ]);
  let generated = 0;
  const changed = refillFood(points, {
    now: 2000,
    createFoodPoint(id) {
      generated += 1;
      return { id, x: id * 10, y: id * 20, active: true, respawnAt: 0 };
    },
  });
  assert.equal(changed, true);
  assert.equal(generated, 1);
  assert.deepEqual(points.get(1), { id: 1, x: 10, y: 20, active: true, respawnAt: 0 });
  assert.equal(points.get(2).active, false);
  assert.equal(points.get(3).x, 1);
});

test('server snapshot exposes only active food display data', () => {
  const snapshot = createFoodSnapshot(new Map([
    [1, { id: 1, x: 10, y: 20, size: 5, pulse: 0, active: true, respawnAt: 0 }],
    [2, { id: 2, x: 30, y: 40, size: 6, pulse: 1, active: false, respawnAt: 9999 }],
  ]));
  assert.deepEqual(snapshot, [{ id: 1, x: 10, y: 20, size: 5, pulse: 0 }]);
});

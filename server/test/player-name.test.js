const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerName } = require('../player-name');

test('names are trimmed, sanitized and limited to 24 codepoints', () => {
  assert.equal(normalizePlayerName('   Игрок 12345  '), 'Игрок 12345');
  assert.equal(normalizePlayerName('  Alice   Bob  '), 'Alice Bob');
  assert.equal(normalizePlayerName('Bad<svg>Name'), 'BadsvgName');
  assert.equal(normalizePlayerName('x'.repeat(80)).length, 24);
  assert.equal(normalizePlayerName('А😀Б'), 'А😀Б');
});

test('unnamed guests get a stable public nickname', () => {
  const name = normalizePlayerName(null, 'socket-abc');
  assert.match(name, /^Игрок \d{5}$/);
  assert.equal(name, normalizePlayerName('', 'socket-abc'));
  assert.notEqual(name, normalizePlayerName('', 'socket-xyz'));
});

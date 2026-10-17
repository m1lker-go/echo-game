const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerName, guestName } = require('../player-name');

test('guest names use one of the allowed names and a five-digit suffix', () => {
  const name = normalizePlayerName(null, 'profile-abc');
  assert.match(name, /^(Tom|Bob|John|Terry|Carry|Berry|Max|Jack|Leo|Alex|Sam|Nick|Mike|Finn|Rick|Ben|Mia|Luna|Kate|Anna|Eva|Ruby|Lily|Nora|Oscar|Oliver|Harry|Molly|Grace|Daisy|Tony|Robin)_\d{5}$/);
  assert.equal(name, guestName('profile-abc'));
});

test('same guest profile keeps its name between sessions', () => {
  assert.equal(normalizePlayerName(null, 'profile-abc'), normalizePlayerName(null, 'profile-abc'));
  assert.notEqual(normalizePlayerName(null, 'profile-abc'), normalizePlayerName(null, 'profile-xyz'));
});

test('guest cannot override their server-generated name', () => {
  const id = 'profile-abc';
  assert.equal(normalizePlayerName('Admin', id), normalizePlayerName(null, id));
  assert.equal(normalizePlayerName(' Bad<svg>Name ', id), normalizePlayerName(null, id));
});

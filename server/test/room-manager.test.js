'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundWindow, createRoomManager } = require('../room-manager');

test('all rooms use the same aligned 15-minute server round', () => {
  assert.deepEqual(roundWindow(16 * 60 * 1000), { id: '900000', startsAt: 900000, endsAt: 1800000 });
});

test('new players move to the next room after 50 occupied slots', () => {
  let time = 900001;
  const rooms = createRoomManager({ now: () => time });
  for (let i = 0; i < 50; i++) assert.equal(rooms.join('p' + i).roomId, 1);
  assert.equal(rooms.join('p50').roomId, 2);
  assert.deepEqual(rooms.snapshot().rooms.map(x => x.occupied), [50, 1]);
});

test('returning player can use slot 51 while newcomers join another room', () => {
  let time = 900001;
  const rooms = createRoomManager({ now: () => time });
  rooms.join('old');
  rooms.leaveImmediately('old');
  for (let i = 0; i < 50; i++) rooms.join('new' + i);
  assert.equal(rooms.join('old').roomId, 1);
  assert.equal(rooms.snapshot().rooms[0].occupied, 51);
  assert.equal(rooms.join('stranger').roomId, 2);
});

test('absence keeps a slot for 60 seconds and preserves room association afterward', () => {
  let time = 900001;
  const rooms = createRoomManager({ now: () => time });
  rooms.join('old');
  rooms.markAbsent('old');
  time += 59999;
  assert.equal(rooms.snapshot().rooms[0].occupied, 1);
  time += 1;
  assert.equal(rooms.snapshot().rooms[0].occupied, 0);
  assert.equal(rooms.snapshot().rooms[0].uniqueParticipants, 1);
  assert.equal(rooms.join('old').roomId, 1);
});

test('the 61st simultaneous returning player is rejected without losing their association', () => {
  let time = 900001;
  const rooms = createRoomManager({ now: () => time });
  for (let i = 0; i < 11; i++) { rooms.join('old' + i); rooms.leaveImmediately('old' + i); }
  for (let i = 0; i < 60; i++) {
    const id = i < 11 ? 'old' + i : 'new' + i;
    const res = rooms.join(id);
    assert.equal(res.status, 'joined');
  }
  // Room 1 contains 60 returning/active players.
  assert.equal(rooms.join('old0').status, 'joined'); // already occupies its slot
  // Create another prior member whose slot has been vacated.
  // At full capacity, any returnee with no slot must wait.
  rooms.leaveImmediately('old0');
  rooms.join('other');
  assert.equal(rooms.join('old0').status, 'room-full');
});

test('new synchronized round clears slots and assigns a fresh room', () => {
  let time = 900001;
  const rooms = createRoomManager({ now: () => time });
  rooms.join('one');
  time = 1800001;
  assert.deepEqual(rooms.snapshot().rooms, []);
  const next = rooms.join('one');
  assert.equal(next.roomId, 1);
  assert.equal(next.round.startsAt, 1800000);
});

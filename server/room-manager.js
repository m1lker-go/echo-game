'use strict';

// Pure round/room allocation primitives. Not wired into live Socket.IO yet.
const ROUND_MS = 15 * 60 * 1000;
const ABSENCE_GRACE_MS = 60 * 1000;
const STANDARD_CAPACITY = 50;
const RETURN_CAPACITY = 60;

function roundWindow(now = Date.now()) {
  if (!Number.isFinite(now)) throw new TypeError('Invalid server time');
  const startsAt = Math.floor(now / ROUND_MS) * ROUND_MS;
  return { id: String(startsAt), startsAt, endsAt: startsAt + ROUND_MS };
}

function createRoomManager({ now = () => Date.now() } = {}) {
  const rooms = new Map();
  const previousRoomByPlayer = new Map();
  let nextRoomId = 1;
  let activeRoundId = roundWindow(now()).id;

  function resetForNewRound(time) {
    const window = roundWindow(time);
    if (window.id !== activeRoundId) {
      rooms.clear();
      previousRoomByPlayer.clear();
      nextRoomId = 1;
      activeRoundId = window.id;
    }
    return window;
  }

  function expireAbsences(time) {
    for (const room of rooms.values()) {
      for (const [playerId, slot] of room.slots) {
        if (slot.absentSince !== null && time - slot.absentSince >= ABSENCE_GRACE_MS) {
          room.slots.delete(playerId);
        }
      }
    }
  }

  function synchronize() {
    const time = now();
    const round = resetForNewRound(time);
    expireAbsences(time);
    return round;
  }

  function join(playerId) {
    if (typeof playerId !== 'string' || playerId.length === 0) throw new TypeError('Missing player ID');
    const round = synchronize();
    const previousRoomId = previousRoomByPlayer.get(playerId);
    let room = previousRoomId === undefined ? null : rooms.get(previousRoomId);

    if (room && !room.slots.has(playerId) && room.slots.size >= RETURN_CAPACITY) {
      return { status: 'room-full', roomId: room.id, round };
    }

    if (!room) {
      room = [...rooms.values()].find(candidate => candidate.slots.size < STANDARD_CAPACITY);
      if (!room) {
        room = { id: nextRoomId++, slots: new Map(), participants: new Set() };
        rooms.set(room.id, room);
      }
    }

    room.slots.set(playerId, { absentSince: null });
    room.participants.add(playerId);
    previousRoomByPlayer.set(playerId, room.id);
    return { status: 'joined', roomId: room.id, round, occupancy: room.slots.size, returning: previousRoomId !== undefined };
  }

  function markAbsent(playerId) {
    synchronize();
    const roomId = previousRoomByPlayer.get(playerId);
    const slot = rooms.get(roomId)?.slots.get(playerId);
    if (!slot) return false;
    if (slot.absentSince === null) slot.absentSince = now();
    return true;
  }

  function leaveImmediately(playerId) {
    synchronize();
    const roomId = previousRoomByPlayer.get(playerId);
    return rooms.get(roomId)?.slots.delete(playerId) || false;
  }

  function snapshot() {
    const round = synchronize();
    return { round, rooms: [...rooms.values()].map(room => ({
      id: room.id,
      occupied: room.slots.size,
      active: [...room.slots.values()].filter(slot => slot.absentSince === null).length,
      uniqueParticipants: room.participants.size,
    })) };
  }

  return { join, markAbsent, leaveImmediately, snapshot, synchronize };
}

module.exports = { ROUND_MS, ABSENCE_GRACE_MS, STANDARD_CAPACITY, RETURN_CAPACITY, roundWindow, createRoomManager };

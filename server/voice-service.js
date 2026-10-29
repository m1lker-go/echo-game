'use strict';

// The game server is authoritative for voice room membership and identities.
// LiveKit credentials never leave the VPS. Disabled unless fully configured.
const { roundWindow } = require('./room-manager');

// LiveKit's protobuf TrackSource.MICROPHONE enum is 2.
// The browser SDK uses the string 'microphone', but the server JWT SDK requires the numeric enum.
const MICROPHONE_TRACK_SOURCE = 2;

function createVoiceService({ env = process.env, sdk = null, nodeMajor = Number(process.versions.node.split('.')[0]) } = {}) {
  const publicUrl = String(env.ECHO_LIVEKIT_URL || '').trim();
  const apiKey = String(env.ECHO_LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env.ECHO_LIVEKIT_API_SECRET || '').trim();
  const enabled = /^wss:\/\/[^/\s]+\/?$/.test(publicUrl) && apiKey.length >= 6 && apiSecret.length >= 32;
  if (!enabled) return { enabled: false, createJoin: async () => null, remove: async () => {} };

  // The current LiveKit server SDK requires Node >=19. Do not jeopardize ECHO
  // on legacy Node (production was Node 18 at integration time).
  if (nodeMajor < 20) {
    console.warn('[echo-voice] Disabled: Node.js 20+ is required for voice');
    return { enabled: false, createJoin: async () => null, remove: async () => {} };
  }
  let AccessToken, RoomServiceClient, roomService;
  try {
    // Lazy import: the SDK is not needed to run the normal game without voice.
    ({ AccessToken, RoomServiceClient } = sdk || require('livekit-server-sdk'));
    const apiUrl = String(env.ECHO_LIVEKIT_API_URL || publicUrl.replace(/^wss:/, 'https:')).trim();
    roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret);
  } catch (error) {
    console.warn('[echo-voice] Disabled: LiveKit SDK not ready:', error.message);
    return { enabled: false, createJoin: async () => null, remove: async () => {} };
  }

  function voiceRoom(player) {
    if (!player || !Number.isSafeInteger(Number(player.roomId)) ||
        !/^\d+$/.test(String(player.roundId))) return null;
    return 'echo-voice:' + player.roundId + ':' + player.roomId;
  }

  async function createJoin(player, socketId) {
    const room = voiceRoom(player);
    if (!room || typeof socketId !== 'string' || !socketId || player.id !== socketId ||
        player.defeated || player.roundId !== roundWindow().id) return null;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: socketId,
      name: String(player.name || 'Player').slice(0, 60),
      ttl: 60,
    });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishSources: [MICROPHONE_TRACK_SOURCE],
      canPublishData: false,
      canSubscribe: true
    });
    return {
      url: publicUrl,
      token: await token.toJwt(),
      identity: socketId,
      roomId: player.roomId,
      roundId: player.roundId,
    };
  }

  async function remove(player) {
    const room = voiceRoom(player);
    if (!room || !player?.id) return;
    try { await roomService.removeParticipant(room, player.id); }
    catch (error) {
      // No participant to remove is normal (players need not opt into voice).
      if (!/not found|does not exist|404/i.test(String(error?.message || ''))) {
        console.warn('[echo-voice] could not remove participant:', error.message);
      }
    }
  }

  return { enabled, createJoin, remove };
}

module.exports = { createVoiceService };

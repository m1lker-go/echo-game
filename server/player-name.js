// Public player display name for ECHO. Never broadcast account/profile IDs.
const MAX_PLAYER_NAME_LENGTH = 24;

function normalizePlayerName(value, socketId = '') {
  const cleaned = typeof value === 'string'
    ? value.normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  if (cleaned) return Array.from(cleaned).slice(0, MAX_PLAYER_NAME_LENGTH).join('');

  let hash = 0;
  for (const char of String(socketId)) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return 'Игрок ' + String(hash % 100000).padStart(5, '0');
}

module.exports = { normalizePlayerName, MAX_PLAYER_NAME_LENGTH };

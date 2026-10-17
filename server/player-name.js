// Stable guest display names; profile IDs are never broadcast to other players.
const GUEST_NAMES = ['Tom','Bob','John','Terry','Carry','Berry','Max','Jack','Leo','Alex','Sam','Nick','Mike','Finn','Rick','Ben','Mia','Luna','Kate','Anna','Eva','Ruby','Lily','Nora','Oscar','Oliver','Harry','Molly','Grace','Daisy','Tony','Robin'];
function guestName(profileId) {
  let hash = 0;
  for (const char of String(profileId || '')) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return GUEST_NAMES[hash % GUEST_NAMES.length] + '_' + String((Math.floor(hash / GUEST_NAMES.length) % 90000) + 10000);
}
// Until registered accounts are implemented, player-supplied display names are untrusted.
function normalizePlayerName(_value, profileId = '') {
  return guestName(profileId);
}
module.exports = { normalizePlayerName, guestName };

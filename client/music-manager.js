// ECHO background music: a single sequential playlist for menu and gameplay.
// Sound effects can be added independently later.
const tracks = Array.from({ length: 5 }, (_, index) =>
  `./assets/sounds/music/musicgame${String(index + 1).padStart(3, '0')}.mp3`
);
const STORAGE_KEY = 'echo.music.playback';
const audio = new Audio();
audio.preload = 'auto';
audio.loop = false;
const MUSIC_VOLUME_KEY = 'echo.music.volume';
const SFX_VOLUME_KEY = 'echo.sfx.volume';
function readVolume(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value)) : fallback;
  } catch (_) { return fallback; }
}
let musicVolume = readVolume(MUSIC_VOLUME_KEY, 0.6);
let sfxVolume = readVolume(SFX_VOLUME_KEY, 0.7);
audio.volume = musicVolume;
window.ECHOAudio = Object.freeze({
  getMusicVolume: () => musicVolume,
  getSfxVolume: () => sfxVolume,
  setMusicVolume(value) {
    musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
    audio.volume = musicVolume;
    try { localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume)); } catch (_) {}
  },
  setSfxVolume(value) {
    sfxVolume = Math.max(0, Math.min(1, Number(value) || 0));
    try { localStorage.setItem(SFX_VOLUME_KEY, String(sfxVolume)); } catch (_) {}
  },
});
audio.playsInline = true;

let trackIndex = 0;
let started = false;
let blocked = false;
let failedTracks = 0;

try {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < tracks.length) {
    trackIndex = saved.index;
    if (Number.isFinite(saved.time) && saved.time > 0) {
      audio.addEventListener('loadedmetadata', function restorePosition() {
        audio.removeEventListener('loadedmetadata', restorePosition);
        if (Number.isFinite(audio.duration) && saved.time < audio.duration) {
          audio.currentTime = saved.time;
        }
      });
    }
  }
} catch (_) {
  // Session storage may be unavailable; playback still works normally.
}

function savePosition() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      index: trackIndex,
      time: audio.currentTime || 0,
    }));
  } catch (_) {}
}

function selectTrack(index) {
  trackIndex = index % tracks.length;
  audio.src = tracks[trackIndex];
  audio.load();
  savePosition();
}

function tryPlay() {
  if (started && !audio.paused) return;
  const attempt = audio.play();
  if (attempt?.then) {
    attempt.then(() => {
      started = true;
      blocked = false;
      removeUnlockListeners();
    }).catch((error) => {
      if (error?.name === 'NotAllowedError') {
        blocked = true;
        attachUnlockListeners();
      } else if (error?.name !== 'AbortError') {
        console.warn('[ECHO music] Playback failed:', error);
      }
    });
  }
}

function onInteraction() {
  tryPlay();
}

function attachUnlockListeners() {
  document.addEventListener('pointerdown', onInteraction, { passive: true });
  document.addEventListener('touchstart', onInteraction, { passive: true });
  document.addEventListener('keydown', onInteraction);
}

function removeUnlockListeners() {
  document.removeEventListener('pointerdown', onInteraction);
  document.removeEventListener('touchstart', onInteraction);
  document.removeEventListener('keydown', onInteraction);
}

function advanceTrack() {
  failedTracks = 0;
  selectTrack((trackIndex + 1) % tracks.length);
  tryPlay();
}

audio.addEventListener('ended', advanceTrack);
audio.addEventListener('error', () => {
  console.warn('[ECHO music] Track could not be loaded:', tracks[trackIndex]);
  failedTracks += 1;
  if (failedTracks >= tracks.length) {
    console.error('[ECHO music] No playable tracks found.');
    return;
  }
  selectTrack((trackIndex + 1) % tracks.length);
  tryPlay();
});

window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && blocked) tryPlay();
});

selectTrack(trackIndex);
attachUnlockListeners();
tryPlay();

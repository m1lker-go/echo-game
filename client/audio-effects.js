// ECHO game sound effects. Shares the persistent Effects volume setting.
const files = Object.freeze({
  dash: './assets/sounds/dash.mp3',
  jump: './assets/sounds/jump.mp3',
  water: './assets/sounds/water.mp3',
});
const oneShots = new Set();
const water = new Audio(files.water);
water.preload = 'auto';
water.loop = true;
water.playsInline = true;
let waterRunning = false;

function volume() { return window.ECHOAudio?.getSfxVolume?.() ?? 0.7; }
function syncVolume() {
  water.volume = volume();
  for (const audio of oneShots) audio.volume = volume();
  if (waterRunning && volume() > 0 && water.paused) {
    water.play().catch(() => {});
  } else if (volume() <= 0 && !water.paused) {
    water.pause();
  }
}
export function playGameSound(name) {
  if (!Object.hasOwn(files, name) || name === 'water' || volume() <= 0) return;
  const audio = new Audio(files[name]);
  audio.volume = volume();
  audio.playsInline = true;
  oneShots.add(audio);
  const cleanup = () => oneShots.delete(audio);
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  audio.play().catch(cleanup);
}

function setWaterRunning(active) {
  const next = Boolean(active);
  if (next === waterRunning) return;
  waterRunning = next;
  if (!next) {
    // Stop immediately; replay from the beginning on the next run.
    water.pause();
    water.currentTime = 0;
  } else if (volume() > 0) {
    water.volume = volume();
    water.currentTime = 0;
    water.play().catch(() => {});
  }
}
window.addEventListener('echo:water-running', event => {
  setWaterRunning(event.detail?.running);
});
window.addEventListener('echo:sfx-volume-changed', syncVolume);
window.addEventListener('blur', () => setWaterRunning(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setWaterRunning(false);
});
syncVolume();

// Settings UI for persistent background-music and future sound-effect levels.
const controls = [
  { input: 'echo-music-volume', output: 'echo-music-volume-value', getter: 'getMusicVolume', setter: 'setMusicVolume', key: 'echo.music.volume', fallback: 0.6 },
  { input: 'echo-sfx-volume', output: 'echo-sfx-volume-value', getter: 'getSfxVolume', setter: 'setSfxVolume', key: 'echo.sfx.volume', fallback: 0.7 },
];

for (const control of controls) {
  const input = document.getElementById(control.input);
  const output = document.getElementById(control.output);
  if (!input || !output) continue;
  let value = control.fallback;
  try {
    if (window.ECHOAudio?.[control.getter]) value = window.ECHOAudio[control.getter]();
    else if (localStorage.getItem(control.key) !== null) value = Number(localStorage.getItem(control.key));
  } catch (_) {}
  if (!Number.isFinite(value)) value = control.fallback;
  const sync = (percent) => {
    const amount = Math.max(0, Math.min(100, percent));
    input.value = String(amount);
    output.value = amount + '%';
    input.style.setProperty('--echo-volume-percent', amount + '%');
  };
  sync(Math.round(value * 100));
  input.addEventListener('input', () => {
    const amount = Number(input.value);
    sync(amount);
    window.ECHOAudio?.[control.setter]?.(amount / 100);
  });
}

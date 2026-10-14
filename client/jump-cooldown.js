const jumpButton = document.querySelector('#jump');

const JUMP_COOLDOWN = 5500;
const phases = [
  { value: '4', start: 300, duration: 1000 },
  { value: '3', start: 1600, duration: 1000 },
  { value: '2', start: 2900, duration: 1000 },
  { value: '1', start: 4200, duration: 1000 },
];

let cooldownUntil = 0;

jumpButton?.addEventListener('pointerdown', (event) => {
  const now = performance.now();
  if (now < cooldownUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  cooldownUntil = now + JUMP_COOLDOWN;
  jumpButton.classList.remove('cooldown', 'ready');
  jumpButton.classList.add('active');
  window.setTimeout(() => jumpButton.classList.remove('active'), 700);

  const countdown = document.createElement('span');
  countdown.className = 'ability-cooldown';
  countdown.setAttribute('aria-hidden', 'true');
  jumpButton.appendChild(countdown);
  jumpButton.classList.add('cooldown');

  let lastPhase = -1;

  const updateCountdown = () => {
    const elapsed = performance.now() - now;
    if (elapsed >= JUMP_COOLDOWN) {
      countdown.remove();
      jumpButton.classList.remove('cooldown');
      jumpButton.classList.add('ready');
      window.setTimeout(() => jumpButton.classList.remove('ready'), 450);
      return;
    }

    const phaseIndex = phases.findIndex((phase) =>
      elapsed >= phase.start && elapsed < phase.start + phase.duration
    );

    if (phaseIndex !== lastPhase) {
      lastPhase = phaseIndex;
      countdown.classList.remove('countdown-pop');
      if (phaseIndex >= 0) {
        countdown.textContent = phases[phaseIndex].value;
        countdown.style.animationDuration = `${phases[phaseIndex].duration}ms`;
        void countdown.offsetWidth;
        countdown.classList.add('countdown-pop');
      } else {
        countdown.textContent = '';
      }
    }

    requestAnimationFrame(updateCountdown);
  };

  updateCountdown();
}, { passive: false });

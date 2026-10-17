// One delegated click sound for ECHO UI, including dynamically created modal buttons.
// Gameplay ability buttons have their own dash/jump audio and are excluded.
import { playGameSound } from './audio-effects.js?v=echo-ui-click-1';

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest('button, [role="button"]')
    : null;
  if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
  if (button.closest('#boost, #jump')) return;
  playGameSound('click');
}, { capture: true });

// ECHO settings cache reset. Keeps player profile and selected character intact.
const settingsButton = document.querySelector('#menu-settings');
const ratingButton = document.querySelector('#menu-rating');
const placeholderScreen = document.querySelector('#menu-placeholder');
const placeholderTitle = document.querySelector('#placeholder-title');
const placeholderDescription = document.querySelector('#placeholder-description');
const placeholderBack = document.querySelector('#placeholder-back');

if (settingsButton && placeholderScreen && placeholderTitle) {
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.hidden = true;
  actions.innerHTML = `
    <button id="settings-clear-cache" class="menu-button settings-cache-button" type="button">Очистить кэш игры</button>
    <p class="settings-note">Перезагрузит ECHO и запросит свежие файлы. Профиль и выбранный персонаж сохранятся.</p>
    <p id="settings-cache-status" class="settings-status" role="status" aria-live="polite"></p>
  `;
  if (placeholderBack) placeholderScreen.insertBefore(actions, placeholderBack);

  const clearButton = actions.querySelector('#settings-clear-cache');
  const status = actions.querySelector('#settings-cache-status');

  function hideSettingsControls() {
    actions.hidden = true;
    if (placeholderDescription) placeholderDescription.hidden = false;
    if (status) status.textContent = '';
  }

  settingsButton.addEventListener('click', () => {
    // menu.js opens the shared placeholder screen when Settings is clicked.
    requestAnimationFrame(() => {
      if (placeholderScreen.hidden) return;
      placeholderTitle.textContent = 'НАСТРОЙКИ';
      if (placeholderDescription) placeholderDescription.hidden = true;
      actions.hidden = false;
    });
  });

  ratingButton?.addEventListener('click', hideSettingsControls);
  placeholderBack?.addEventListener('click', hideSettingsControls);

  clearButton?.addEventListener('click', async () => {
    if (clearButton.disabled) return;
    const confirmed = window.confirm('Очистить кэш ECHO и перезагрузить игру? Профиль и выбранный персонаж не будут удалены.');
    if (!confirmed) return;

    clearButton.disabled = true;
    clearButton.textContent = 'Очищаем кэш…';
    if (status) status.textContent = 'Подготавливаем обновление…';

    try {
      // Cache Storage is origin-scoped. Leave localStorage, sessionStorage,
      // cookies and IndexedDB untouched; they may contain player data.
      if ('caches' in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map((name) => window.caches.delete(name)));
      }
    } catch (error) {
      console.warn('[ECHO settings] Could not clear Cache Storage:', error);
      // Still do a versioned reload if Cache API is unavailable or blocked.
    }

    const url = new URL(window.location.href);
    url.searchParams.set('echo-cache-reset', String(Date.now()));
    window.location.replace(url.toString());
  });
}

// ECHO settings cache reset. Keeps player profile and selected character intact.
const settingsActions = document.querySelector('#settings-actions');
const clearButton = document.querySelector('#settings-clear-cache');
const status = document.querySelector('#settings-cache-status');

if (settingsActions && clearButton) {
  async function clearGameCacheAndReload() {
    if (clearButton.disabled) return;
    const confirmed = window.confirm('Очистить кэш ECHO и перезагрузить игру? Профиль и выбранный персонаж не будут удалены.');
    if (!confirmed) return;

    clearButton.disabled = true;
    clearButton.textContent = 'Очищаем кэш…';
    if (status) status.textContent = 'Подготавливаем обновление…';

    try {
      // Leave localStorage, sessionStorage, cookies, and IndexedDB intact:
      // ECHO profile ID and selected character are stored there.
      if ('caches' in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map((name) => window.caches.delete(name)));
      }
    } catch (error) {
      console.warn('[ECHO settings] Could not clear Cache Storage:', error);
      // Continue with a fresh document URL when Cache API is blocked.
    }

    const url = new URL(window.location.href);
    url.searchParams.set('echo-cache-reset', String(Date.now()));
    window.location.replace(url.toString());
  }

  clearButton.addEventListener('click', clearGameCacheAndReload);
}

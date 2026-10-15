// ECHO settings cache reset. Keeps player profile and selected character intact.
const clearButton = document.querySelector('#settings-clear-cache');
const status = document.querySelector('#settings-cache-status');

if (clearButton) {
  async function clearGameCacheAndReload() {
    if (clearButton.disabled) return;

    const confirmed = await window.ECHOModal.confirm({
      title: 'СБРОС КЭША',
      text: 'Вы уверены, что хотите сбросить кэш?',
      confirmText: 'ДА',
      cancelText: 'НЕТ',
      closeOnBackdrop: false,
    });
    if (!confirmed) return;

    clearButton.disabled = true;
    clearButton.textContent = 'ОЧИЩАЕМ КЭШ…';
    if (status) status.textContent = 'Подготавливаем обновление…';

    try {
      // Leave localStorage, sessionStorage, cookies, and IndexedDB intact.
      // Cache Storage is origin-wide; avoid deleting unrelated entries.
      if ('caches' in window) {
        const names = await window.caches.keys();
        const echoCacheNames = names.filter((name) => /^echo[-_:]/i.test(name));
        await Promise.all(echoCacheNames.map((name) => window.caches.delete(name)));
      }
    } catch (error) {
      console.warn('[ECHO settings] Could not clear ECHO Cache Storage:', error);
    }

    const url = new URL(window.location.href);
    url.searchParams.set('echo-cache-reset', String(Date.now()));
    window.location.replace(url.toString());
  }

  clearButton.addEventListener('click', clearGameCacheAndReload);
}

// First stage of the unified code entry UI. Redemption is not wired to the server yet.
(() => {
  'use strict';

  const openButton = document.querySelector('#settings-enter-code');
  const t = (key, fallback) => window.$t?.('menu:' + key, fallback) || fallback;

  openButton?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'echo-code-input';
    input.maxLength = 80;
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.placeholder = t('code_placeholder', 'Введите код');
    input.setAttribute('aria-label', t('code_placeholder', 'Введите код'));

    const content = document.createElement('div');
    content.className = 'echo-code-modal-content';
    content.append(input);

    const modal = window.ECHOModal?.open({
      title: t('code_modal_title', 'ВВЕДИТЕ КОД'),
      contentElement: content,
      buttons: [{
        label: t('code_ok', 'ОК'),
        value: true,
        variant: 'primary',
        onClick() {
          if (!input.value.trim()) {
            window.ECHOToast?.show(t('code_empty', 'Введите код'));
            input.focus();
            return false;
          }
          // No fake activation or account changes until the code API is implemented.
          window.ECHOToast?.show(t('code_unavailable', 'Активация кодов пока не подключена'));
        }
      }]
    });

    if (!modal) return;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        content.closest('.echo-modal')?.querySelector('.echo-modal-button')?.click();
      }
    });
    // ECHOModal initially focuses the action button; move focus to the field after that.
    requestAnimationFrame(() => { if (input.isConnected) input.focus(); });
  });
})();

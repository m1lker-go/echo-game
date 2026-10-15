// ECHO global modal system.
// Usage from any client module:
// window.ECHOModal.open({ title: 'ЗАГОЛОВОК', text: 'Сообщение', buttons: [...] })
// window.ECHOModal.confirm({ title, text, confirmText, cancelText }) -> Promise<boolean>
(() => {
  if (window.ECHOModal) return;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  let overlay;
  let panel;
  let titleNode;
  let textNode;
  let actionsNode;
  let previousFocus = null;
  let resolver = null;

  function ensureModal() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'echo-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="echo-modal" role="dialog" aria-modal="true" aria-labelledby="echo-modal-title" aria-describedby="echo-modal-text">
        <h2 id="echo-modal-title" class="echo-modal-title"></h2>
        <div id="echo-modal-text" class="echo-modal-text"></div>
        <div class="echo-modal-actions" id="echo-modal-actions"></div>
      </section>
    `;
    document.body.appendChild(overlay);

    panel = overlay.querySelector('.echo-modal');
    titleNode = overlay.querySelector('#echo-modal-title');
    textNode = overlay.querySelector('#echo-modal-text');
    actionsNode = overlay.querySelector('#echo-modal-actions');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });

    document.addEventListener('keydown', (event) => {
      if (overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
        return;
      }
      if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button:not(:disabled)')];
        if (!focusable.length) {
          event.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  function close(result = null) {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('echo-modal-open');
    const resolve = resolver;
    resolver = null;
    if (typeof resolve === 'function') resolve(result);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    previousFocus = null;
  }

  function open(options = {}) {
    ensureModal();
    close(null);

    const config = {
      title: 'СООБЩЕНИЕ',
      text: '',
      buttons: [{ label: 'ЗАКРЫТЬ', value: true, variant: 'primary' }],
      closeOnBackdrop: true,
      ...options,
    };

    previousFocus = document.activeElement;
    titleNode.textContent = String(config.title ?? '');
    textNode.textContent = String(config.text ?? '');
    actionsNode.replaceChildren();

    for (const buttonConfig of config.buttons || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'echo-modal-button';
      if (buttonConfig.variant === 'primary') button.classList.add('is-primary');
      if (buttonConfig.variant === 'danger') button.classList.add('is-danger');
      button.textContent = String(buttonConfig.label ?? 'OK');
      button.disabled = Boolean(buttonConfig.disabled);
      button.addEventListener('click', () => {
        try {
          if (typeof buttonConfig.onClick === 'function') buttonConfig.onClick();
        } finally {
          close(buttonConfig.value ?? buttonConfig.label ?? true);
        }
      });
      actionsNode.appendChild(button);
    }

    overlay.dataset.closeOnBackdrop = String(config.closeOnBackdrop !== false);
    overlay.hidden = false;
    document.body.classList.add('echo-modal-open');
    requestAnimationFrame(() => {
      const firstButton = actionsNode.querySelector('button:not(:disabled)');
      if (firstButton) firstButton.focus();
      else panel.focus();
    });
    return { close };
  }

  function confirm(options = {}) {
    const {
      confirmText = 'ПОДТВЕРДИТЬ',
      cancelText = 'ОТМЕНА',
      ...rest
    } = options;
    return new Promise((resolve) => {
      resolver = resolve;
      open({
        ...rest,
        buttons: [
          { label: cancelText, value: false },
          { label: confirmText, value: true, variant: 'primary' },
        ],
      });
    });
  }

  function alert(options = {}) {
    const { buttonText = 'ПОНЯТНО', ...rest } = options;
    return new Promise((resolve) => {
      resolver = resolve;
      open({
        ...rest,
        buttons: [{ label: buttonText, value: true, variant: 'primary' }],
      });
    });
  }

  window.ECHOModal = { open, close, confirm, alert };
})();

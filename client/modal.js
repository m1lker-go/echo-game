// ECHO global modal system.
// Any client module can use window.ECHOModal.open(), confirm(), or alert().
(() => {
  if (window.ECHOModal) return;

  let overlay = null;
  let panel = null;
  let titleNode = null;
  let textNode = null;
  let actionsNode = null;
  let previousFocus = null;
  let resolver = null;

  function ensureModal() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'echo-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="echo-modal" role="dialog" aria-modal="true" aria-labelledby="echo-modal-title" aria-describedby="echo-modal-text" tabindex="-1">
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
      if (
        event.target === overlay &&
        overlay.dataset.closeOnBackdrop !== 'false'
      ) close(null);
    });

    document.addEventListener('keydown', (event) => {
      if (!overlay || overlay.hidden) return;
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
    const pendingResolve = resolver;
    resolver = null;
    if (typeof pendingResolve === 'function') pendingResolve(result);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    previousFocus = null;
  }

  function open(options = {}) {
    ensureModal();
    // Close an existing modal before assigning any new Promise resolver.
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

    for (const item of config.buttons || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'echo-modal-button';
      if (item.variant === 'primary') button.classList.add('is-primary');
      if (item.variant === 'danger') button.classList.add('is-danger');
      button.textContent = String(item.label ?? 'OK');
      button.disabled = Boolean(item.disabled);
      button.addEventListener('click', () => {
        try {
          if (typeof item.onClick === 'function') item.onClick();
        } finally {
          close(item.value ?? item.label ?? true);
        }
      });
      actionsNode.appendChild(button);
    }

    overlay.dataset.closeOnBackdrop = String(config.closeOnBackdrop !== false);
    overlay.hidden = false;
    document.body.classList.add('echo-modal-open');
    requestAnimationFrame(() => {
      if (!overlay || overlay.hidden) return;
      const firstButton = actionsNode.querySelector('button:not(:disabled)');
      (firstButton || panel).focus();
    });
    return { close };
  }

  function confirm(options = {}) {
    const { confirmText = 'ПОДТВЕРДИТЬ', cancelText = 'ОТМЕНА', ...rest } = options;
    return new Promise((resolve) => {
      open({
        ...rest,
        buttons: [
          { label: cancelText, value: false },
          { label: confirmText, value: true, variant: 'primary' },
        ],
      });
      resolver = resolve;
    });
  }

  function alert(options = {}) {
    const { buttonText = 'ПОНЯТНО', ...rest } = options;
    return new Promise((resolve) => {
      open({
        ...rest,
        buttons: [{ label: buttonText, value: true, variant: 'primary' }],
      });
      resolver = resolve;
    });
  }

  window.ECHOModal = { open, close, confirm, alert };
})();

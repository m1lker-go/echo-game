// ECHO global modal system.
// Any client module can use window.ECHOModal.open(), confirm(), or alert().
(() => {
  if (window.ECHOModal) return;

  let overlay = null;
  let panel = null;
  let titleNode = null;
  let textNode = null;
  let actionsNode = null;
  let particlesCanvas = null;
  let particlesContext = null;
  let particlesFrame = 0;
  let previousFocus = null;
  let resolver = null;

  const particles = Array.from({ length: 46 }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 1.8 + Math.random() * 2.6,
    phase: Math.random() * Math.PI * 2,
    speed: 0.00008 + Math.random() * 0.00012,
    drift: 0.00015 + Math.random() * 0.00025,
  }));

  function resizeParticles() {
    if (!particlesCanvas || !particlesContext) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    particlesCanvas.width = Math.round(window.innerWidth * dpr);
    particlesCanvas.height = Math.round(window.innerHeight * dpr);
    particlesContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawParticles(time) {
    if (!particlesCanvas || !particlesContext || overlay?.hidden) {
      particlesFrame = 0;
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    particlesContext.clearRect(0, 0, width, height);

    for (const point of particles) {
      const x = (point.x * width + Math.sin(time * point.speed + point.phase) * 28 + width) % width;
      const y = (point.y * height + Math.cos(time * point.drift + point.phase) * 22 + height) % height;
      const pulse = 0.55 + 0.45 * Math.sin(time * 0.0022 + point.phase);
      const radius = point.size * pulse;
      const halo = particlesContext.createRadialGradient(x, y, 0, x, y, radius * 4.2);
      halo.addColorStop(0, 'rgba(220,242,255,.38)');
      halo.addColorStop(.3, 'rgba(220,242,255,.14)');
      halo.addColorStop(1, 'rgba(220,242,255,0)');
      particlesContext.fillStyle = halo;
      particlesContext.beginPath();
      particlesContext.arc(x, y, radius * 4.2, 0, Math.PI * 2);
      particlesContext.fill();

      particlesContext.fillStyle = `rgba(235,248,255,${0.28 + pulse * 0.42})`;
      particlesContext.beginPath();
      particlesContext.arc(x, y, radius, 0, Math.PI * 2);
      particlesContext.fill();
    }

    particlesFrame = requestAnimationFrame(drawParticles);
  }

  function startParticles() {
    if (particlesFrame || !particlesCanvas) return;
    resizeParticles();
    particlesFrame = requestAnimationFrame(drawParticles);
  }

  function stopParticles() {
    if (particlesFrame) cancelAnimationFrame(particlesFrame);
    particlesFrame = 0;
    if (particlesContext && particlesCanvas) {
      particlesContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function ensureModal() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'echo-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <canvas class="echo-modal-particles" aria-hidden="true"></canvas>
      <section class="echo-modal" role="dialog" aria-modal="true" aria-labelledby="echo-modal-title" aria-describedby="echo-modal-text" tabindex="-1">
        <h2 id="echo-modal-title" class="echo-modal-title"></h2>
        <div id="echo-modal-text" class="echo-modal-text"></div>
        <div class="echo-modal-actions" id="echo-modal-actions"></div>
      </section>
    `;
    document.body.appendChild(overlay);

    particlesCanvas = overlay.querySelector('.echo-modal-particles');
    particlesContext = particlesCanvas.getContext('2d');
    window.addEventListener('resize', resizeParticles, { passive: true });

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
    stopParticles();
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
    if (config.contentElement instanceof HTMLElement) textNode.replaceChildren(config.contentElement);
    actionsNode.replaceChildren();

    for (const item of config.buttons || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'echo-modal-button';
      if (item.variant === 'primary') button.classList.add('is-primary');
      if (item.variant === 'danger') button.classList.add('is-danger');
      button.textContent = String(item.label ?? 'OK');
      button.disabled = Boolean(item.disabled);
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          // Returning false keeps this modal open (e.g. invalid form data).
          const result = typeof item.onClick === 'function' ? await item.onClick() : undefined;
          if (result !== false) close(item.value ?? item.label ?? true);
        } catch (error) {
          console.error('[echo modal] button handler failed', error);
        } finally {
          button.disabled = false;
        }
      });
      actionsNode.appendChild(button);
    }

    overlay.dataset.closeOnBackdrop = String(config.closeOnBackdrop !== false);
    overlay.hidden = false;
    document.body.classList.add('echo-modal-open');
    startParticles();
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

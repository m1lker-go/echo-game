// Universal code modal; the server alone decides which partner quest the code verifies.
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
        async onClick() {
          const code=input.value.trim().toUpperCase();
          if (!code) {
            window.ECHOToast?.show(t('code_empty','Введите код'));
            input.focus();return false;
          }
          const token=localStorage.getItem('echo.authToken');
          if (!token) {
            window.ECHOToast?.show(t('code_auth_required','Войди в аккаунт'));
            return false;
          }
          try {
            const response=await fetch('/echo/api/codes/redeem',{
              method:'POST',
              headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
              body:JSON.stringify({code}),cache:'no-store'
            });
            const data=await response.json();
            if(!response.ok||!data.success) {
              const messages={400:'code_invalid',404:'code_not_found',409:'code_used',410:'code_expired',429:'code_limited',503:'code_not_configured'};
              const fallback={400:'Неверный код',404:'Код не найден',409:'Код уже использован',410:'Срок действия кода истёк',429:'Слишком много попыток',503:'Связь игр пока не настроена'};
              const status=messages[response.status]||'code_error';
              window.ECHOToast?.show(t(status,fallback[response.status]||'Не удалось проверить код'));
              return false;
            }
            window.ECHOToast?.show(t('code_accepted','Код принят! Вернись в Cat Fighting и нажми «Проверка».'));
            return true;
          } catch (error) {
            console.warn('[echo codes] activation failed:',error);
            window.ECHOToast?.show(t('code_error','Не удалось проверить код'));
            return false;
          }
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

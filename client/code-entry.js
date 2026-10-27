// Universal code modal; the server determines referral, partner and ECHO promo rewards.
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
              const referral={REFERRAL_SELF:t('referral_self','Нельзя ввести собственный код'),
                REFERRAL_ALREADY_USED:t('referral_already_used','Ты уже активировал реферальный код'),
                REFERRAL_NOT_FOUND:t('code_not_found','Код не найден')};
              const promos={
                PROMO_ALREADY_CLAIMED:t('promo_already_claimed','Код уже активирован'),
                PROMO_EXHAUSTED:t('promo_exhausted','Лимит активаций кода исчерпан'),
                PROMO_EXPIRED:t('code_expired','Срок действия кода истёк'),
                PROMO_INACTIVE:t('promo_inactive','Этот код больше не действует'),
                PROMO_NOT_FOUND:t('code_not_found','Код не найден'),
                PROMO_INVALID:t('code_invalid','Неверный код')
              };
              window.ECHOToast?.show(promos[data.error]||referral[data.error]||t(status,fallback[response.status]||'Не удалось проверить код'));
              return false;
            }
            if(data.type==='referral'){
              const toast=document.createElement('span');
              toast.className='echo-quest-reward-toast';
              const label=document.createElement('span');
              label.textContent=t('referral_received','Получено:')+' '+(data.reward?.quantity||2);
              const icon=document.createElement('img');
              icon.src='./assets/packs/icon_echocard_basic.webp';
              icon.alt=t('referral_pack','Обычный пак');icon.width=27;icon.height=27;
              toast.append(label,icon);
              window.ECHOToast?.show(toast);
              window.dispatchEvent(new Event('echo:shop-balance-refresh'));
              window.dispatchEvent(new Event('echo:referrals-refresh'));
            }else if(data.type==='promo'){
              const reward=data.reward||{};
              const icons={
                coins:['./assets/icons/coin.webp',t('promo_coins','ECHO Coins')],
                basic_pack:['./assets/packs/icon_echocard_basic.webp',t('promo_basic_pack','Обычный пак')],
                premium_pack:['./assets/packs/icon_echocard_special.webp',t('promo_premium_pack','Премиум-пак')]
              };
              const selected=icons[reward.type];
              if(selected && Number.isSafeInteger(reward.quantity) && reward.quantity>0){
                const toast=document.createElement('span');
                toast.className='echo-quest-reward-toast';
                const label=document.createElement('span');
                label.textContent=t('promo_received','Получено:')+' +'+reward.quantity;
                const icon=document.createElement('img');
                icon.src=selected[0];icon.alt=selected[1];icon.width=27;icon.height=27;
                toast.append(label,icon);
                window.ECHOToast?.show(toast);
              }else{
                window.ECHOToast?.show(t('promo_success','Промокод активирован!'));
              }
              window.dispatchEvent(new Event('echo:shop-balance-refresh'));
            }else{
              window.ECHOToast?.show(t('code_accepted','Код принят! Вернись в Cat Fighting и нажми «Проверка».'));
            }
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

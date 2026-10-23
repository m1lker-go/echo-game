// ECHO purchase history: read-only account-owned records from server DB.
// No localStorage "receipts", no client-side payment verification.
(() => {
  'use strict';
  const openButton = document.getElementById('echo-purchase-history');
  if (!openButton) return;
  const isEn = () => document.documentElement.lang?.startsWith('en');
  const t = (key, ru, en) => window.$t?.('menu:' + key, isEn() ? en : ru) ?? (isEn() ? en : ru);
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  };
  const currency = (record) => {
    switch (record.currency) {
      case 'RUB': return Number(record.amount).toLocaleString(isEn() ? 'en-US' : 'ru-RU') + ' ₽';
      case 'VK_VOTES': return record.amount + ' ' + t('purchase_votes', 'голосов VK', 'VK votes');
      case 'ECHO_COIN': return record.amount + ' ECHO Coin';
      case 'FREE': return t('purchase_free', 'Бесплатно', 'Free');
      default: return '—';
    }
  };
  const providerLabel = (record) => ({
    robokassa: 'Robokassa',
    vk: 'VK',
    coin: 'ECHO Coin',
    free: t('purchase_free_pack', 'Бесплатный пак', 'Free pack')
  })[record.provider] || String(record.provider);
  const statusLabel = (record) => ({
    paid: t('purchase_paid', 'Подтверждено', 'Confirmed'),
    pending: t('purchase_pending', 'Ожидает оплаты', 'Awaiting payment'),
    refunded: t('purchase_refunded', 'Возврат средств', 'Refunded')
  })[record.status] || t('purchase_unknown', 'Проверяется', 'Under review');
  const formatDate = (raw) => {
    const date = new Date(raw);
    if (!raw || !Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString(isEn() ? 'en-GB' : 'ru-RU', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };
  const addDetail = (container, label, value) => {
    const row = element('div', 'echo-history-detail');
    row.append(element('span', 'echo-history-detail-label', label),
      element('strong', 'echo-history-detail-value', value));
    container.append(row);
  };
  const createRecord = (record) => {
    const card = element('article', 'echo-history-record');
    const top = element('div', 'echo-history-record-top');
    top.append(
      element('strong', '', record.packType === 'premium'
        ? t('purchase_premium', 'Элитный пак', 'Elite pack')
        : t('purchase_basic', 'Обычный пак', 'Basic pack')),
      element('strong', 'echo-history-price', currency(record))
    );
    card.append(top);
    const details = element('div', 'echo-history-details');
    addDetail(details, t('purchase_method', 'Способ', 'Method'), providerLabel(record));
    addDetail(details, t('purchase_status', 'Статус', 'Status'), statusLabel(record));
    addDetail(details, t('purchase_number', 'Номер заказа', 'Order ID'), record.orderId);
    addDetail(details, t('purchase_date', 'Дата заказа', 'Order date'), formatDate(record.createdAt));
    if (record.completedAt) {
      addDetail(details, t('purchase_confirmed_at', 'Дата подтверждения', 'Confirmed at'),
        formatDate(record.completedAt));
    }
    if (record.status === 'paid') {
      addDetail(details, t('purchase_cards', 'Карточек персонажей', 'Character cards'),
        String(record.cardModels));
    }
    if (record.testMode) {
      addDetail(details, t('purchase_mode', 'Режим', 'Mode'),
        t('purchase_test', 'Тестовая покупка', 'Test transaction'));
    }
    card.append(details);
    return card;
  };
  let shown = false;
  openButton.addEventListener('click', () => {
    if (shown) return;
    const token = localStorage.getItem('echo.authToken');
    if (!token) {
      window.ECHOModal?.alert({
        title: t('purchase_title', 'ИСТОРИЯ ПОКУПОК', 'PURCHASE HISTORY'),
        text: t('purchase_login', 'Войдите в аккаунт, чтобы увидеть покупки.',
          'Sign in to view your purchases.')
      });
      return;
    }
    shown = true;
    const content = element('div', 'echo-history-container');
    const list = element('div', 'echo-history-list');
    const hint = element('p', 'echo-history-hint',
      t('purchase_loading', 'Загружаем историю…', 'Loading purchases…'));
    const more = element('button', 'echo-history-more',
      t('purchase_more', 'Показать ещё', 'Show more'));
    more.type = 'button';
    more.hidden = true;
    content.append(hint, list, more);
    const modal = window.ECHOModal?.open({
      title: t('purchase_title', 'ИСТОРИЯ ПОКУПОК', 'PURCHASE HISTORY'),
      contentElement: content,
      buttons: [{
        label: t('purchase_close', 'ЗАКРЫТЬ', 'CLOSE'),
        value: true, variant: 'primary'
      }],
      closeOnBackdrop: true
    });
    if (!modal) { shown = false; return; }
    // Page cursors and all records are fetched from the signed-in server.
    let offset = 0, busy = false, count = 0;
    const load = async () => {
      if (busy) return;
      busy = true;
      more.hidden = true;
      hint.hidden = false;
      hint.textContent = t('purchase_loading', 'Загружаем историю…', 'Loading purchases…');
      try {
        if (localStorage.getItem('echo.authToken') !== token)
          throw new Error('account_changed');
        const response = await fetch(
          '/echo/api/purchases?limit=20&offset=' + offset,
          { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }
        );
        if (!response.ok) throw new Error(response.status === 401 ? 'auth' : 'network');
        const data = await response.json();
        if (!Array.isArray(data.purchases)) throw new Error('network');
        for (const record of data.purchases) list.append(createRecord(record));
        count += data.purchases.length;
        hint.hidden = count !== 0;
        if (!count) hint.textContent = t('purchase_empty', 'Покупок пока нет.', 'No purchases yet.');
        if (data.hasMore && Number.isSafeInteger(data.nextOffset)) {
          offset = data.nextOffset;
          more.hidden = false;
        }
      } catch (error) {
        hint.hidden = false;
        hint.textContent = error.message === 'auth' || error.message === 'account_changed'
          ? t('purchase_login', 'Войдите в аккаунт, чтобы увидеть покупки.',
            'Sign in to view your purchases.')
          : t('purchase_error', 'Не удалось загрузить историю. Попробуйте ещё раз.',
            'Could not load purchase history. Try again.');
        more.hidden = false;
        more.textContent = t('purchase_retry', 'ПОВТОРИТЬ', 'RETRY');
      } finally {
        busy = false;
      }
    };
    more.addEventListener('click', () => { void load(); });
    void load();
    // The global modal has no onClose callback, so reset the guard when
    // its overlay is hidden, without altering the shared modal implementation.
    const modalRoot = document.querySelector('.echo-modal-overlay');
    if (modalRoot) {
      const observer = new MutationObserver(() => {
        if (modalRoot.hidden) {
          shown = false;
          observer.disconnect();
        }
      });
      observer.observe(modalRoot, { attributes: true, attributeFilter: ['hidden'] });
    }
  });
})();

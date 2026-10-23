// Special quests are intentionally separate from daily quest progress and reset.
(() => {
  'use strict';

  const screen = document.querySelector('#menu-quests-screen');
  const dailyTab = document.querySelector('#quests-tab-daily');
  const specialTab = document.querySelector('#quests-tab-special');
  const dailyList = document.querySelector('#quests-list');
  const dailyStatus = document.querySelector('#quests-status');
  const specialList = document.querySelector('#quests-special-list');
  const specialStatus = document.querySelector('#quests-special-status');
  if (!screen || !dailyTab || !specialTab || !specialList) return;

  const t = (key, fallback) => window.$t?.('menu:' + key, fallback) || fallback;
  const auth = () => localStorage.getItem('echo.authToken');
  const url = path => '/echo' + path;
  let activeTab = 'daily';
  let quest = null;
  let busy = false;
  let copiedCode = null;
  let loadError = false;
  let lastExpiryAttempt = 0;

  function showToast(message) { window.ECHOToast?.show(message); }
  function node(tag, cls, value) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (value !== undefined) element.textContent = value;
    return element;
  }
  function action(label, callback, cls = '') {
    const button = node('button', 'echo-special-action ' + cls, label);
    button.type = 'button';
    button.disabled = busy;
    button.addEventListener('click', callback);
    return button;
  }
  function selectTab(next) {
    activeTab = next;
    dailyTab.classList.toggle('is-active', next === 'daily');
    specialTab.classList.toggle('is-active', next === 'special');
    dailyTab.setAttribute('aria-pressed', String(next === 'daily'));
    specialTab.setAttribute('aria-pressed', String(next === 'special'));
    dailyList.hidden = next !== 'daily';
    dailyStatus.hidden = next !== 'daily';
    specialList.hidden = next !== 'special';
    specialStatus.hidden = next !== 'special';
    if (next === 'special') { render(); void refresh(); }
  }
  function timeLeft() {
    if (!quest?.expiresAt || quest.verified) return null;
    return Math.max(0, Math.ceil((Date.parse(quest.expiresAt) - Date.now()) / 1000));
  }
  function timeString(seconds) {
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function safeLink() {
    try {
      const link = new URL(quest?.gameUrl || '');
      return link.protocol === 'https:' ? link.href : 'https://cat-fight.ru/';
    } catch { return 'https://cat-fight.ru/'; }
  }
  async function copy() {
    if (!quest?.code) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API missing');
      await navigator.clipboard.writeText(quest.code);
    } catch {
      // Mobile webviews may forbid the Clipboard API. Legacy copy is a fallback.
      const temporary = node('textarea');
      temporary.value = quest.code;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      const success = document.execCommand?.('copy');
      temporary.remove();
      if (!success) { showToast(t('special_copy_failed', 'Не удалось скопировать код')); return; }
    }
    copiedCode = quest.code;
    try { sessionStorage.setItem('echo.specialCopied', copiedCode); } catch {}
    showToast(t('special_copied', 'Код скопирован'));
    render();
  }
  async function check() {
    if (busy || !auth()) return;
    const originalToken = auth();
    busy = true;
    render();
    try {
      const response = await fetch(url('/api/special-quests/check'), {
        method: 'POST', headers: { Authorization: 'Bearer ' + originalToken },
        cache: 'no-store'
      });
      if (auth() !== originalToken) return;
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      quest = data.quest;
      if (data.claimedNow) {
        showToast(t('special_reward_received', 'Награда получена: ') + '+' + quest.rewardCoins + ' ECHO Coin');
        window.dispatchEvent(new Event('echo:balance-refresh'));
      } else if (data.status === 'completed') {
        showToast(t('special_already_done', 'Задание уже выполнено'));
      } else if (data.status === 'reward_unconfigured') {
        showToast(t('special_reward_pending', 'Переход подтверждён. Награда пока не настроена'));
      } else {
        showToast(t('special_not_verified', 'Код ещё не введён в Cat Fighting'));
      }
    } catch (error) {
      console.warn('[special-quests] check failed:', error);
      showToast(t('special_error', 'Не удалось проверить задание'));
    } finally { busy = false; render(); }
  }
  function render() {
    if (activeTab !== 'special') return;
    specialList.replaceChildren();
    specialStatus.textContent = '';
    if (loadError) { specialStatus.textContent = t('special_error', 'Не удалось загрузить особое задание'); return; }
    if (!auth()) {
      specialStatus.textContent = t('quests_guest', 'Задания доступны только авторизованным пользователям.');
      return;
    }
    if (!quest) {
      specialStatus.textContent = t('special_loading', 'Загружаем особое задание…');
      return;
    }
    const article = node('article', 'echo-special-card' + (quest.claimed ? ' is-complete' : ''));
    const head = node('div', 'echo-special-head');
    const logo = node('span', 'echo-special-logo', 'CF');
    logo.setAttribute('aria-hidden', 'true');
    const heading = node('div', 'echo-special-heading');
    heading.append(node('strong', '', t('special_catfight', 'CAT FIGHTING')),
      node('span', '', t('special_join', 'Присоединиться к игре')));
    head.append(logo, heading);
    article.append(head);
    if (quest.claimed) {
      article.append(node('p', 'echo-special-description', t('special_completed', 'Задание выполнено. Награда получена навсегда.')));
      const link = node('a', 'echo-special-action is-primary echo-special-goto', t('special_go', 'Перейти'));
      link.href = safeLink();
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      article.append(link);
    } else {
      article.append(node('p', 'echo-special-description', t('special_instruction', 'Скопируй код и вставь его в настройках Cat Fighting.')));
      if (quest.code) {
        const code = node('div', 'echo-special-code', quest.code);
        code.setAttribute('aria-label', t('special_code', 'Персональный код'));
        article.append(code);
        const seconds = timeLeft();
        if (seconds !== null) article.append(node('p', 'echo-special-expiry',
          t('special_expires', 'Код сменится через: ') + timeString(seconds)));
        const actions = node('div', 'echo-special-actions');
        actions.append(action(t('special_copy', 'Копировать код'), copy));
        const link = node('a', 'echo-special-action is-primary', t('special_open', 'Открыть Cat Fighting'));
        link.href = safeLink();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
        article.append(actions);
      }
      if (quest.verified) {
        article.append(node('p', 'echo-special-verified', t('special_verified', 'Код принят в Cat Fighting. Нажми «Проверка».')));
      }
      const canCheck = Boolean(quest.verified || copiedCode === quest.code);
      if (canCheck) article.append(action(t('special_check', 'Проверка'), check, 'echo-special-check'));
      else article.append(node('p', 'echo-special-hint', t('special_copy_first', 'После копирования кода появится кнопка проверки.')));
      if (quest.verified && !quest.rewardConfigured) {
        article.append(node('p', 'echo-special-hint', t('special_reward_pending', 'Переход подтверждён. Награда пока не настроена')));
      }
    }
    specialList.append(article);
  }
  async function refresh() {
    if (screen.hidden || activeTab !== 'special' || busy) return;
    const originalToken = auth();
    if (!originalToken) { quest = null; render(); return; }
    busy = true;
    if (!quest) render();
    try {
      const response = await fetch(url('/api/special-quests'), {
        headers: { Authorization: 'Bearer ' + originalToken }, cache: 'no-store'
      });
      if (auth() !== originalToken) return;
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      quest = data.quest;
      loadError = false;
      if (!copiedCode) {
        try { copiedCode = sessionStorage.getItem('echo.specialCopied'); } catch {}
      }
    } catch (error) {
      console.warn('[special-quests] fetch failed:', error);
      loadError = true;
    } finally {
      busy = false;
      render();
    }
  }
  dailyTab.addEventListener('click', () => selectTab('daily'));
  specialTab.addEventListener('click', () => selectTab('special'));
  window.addEventListener('echo:quests-open', () => {
    if (activeTab === 'special') void refresh();
  });
  window.addEventListener('echo:language-changed', () => {
    dailyTab.textContent = t('quests_tab_daily', 'Ежедневные');
    specialTab.textContent = t('quests_tab_special', 'Особые');
    render();
  });
  document.addEventListener('echo:auth-changed', () => { quest = null; copiedCode = null; if (activeTab === 'special') void refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && activeTab === 'special') void refresh(); });
  window.addEventListener('focus', () => { if (activeTab === 'special') void refresh(); });
  // Updates expiration, and requests the next 30-minute code when the old one lapses.
  setInterval(() => {
    if (screen.hidden || activeTab !== 'special') return;
    const left = timeLeft();
    if (quest && left === 0 && !busy && Date.now() - lastExpiryAttempt > 10000) {
      lastExpiryAttempt = Date.now();
      void refresh();
    } else if (left !== null) {
      const countdown = specialList.querySelector('.echo-special-expiry');
      if (countdown) countdown.textContent = t('special_expires', 'Код сменится через: ') + timeString(left);
    }
  }, 1000);
  selectTab('daily');
})();

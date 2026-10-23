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
  const specialPackIcon = './assets/packs/icon_echocard_special.webp';
  // Same toast markup used by daily quests: label and 25px reward icon.
  function showPackRewardToast(quantity) {
    const message = node('span', 'echo-quest-reward-toast');
    const label = node('span', '', t('special_reward_received', 'Вы получили') + ' +' + quantity);
    const image = node('img');
    image.src = specialPackIcon;
    image.alt = t('special_reward_pack_name', 'Специальный набор');
    image.width = 25;
    image.height = 25;
    message.append(label, image);
    window.ECHOToast?.show(message);
  }
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
  // VK users must launch Cat Fighting as its own Mini App. A normal URL in
  // ECHO's WebView inherits ECHO's landscape-sized viewport.
  const CAT_FIGHT_VK_APP_ID = 54671077;
  const CAT_FIGHT_VK_URL = 'https://vk.ru/app' + CAT_FIGHT_VK_APP_ID;
  function safeLink() {
    try {
      const link = new URL(quest?.gameUrl || '');
      return link.protocol === 'https:' ? link.href : 'https://cat-fight.ru/';
    } catch { return 'https://cat-fight.ru/'; }
  }
  async function openCatFightingInVK() {
    try {
      const bridge = window.vkBridge?.send ? window.vkBridge : await window.ECHOVKBridgeReady;
      if (!bridge?.send) throw new Error('VK Bridge unavailable');
      await bridge.send('VKWebAppOpenApp', { app_id: CAT_FIGHT_VK_APP_ID });
    } catch (error) {
      console.warn('[special-quests] VK Mini App launch failed:', error);
      showToast(t('special_open_failed', 'Не удалось открыть Cat Fighting. Найди игру в приложениях ВКонтакте.'));
    }
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
        showPackRewardToast(data.reward?.quantity || 1);
        window.dispatchEvent(new Event('echo:shop-balance-refresh'));
      } else if (data.status === 'completed') {
        showToast(t('special_already_done', 'Задание уже выполнено'));
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
    const logo = node('span', 'echo-special-logo');
    const logoImage = node('img', 'echo-special-logo-image');
    logoImage.src = './assets/icons/icon_cf.webp';
    logoImage.alt = '';
    logo.append(logoImage);
    logo.setAttribute('aria-hidden', 'true');
    const heading = node('div', 'echo-special-heading');
    heading.append(node('strong', '', t('special_catfight', 'CAT FIGHTING')),
      node('span', '', t('special_join', 'Присоединиться к игре')));
    // Always show the square link in the title row, even after completion.
    const link = node('a', 'echo-special-visit');
    link.href = window.isVKMiniApp ? CAT_FIGHT_VK_URL : safeLink();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', event => {
      if (!window.isVKMiniApp || event.button !== 0 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void openCatFightingInVK();
    });
    link.setAttribute('aria-label', quest.claimed
      ? t('special_go', 'Перейти')
      : t('special_open', 'Открыть Cat Fighting'));
    link.title = t('special_open', 'Открыть Cat Fighting');
    const visitIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    visitIcon.setAttribute('viewBox', '0 0 24 24');
    visitIcon.setAttribute('fill', 'none');
    visitIcon.setAttribute('stroke', 'currentColor');
    visitIcon.setAttribute('stroke-width', '2.1');
    visitIcon.setAttribute('stroke-linecap', 'round');
    visitIcon.setAttribute('stroke-linejoin', 'round');
    visitIcon.setAttribute('aria-hidden', 'true');
    visitIcon.innerHTML = '<path d="M4 9V4.5A1.5 1.5 0 0 1 5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5V15"/><path d="M2 12h13m-5-5 5 5-5 5"/>';
    link.append(visitIcon);
    head.append(logo, heading, link);
    article.append(head);
    if (!quest.claimed) {
      const rewardLine = node('div', 'echo-special-reward');
      const rewardLabel = node('span', 'echo-special-reward-label', t('special_reward_title', 'Награда:'));
      const rewardIcon = node('img', 'echo-special-reward-icon');
      rewardIcon.src = specialPackIcon;
      rewardIcon.alt = t('special_reward_pack_name', 'Специальный набор');
      rewardIcon.width = 36;
      rewardIcon.height = 36;
      const rewardQuantity = node('span', 'echo-special-reward-quantity', t('special_reward_quantity', '1 шт.'));
      rewardLine.append(rewardLabel, rewardIcon, rewardQuantity);
      const canCheck = !quest.claimed && Boolean(quest.verified || (quest.code && copiedCode === quest.code));
      if (canCheck) rewardLine.append(action(t('special_check', 'Проверка'), check, 'echo-special-check'));
      article.append(rewardLine);
      if (quest.code) {
        // The code and copy icon share one bordered row, like nickname/edit.
        const codeRow = node('div', 'echo-special-code-row');
        const code = node('div', 'echo-special-code', quest.code);
        code.setAttribute('aria-label', t('special_code', 'Персональный код'));
        const copyButton = node('button', 'echo-special-copy');
        copyButton.type = 'button';
        copyButton.disabled = busy;
        copyButton.setAttribute('aria-label', t('special_copy', 'Копировать код'));
        copyButton.title = t('special_copy', 'Копировать код');
        const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        copyIcon.setAttribute('viewBox', '0 0 24 24');
        copyIcon.setAttribute('fill', 'none');
        copyIcon.setAttribute('stroke', 'currentColor');
        copyIcon.setAttribute('stroke-width', '1.9');
        copyIcon.setAttribute('stroke-linecap', 'round');
        copyIcon.setAttribute('stroke-linejoin', 'round');
        copyIcon.setAttribute('aria-hidden', 'true');
        copyIcon.innerHTML = '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>';
        copyButton.append(copyIcon);
        copyButton.addEventListener('click', copy);
        codeRow.append(code, copyButton);
        article.append(codeRow);
      }
      article.append(node('p', 'echo-special-instruction', t('special_instruction', 'Введи код в настройках Cat Fighting')));
      if (quest.verified) {
        article.append(node('p', 'echo-special-verified', t('special_verified', 'Код принят в Cat Fighting. Нажми «Проверка».')));
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
    }
  }, 1000);
  selectTab('daily');
})();

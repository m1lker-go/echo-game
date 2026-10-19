// ECHO daily quests — read-only server progress, one-time completion per day.
// Guest identities are not verified; this interface never mints currency.
const list = document.querySelector('#quests-list');
const status = document.querySelector('#quests-status');
const reset = document.querySelector('#quests-reset');
const screen = document.querySelector('#menu-quests-screen');
const profileKey = 'echo.activityProfileId';
let current = null;
let loading = false;
const t = (key, fallback) => window.$t?.('menu:' + key, fallback) || fallback;
function endpoint(path) {
  return new URL(path, window.ECHO_SERVER_URL || location.origin);
}
function profileId() {
  let id = localStorage.getItem(profileKey);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id || '')) {
    id = (globalThis.crypto?.randomUUID?.() || ('echo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))).replace(/[^a-zA-Z0-9_-]/g, '_');
    localStorage.setItem(profileKey, id);
  }
  return id;
}
function show(message) { status.textContent = message; }
const meta = {
  play: { icon: '◷', title: 'quests_play', fallback: 'Время в ECHO' },
  food: { icon: '✦', title: 'quests_food', fallback: 'Собиратель' },
  pvp: { icon: '⚔', title: 'quests_pvp', fallback: 'Победитель' },
};
function render() {
  list.replaceChildren();
  reset.textContent = t('quests_reset', 'Обновление ежедневно в 00:00 по Москве');
  if (!current) return;
  for (const quest of current.quests || []) {
    const info = meta[quest.id];
    if (!info) continue;
    const progress = Math.max(0, Math.min(quest.target, quest.progress));
    const ready = progress >= quest.target;
    const article = document.createElement('article');
    article.className = 'echo-quest' + (quest.claimed ? ' is-complete' : '');
    const heading = document.createElement('div');
    heading.className = 'echo-quest-heading';
    const icon = document.createElement('span');
    icon.className = 'echo-quest-icon';
    icon.textContent = info.icon;
    const title = document.createElement('strong');
    title.textContent = t(info.title, info.fallback);
    const counter = document.createElement('span');
    counter.className = 'echo-quest-counter';
    counter.textContent = quest.id === 'play'
      ? `${Math.floor(progress / 60)}/${Math.floor(quest.target / 60)} ${t('quests_progress_minutes','мин')}`
      : `${progress}/${quest.target}`;
    heading.append(icon, title, counter);
    const track = document.createElement('div');
    track.className = 'echo-quest-track';
    const bar = document.createElement('div');
    bar.style.width = `${100 * progress / quest.target}%`;
    track.append(bar);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'echo-quest-claim';
    button.disabled = !ready || quest.claimed || loading;
    button.textContent = quest.claimed
      ? t('quests_claimed', 'Выполнено')
      : ready ? t('quests_claim', 'Завершить') : t('quests_incomplete', 'В процессе');
    button.addEventListener('click', () => claim(quest.id));
    article.append(heading, track, button);
    list.append(article);
  }
  show(t('quests_guest', 'Награды гостевым профилям пока не начисляют монеты.'));
}
async function refresh() {
  if (screen.hidden || loading) return;
  const id = profileId();
  if (!id) { show(t('quests_error', 'Не удалось загрузить задания. Попробуй снова.')); return; }
  loading = true;
  show(t('quests_loading', 'Загружаем задания…'));
  try {
    const url = endpoint('/api/daily-quests');
    url.searchParams.set('profileId', id);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error(String(response.status));
    current = await response.json();
    render();
  } catch (error) {
    console.warn('[echo quests] fetch failed', error);
    show(t('quests_error', 'Не удалось загрузить задания. Попробуй снова.'));
  } finally { loading = false; }
}
async function claim(questId) {
  const id = profileId();
  if (!id || loading) return;
  loading = true;
  try {
    const response = await fetch(endpoint('/api/daily-quests/claim'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: id, questId }),
    });
    const data = await response.json();
    if (!response.ok && response.status !== 409) throw Error(String(response.status));
    if (data.quests) current = data;
    render();
  } catch (error) {
    console.warn('[echo quests] claim failed', error);
    show(t('quests_error', 'Не удалось загрузить задания. Попробуй снова.'));
  } finally { loading = false; }
}
window.addEventListener('echo:quests-open', refresh);
window.addEventListener('echo:language-changed', () => { if (current) render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !screen.hidden) refresh(); });

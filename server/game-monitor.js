'use strict';
// Private, best-effort Telegram notices for the game owner.
// Do not use this for client-side clicks, test purchases or ad-free claims.
const { pool } = require('./db');

const safe = value => String(value ?? '').replace(/[\r\n\t<>\x00-\x1f]/g, ' ').slice(0, 160);

function notifyGameMonitor(kind, { accountId, product, amount, currency, context } = {}) {
  const token = process.env.GAME_MONITOR_BOT_TOKEN;
  const chatId = process.env.GAME_MONITOR_CHAT_ID;
  if (!token || !chatId) return;

  void (async () => {
    try {
      const result = await pool.query('SELECT nickname FROM echo_accounts WHERE id = $1', [accountId]);
      const name = safe(result.rows[0]?.nickname || 'Игрок');
      const player = `Игрок: ${name}\nID: ${safe(accountId)}`;
      let message;
      if (kind === 'registration') {
        message = `🟢 Новая регистрация\n👻 ЭХО\n${player}`;
      } else if (kind === 'purchase') {
        message = `💰 Покупка\n👻 ЭХО\n${player}\nТовар: ${safe(product)}\nСумма: ${safe(amount)} ${safe(currency)}`;
      } else if (kind === 'video') {
        message = `📺 Видео за награду\n👻 ЭХО\n${player}\nЦель: ${safe(context || 'Задание с рекламой')}`;
      } else return;

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) console.warn('[game-monitor] Telegram HTTP', response.status);
    } catch {
      console.warn('[game-monitor] Telegram notification failed');
    }
  })();
}

module.exports = { notifyGameMonitor };

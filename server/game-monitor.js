'use strict';
// Private, best-effort Telegram notices for the game owner.
// Do not use this for client-side clicks, test purchases or ad-free claims.

const https = require('node:https');

// Use a trusted SOCKS5 proxy for Telegram if direct access is blocked.
function sendTelegram(token, chatId, message) {
  const payload = JSON.stringify({ chat_id: chatId, text: message });
  const proxy = String(process.env.GAME_MONITOR_PROXY_URL || '').trim();
  if (proxy && !/^socks5h?:\/\//i.test(proxy)) {
    throw new Error('GAME_MONITOR_PROXY_URL must start with socks5h://');
  }
  const agent = proxy ? new (require('socks-proxy-agent').SocksProxyAgent)(proxy) : undefined;
  return new Promise((resolve, reject) => {
    const request = https.request('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 9000
    }, response => {
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length < 4096) chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        let result = null;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        if (response.statusCode === 200 && result?.ok === true) resolve();
        else {
          const error = new Error('Telegram rejected message');
          error.code = 'HTTP_' + response.statusCode;
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      const error = new Error('Telegram connection timeout');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const safe = value => String(value ?? '').replace(/[\r\n\t<>\x00-\x1f]/g, ' ').slice(0, 160);

function notifyGameMonitor(kind, { accountId, product, amount, currency, context } = {}) {
  const token = process.env.GAME_MONITOR_BOT_TOKEN;
  const chatId = process.env.GAME_MONITOR_CHAT_ID;
  if (!token || !chatId) return;

  void (async () => {
    try {
      const { pool } = require("./db");
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

      await sendTelegram(token, chatId, message);
      console.info('[game-monitor] delivered', kind);
    } catch (error) {
      console.warn('[game-monitor] Telegram notification failed:', String(error?.code || error?.name || 'error'))
    }
  })();
}

module.exports = { notifyGameMonitor };

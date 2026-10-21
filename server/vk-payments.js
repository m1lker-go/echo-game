'use strict';
const crypto = require('node:crypto');

const PREMIUM_PREFIX = 'echo_premium_pack_';
const PREMIUM_PRICE = 40;
const PRODUCT_ID = '1';
const VK_APP_ID = String(process.env.VK_MINI_APP_ID || '');
const VK_SECRET = process.env.VK_MINI_APP_SECRET || '';
const enabled = () => /^\d+$/.test(VK_APP_ID) && VK_SECRET.length > 8 &&
  !VK_SECRET.startsWith('REPLACE_WITH_');

function verifyNotification(body, appId = VK_APP_ID, secret = VK_SECRET) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.sig !== 'string' || !/^[a-f0-9]{32}$/i.test(body.sig) ||
      String(body.app_id) !== String(appId) || !secret) return false;
  const keys = Object.keys(body).filter(k => k !== 'sig').sort();
  if (keys.some(k => !/^[a-z_]+$/i.test(k) ||
      !['string','number'].includes(typeof body[k]))) return false;
  const payload = keys.map(k => k + '=' + String(body[k])).join('');
  const actual = crypto.createHash('md5').update(payload + secret).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(body.sig.toLowerCase()));
}
const validVKUser = value => /^[1-9]\d{0,19}$/.test(String(value || ''));
const validOrder = value => /^[1-9]\d{0,19}$/.test(String(value || '')) &&
  Number.isSafeInteger(Number(value));
const productFromItem = value => {
  const match = typeof value === 'string' &&
    /^echo_premium_pack_([0-9a-f]{32})$/.exec(value);
  return match ? match[1] : null;
};
const vkError = (res, code, message, critical = true) =>
  res.json({ error: { error_code: code, error_msg: message, critical } });

function createVKPayments({ pool, sessionUser, rollSecurePack, createRouter = () => require('express').Router() }) {
  // A router factory lets CI check complete VK callbacks without dependencies.
  const router = createRouter();
  let schemaReady = false;
  const trace = (type, result) => console.info('[echo vk callback]', { type: String(type || 'unknown').slice(0,40), result });


  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS echo_vk_payment_intents (
      id TEXT PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES echo_accounts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
      status TEXT NOT NULL DEFAULT 'pending'
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS echo_vk_payments (
      app_order_id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL,
      is_test BOOLEAN NOT NULL,
      intent_id TEXT NOT NULL UNIQUE REFERENCES echo_vk_payment_intents(id),
      account_id UUID NOT NULL REFERENCES echo_accounts(id),
      price INTEGER NOT NULL,
      cards JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_id, is_test)
    )`);
    schemaReady = true;
  }

  router.get('/', (_req, res) => res.json({
    ok: true, service: 'echo-vk-payments', enabled: enabled(), schemaReady
  }));

  // Each opening of the VK order dialog gets its own server-side purchase ID.
  // An old paid order cannot be mistaken for a new purchase.
  router.post('/intent', async (req, res) => {
    if (!enabled()) return res.status(503).json({ error: 'VK purchases unavailable' });
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const account = await pool.query(
        "SELECT provider_id FROM echo_accounts WHERE id=$1 AND provider='vkid'",
        [user.id]
      );
      if (!validVKUser(account.rows[0]?.provider_id))
        return res.status(403).json({ error: 'VK account required' });
      const id = crypto.randomBytes(16).toString('hex');
      await pool.query('INSERT INTO echo_vk_payment_intents (id, account_id) VALUES ($1,$2)',
        [id, user.id]);
      return res.json({ intentId: id, item: PREMIUM_PREFIX + id, price: PREMIUM_PRICE });
    } catch (error) {
      console.error('[echo vk payment] intent failed:', error.message);
      return res.status(500).json({ error: 'Cannot prepare VK purchase' });
    }
  });

  router.get('/intent/:id', async (req, res) => {
    if (!/^[0-9a-f]{32}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const result = await pool.query(
        `SELECT i.status, p.cards FROM echo_vk_payment_intents i
         LEFT JOIN echo_vk_payments p ON p.intent_id=i.id
         WHERE i.id=$1 AND i.account_id=$2`,
        [req.params.id, user.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
      const order = result.rows[0];
      return res.json({ status: order.status, cards: order.status === 'paid' ? order.cards : null });
    } catch (error) {
      console.error('[echo vk payment] status failed:', error.message);
      return res.status(500).json({ error: 'Order unavailable' });
    }
  });

  // VK sends form-encoded or JSON notifications. No app token/cookie is required;
  // the compulsory signed callback is verified using ECHO's protected app key.
  router.post('/', async (req, res) => {
    const body = req.body;
    const type = typeof body?.notification_type === 'string' ? body.notification_type : 'unknown';
    if (!enabled()) {
      trace(type, 'not_configured');
      return vkError(res, 1, 'ECHO VK payments are not configured');
    }
    if (!verifyNotification(body)) {
      trace(type, 'bad_signature_or_app_id');
      return vkError(res, 10, 'Invalid VK payment signature');
    }
    trace(type, 'verified');
    const isTest = type === 'get_item_test' || type === 'order_status_change_test';
    if (!['get_item','get_item_test','order_status_change','order_status_change_test'].includes(type))
      return vkError(res, 1, 'Unsupported notification');
    const intentId = productFromItem(body.item);
    if (!intentId || !validVKUser(body.user_id)) {
      trace(type, 'invalid_item_or_user');
      return vkError(res, 20, 'Invalid item or user');
    }
    if (type === 'get_item' || type === 'get_item_test') {
      try {
        const result = await pool.query(
          `SELECT a.provider_id FROM echo_vk_payment_intents i
           JOIN echo_accounts a ON a.id=i.account_id
           WHERE i.id=$1 AND i.expires_at>NOW() AND i.status='pending'`,
          [intentId]
        );
        if (!result.rowCount || result.rows[0].provider_id !== String(body.user_id)) {
          trace(type, 'no_matching_pending_intent');
          return vkError(res, 20, 'Item not found for this user');
        }
        trace(type, 'item_found');
        return res.json({ response: {
          item_id: PRODUCT_ID, title: 'ECHO — элитный пак',
          photo_url: 'https://cat-fight.ru/echo/assets/packs/specialcardpic.webp',
          price: PREMIUM_PRICE, expiration: 0
        } });
      } catch (error) {
        trace(type, 'database_error');
        console.error('[echo vk payment] get_item failed:', error.message);
        return vkError(res, 2, 'Temporarily unavailable', false);
      }
    }
    if (!validOrder(body.order_id)) {
      trace(type, 'invalid_order_id');
      return vkError(res, 1, 'Invalid order ID');
    }
    if (body.status !== 'chargeable') {
      trace(type, 'unsupported_payment_status');
      return vkError(res, 1, 'Unsupported payment status');
    }
    // Check the product and actual VK price, not just a success flag.
    if (String(body.item_id || '') !== PRODUCT_ID ||
        String(body.item_price || '') !== String(PREMIUM_PRICE)) {
      trace(type, 'unexpected_item_id_or_price');
      return vkError(res, 20, 'Unexpected product or price');
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT i.id, i.account_id, i.status, a.provider_id
         FROM echo_vk_payment_intents i
         JOIN echo_accounts a ON a.id=i.account_id
         WHERE i.id=$1 AND (i.expires_at>NOW() OR i.status='paid') FOR UPDATE OF i`,
        [intentId]
      );
      const intent = found.rows[0];
      if (!intent || intent.provider_id !== String(body.user_id)) {
        await client.query('ROLLBACK');
        trace(type, 'intent_missing_or_user_mismatch');
        return vkError(res, 22, 'Payment user not found');
      }
      const previous = await client.query(
        'SELECT app_order_id,intent_id,account_id FROM echo_vk_payments WHERE order_id=$1 AND is_test=$2',
        [String(body.order_id), isTest]
      );
      if (previous.rowCount) {
        await client.query('ROLLBACK');
        if (previous.rows[0].intent_id !== intentId ||
            previous.rows[0].account_id !== intent.account_id) {
          trace(type, 'order_id_conflict');
          return vkError(res, 1, 'Order conflict');
        }
        trace(type, 'duplicate_order_acknowledged');
        return res.json({ response: {
          order_id: Number(body.order_id), app_order_id: Number(previous.rows[0].app_order_id)
        } });
      }
      if (intent.status !== 'pending') {
        await client.query('ROLLBACK');
        trace(type, 'intent_already_used');
        return vkError(res, 1, 'Order already used');
      }
      const cards = rollSecurePack('premium');
      const added = await client.query(
        `INSERT INTO echo_vk_payments
         (order_id,is_test,intent_id,account_id,price,cards)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING app_order_id`,
        [String(body.order_id), isTest, intentId, intent.account_id, PREMIUM_PRICE, JSON.stringify(cards)]
      );
      for (const card of cards) {
        await client.query(
          `INSERT INTO echo_hero_collection(account_id,model,fragments) VALUES ($1,$2,$3)
           ON CONFLICT(account_id,model)
           DO UPDATE SET fragments=echo_hero_collection.fragments+EXCLUDED.fragments`,
          [String(intent.account_id), card.model, card.count]
        );
      }
      await client.query(
        "UPDATE echo_vk_payment_intents SET status='paid' WHERE id=$1", [intentId]);
      await client.query('COMMIT');
      trace(type, 'reward_issued');
      console.log('[echo vk payment] fulfilled', { intentId, isTest });
      return res.json({ response: {
        order_id: Number(body.order_id), app_order_id: Number(added.rows[0].app_order_id)
      } });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      trace(type, 'database_or_reward_error');
      console.error('[echo vk payment] charge failed:', error.message);
      return vkError(res, 2, 'Temporarily unavailable', false);
    } finally {
      client?.release();
    }
  });

  return { router, initialize };
}
module.exports = { createVKPayments, verifyNotification, PREMIUM_PRICE };

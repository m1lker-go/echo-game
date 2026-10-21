'use strict';
const crypto = require('node:crypto');

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
// VK's order_status_change item_id is optional. If VK sends it, it must
// match the product ID returned by our get_item callback. The actual signed
// price is mandatory and must still equal 40 votes (including "40.00").
function checkVKOrderProduct(body) {
  const rawId = body?.item_id;
  const hasItemId = rawId !== undefined && rawId !== null &&
    String(rawId).trim() !== '';
  const itemIdMatches = !hasItemId || String(rawId).trim() === PRODUCT_ID;
  const rawPrice = body?.item_price;
  const priceText = typeof rawPrice === 'string' ? rawPrice.trim() :
    typeof rawPrice === 'number' ? String(rawPrice) : '';
  const priceMatches = /^\d+(?:\.\d+)?$/.test(priceText) &&
    Number(priceText) === PREMIUM_PRICE;
  return {
    ok: String(body?.item) === PRODUCT_ID && itemIdMatches && priceMatches,
    hasItemId,
    itemIdMatches,
    hasPrice: priceText.length > 0,
    priceMatches,
  };
}
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
      intent_id TEXT UNIQUE REFERENCES echo_vk_payment_intents(id),
      account_id UUID NOT NULL REFERENCES echo_accounts(id),
      price INTEGER NOT NULL,
      cards JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_id, is_test)
    )`);
    // Preserve existing purchases, and allow a valid VK callback even when
    // its browser-side animation intent has been lost.
    await pool.query('ALTER TABLE echo_vk_payments ALTER COLUMN intent_id DROP NOT NULL');
    schemaReady = true;
  }

  router.get('/', (_req, res) => res.json({
    ok: true, service: 'echo-vk-payments', enabled: enabled(), schemaReady
  }));

  // Animation tracker only: the VK product uses Cat Fighting's static SKU "1".
  // VK never receives or needs the random internal intent ID.
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
      return res.json({ intentId: id, item: PRODUCT_ID, price: PREMIUM_PRICE });
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
    if (!validVKUser(body.user_id)) {
      trace(type, 'invalid_user');
      return vkError(res, 22, 'Invalid VK user');
    }
    if (String(body.item) !== PRODUCT_ID) {
      trace(type, 'unknown_item');
      return vkError(res, 20, 'Item not found');
    }
    // Exactly the Cat Fighting catalog flow: a constant item_id and price.
    if (type === 'get_item' || type === 'get_item_test') {
      trace(type, 'item_found');
      return res.json({ response: {
        item_id: PRODUCT_ID, title: 'ECHO — элитный пак',
        photo_url: 'https://cat-fight.ru/echo/assets/packs/specialcardpic.webp',
        price: PREMIUM_PRICE, expiration: 3600
      } });
    }
    if (!validOrder(body.order_id)) {
      trace(type, 'invalid_order_id');
      return vkError(res, 1, 'Invalid order ID');
    }
    // Cat Fighting acknowledges refunds/cancellations without granting an item.
    if (['refund','refunded','cancelled'].includes(body.status)) {
      trace(type, 'refund_or_cancel_acknowledged');
      return res.json({response:{
        order_id:Number(body.order_id),app_order_id:Number(body.order_id)
      }});
    }
    if (body.status !== 'chargeable') {
      trace(type, 'unsupported_payment_status');
      return vkError(res, 11, 'Unsupported payment status');
    }
    // A valid signed VK charge callback may omit item_id. The price is
    // mandatory; reject wrong prices and any mismatched *supplied* item_id.
    const productCheck = checkVKOrderProduct(body);
    if (!productCheck.ok) {
      trace(type, 'unexpected_item_id_or_price');
      // Log only field presence and comparisons, never payment tokens/IDs.
      console.warn('[echo vk payment] product validation', {
        itemIdPresent: productCheck.hasItemId,
        itemIdMatches: productCheck.itemIdMatches,
        pricePresent: productCheck.hasPrice,
        priceMatches: productCheck.priceMatches,
      });
      return vkError(res, 20, 'Unexpected product or price');
    }

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      // As in Cat Fighting, the signed user_id identifies who receives the
      // product. The account is the same for ECHO website and VK Mini Apps.
      const found = await client.query(
        "SELECT id::text AS id FROM echo_accounts WHERE provider='vkid' AND provider_id=$1 LIMIT 1",
        [String(body.user_id)]
      );
      const accountId = found.rows[0]?.id;
      if (!accountId) {
        await client.query('ROLLBACK');
        trace(type, 'vk_account_not_found');
        return vkError(res, 22, 'VK user not registered');
      }
      const previous = await client.query(
        'SELECT app_order_id,account_id FROM echo_vk_payments WHERE order_id=$1 AND is_test=$2',
        [String(body.order_id), isTest]
      );
      if (previous.rowCount) {
        await client.query('ROLLBACK');
        if (String(previous.rows[0].account_id) !== String(accountId)) {
          trace(type, 'order_id_conflict');
          return vkError(res, 1, 'Order conflict');
        }
        trace(type, 'duplicate_order_acknowledged');
        return res.json({ response: {
          order_id: Number(body.order_id), app_order_id: Number(previous.rows[0].app_order_id)
        } });
      }

      // Only for ECHO's animated reveal; payment must never depend on this
      // extra record because the VK SKU is a fixed "1".
      const pending = await client.query(
        `SELECT id FROM echo_vk_payment_intents
         WHERE account_id=$1 AND status='pending' AND expires_at>NOW()
           AND created_at>NOW()-INTERVAL '15 minutes'
         ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
        [accountId]
      );
      const intentId = pending.rows[0]?.id || null;
      const cards = rollSecurePack('premium');
      const added = await client.query(
        `INSERT INTO echo_vk_payments
         (order_id,is_test,intent_id,account_id,price,cards)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (order_id,is_test) DO NOTHING RETURNING app_order_id`,
        [String(body.order_id), isTest, intentId, accountId, PREMIUM_PRICE, JSON.stringify(cards)]
      );
      if (!added.rowCount) {
        // Another simultaneous callback has already processed this order.
        const duplicate = await client.query(
          'SELECT app_order_id,account_id FROM echo_vk_payments WHERE order_id=$1 AND is_test=$2',
          [String(body.order_id), isTest]
        );
        await client.query('ROLLBACK');
        if (!duplicate.rowCount || String(duplicate.rows[0].account_id) !== String(accountId))
          return vkError(res, 1, 'Order conflict');
        trace(type, 'duplicate_order_acknowledged');
        return res.json({ response: {
          order_id: Number(body.order_id), app_order_id: Number(duplicate.rows[0].app_order_id)
        } });
      }
      for (const card of cards) {
        await client.query(
          `INSERT INTO echo_hero_collection(account_id,model,fragments) VALUES ($1,$2,$3)
           ON CONFLICT(account_id,model)
           DO UPDATE SET fragments=echo_hero_collection.fragments+EXCLUDED.fragments`,
          [accountId, card.model, card.count]
        );
      }
      if (intentId) await client.query(
        "UPDATE echo_vk_payment_intents SET status='paid' WHERE id=$1", [intentId]
      );
      await client.query('COMMIT');
      trace(type, 'reward_issued');
      console.log('[echo vk payment] fulfilled', { isTest, hasIntent: Boolean(intentId) });
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
module.exports = { createVKPayments, verifyNotification, checkVKOrderProduct, PREMIUM_PRICE };

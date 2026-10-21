'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const secret = 'this-is-a-fake-protected-test-key';
const appId = '54838920';
process.env.VK_MINI_APP_ID = appId;
process.env.VK_MINI_APP_SECRET = secret;
const { verifyNotification, PREMIUM_PRICE, createVKPayments, checkVKOrderProduct } = require('../vk-payments');
function signedNotification(fields = {}) {
  const data = {
    notification_type: 'get_item_test',
    app_id: appId,
    user_id: '12345',
    item: 'echo_premium_pack_' + 'a'.repeat(32),
    ...fields,
  };
  const signed = Object.keys(data).sort().map(k => k + '=' + data[k]).join('');
  return { ...data, sig: crypto.createHash('md5').update(signed + secret).digest('hex') };
}

test('VK callback signature accepts an authentic get_item notification', () => {
  assert.equal(verifyNotification(signedNotification(), appId, secret), true);
});
test('VK callback signature accepts valid chargeable notification', () => {
  assert.equal(verifyNotification(signedNotification({
    notification_type: 'order_status_change',
    order_id: '9876', status: 'chargeable', item_id: '1', item_price: 40,
  }), appId, secret), true);
});
test('VK callback rejects other app IDs and modified callback fields', () => {
  const data = signedNotification();
  assert.equal(verifyNotification(data, '54832804', secret), false);
  assert.equal(verifyNotification({ ...data, user_id: '56789' }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, item_price: 1 }, appId, secret), false);
  assert.equal(verifyNotification(data, appId, 'wrong-secret'), false);
});
test('VK callback rejects missing or forged signatures and nonscalar data', () => {
  const data = signedNotification();
  assert.equal(verifyNotification({ ...data, sig: '' }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, sig: 'f'.repeat(32) }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, sig: undefined }, appId, secret), false);
  assert.equal(verifyNotification({ ...data, user_id: { id: '12345' } }, appId, secret), false);
  assert.equal(verifyNotification(null, appId, secret), false);
});
test('ECHO premium pack is priced at 40 VK votes', () => {
  assert.equal(PREMIUM_PRICE, 40);
});


function mockVKCallback(providerId = '12345') {
  const routes = {};
  const pool = {
    async query(sql, params) {
      if (!sql.includes('FROM echo_vk_payment_intents')) throw new Error('unexpected SQL');
      assert.deepEqual(params, ['a'.repeat(32)]);
      return { rowCount: providerId ? 1 : 0, rows: providerId ? [{provider_id: providerId}] : [] };
    }
  };
  createVKPayments({
    pool, sessionUser: async () => null, rollSecurePack: () => [],
    createRouter: () => ({
      get: () => {},
      post(path, handler) { routes[path] = handler; },
    })
  });
  return routes['/'];
}

async function callVKNotification(route, fields) {
  const req = { body: signedNotification(fields) };
  const res = { body: null, json(data) { this.body = data; return this; } };
  await route(req, res);
  return res.body;
}

test('signed VK get_item_test loads elite pack details for authenticated VK user', async () => {
  const response = await callVKNotification(mockVKCallback(), {
    order_id: '555', receiver_id: '12345', lang: 'ru_RU'
  });
  assert.equal(response.response.title, 'ECHO — элитный пак');
  assert.equal(response.response.item_id, '1');
  assert.equal(response.response.price, 40);
  assert.equal(response.response.expiration, 0);
  assert.ok(response.response.photo_url.startsWith('https://cat-fight.ru/echo/'));
});

test('signed VK get_item rejects a product intent belonging to another user', async () => {
  const response = await callVKNotification(mockVKCallback('65432'), { order_id: '555' });
  assert.equal(response.error.error_code, 20);
});

test('VK callbacks cannot bypass verification to fetch item info', async () => {
  const handler = mockVKCallback();
  const req = { body: { ...signedNotification(), user_id: '98765' } };
  const res = { json(data) { this.body = data; return this; } };
  await handler(req, res);
  assert.equal(res.body.error.error_code, 10);
});

test('signed VK order may omit item_id but must still have exact 40-vote price', () => {
  for(const price of ['40', '40.0', '40.00', 40]) {
    assert.equal(checkVKOrderProduct({item_price: price}).ok, true);
    assert.equal(checkVKOrderProduct({item_id: '1',item_price: price}).ok, true);
  }
  for(const itemPrice of [undefined, '', '0', '39', '41', '40.01', '4e1', '40 RUB', 'Infinity']) {
    assert.equal(checkVKOrderProduct({item_price:itemPrice}).ok, false);
  }
  assert.equal(checkVKOrderProduct({item_id:'2',item_price:40}).ok, false);
  assert.equal(checkVKOrderProduct({item_id:'echo_premium_pack_invalid',item_price:40}).ok, false);
});

test('real VK test charge without item_id grants one pack and acknowledges retry without duplicate cards', async () => {
  const routes={};
  const accountId='123e4567-e89b-42d3-a456-426614174000';
  let paid=null;
  let inserts=0;
  let granted=0;
  const pool={
    async connect() {
      return {
        release(){},
        async query(sql,params=[]) {
          if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
          if(sql.includes('FROM echo_vk_payment_intents i')&&sql.includes('FOR UPDATE OF i')) {
            return {rowCount:1,rows:[{id:'a'.repeat(32),account_id:accountId,status:paid?'paid':'pending',provider_id:'12345'}]};
          }
          if(sql.includes('FROM echo_vk_payments WHERE order_id=')) {
            return paid?{rowCount:1,rows:[{app_order_id:'42',intent_id:'a'.repeat(32),account_id:accountId}]}:{rowCount:0,rows:[]};
          }
          if(sql.includes('INSERT INTO echo_vk_payments')) {
            inserts++;
            paid={app_order_id:'42'};
            return {rowCount:1,rows:[{app_order_id:'42'}]};
          }
          if(sql.includes('INSERT INTO echo_hero_collection')) {
            granted++;
            return {rowCount:1,rows:[]};
          }
          if(sql.includes('UPDATE echo_vk_payment_intents'))return {rowCount:1,rows:[]};
          throw Error('Unexpected query '+sql.slice(0,100));
        }
      };
    }
  };
  const cards=Array.from({length:5},(_,i)=>({model:'character-female-a.glb',count:i+1}));
  createVKPayments({
    pool,sessionUser:async()=>null,rollSecurePack:()=>cards,
    createRouter:()=>({get(){},post(path,handler){routes[path]=handler}})
  });
  const fields={
    notification_type:'order_status_change_test',
    order_id:'9876',
    status:'chargeable',
    item_price:'40.00',
  };
  const response=await callVKNotification(routes['/'],fields);
  assert.deepEqual(response,{response:{order_id:9876,app_order_id:42}});
  assert.equal(inserts,1);
  assert.equal(granted,5);
  const second=await callVKNotification(routes['/'],fields);
  assert.deepEqual(second,response);
  assert.equal(inserts,1);
  assert.equal(granted,5);
});

test('signed price mismatch never enters payment database',async()=>{
  const routes={};
  createVKPayments({
    pool:{connect(){throw Error('Payment DB must not be accessed');}},
    sessionUser:async()=>null,rollSecurePack:()=>[],
    createRouter:()=>({get(){},post(path,handler){routes[path]=handler}})
  });
  const result=await callVKNotification(routes['/'],{
    notification_type:'order_status_change_test',order_id:'9876',
    status:'chargeable',item_price:'39.99'
  });
  assert.equal(result.error.error_code,20);
});

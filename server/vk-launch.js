'use strict';
const crypto = require('node:crypto');

// VK Mini Apps signs all vk_* launch parameters using the app's protected key.
// The browser never receives that key.
function verifyVKMiniAppLaunch(params, secret, expectedAppId) {
  if (!params || typeof params !== 'object' || Array.isArray(params) ||
      typeof secret !== 'string' || !secret ||
      String(params.vk_app_id) !== String(expectedAppId) ||
      typeof params.vk_user_id !== 'string' || !/^[1-9]\d*$/.test(params.vk_user_id) ||
      typeof params.sign !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(params.sign)) {
    return false;
  }

  const keys = Object.keys(params).filter(key => key.startsWith('vk_')).sort();
  if (!keys.length || keys.some(key => typeof params[key] !== 'string')) return false;
  const signedQuery = keys.map(key => key + '=' + encodeURIComponent(params[key])).join('&');
  const signature = crypto.createHmac('sha256', secret)
    .update(signedQuery).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(params.sign));
}

module.exports = { verifyVKMiniAppLaunch };

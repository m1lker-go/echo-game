'use strict';
// Shared only by the two server processes on the same VPS; never shipped to clients.
// Environment overrides allow moving the games to separate hosts later.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(__dirname, '.partner-shared-secret');
function getPartnerSecret() {
  const configured = String(process.env.ECHO_PARTNER_SHARED_SECRET || '').trim();
  if (configured.length >= 32) return configured;
  try {
    // Atomic, non-overwriting first creation. Keep across git reset/deploys.
    try { fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), {mode:0o600,flag:'wx'}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    console.error('[partner-code] key file unavailable; cross-game activation disabled:',error.code||error.message);
    return '';
  }
}
module.exports={getPartnerSecret};

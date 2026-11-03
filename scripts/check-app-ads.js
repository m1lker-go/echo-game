#!/usr/bin/env node
'use strict';

// ECHO and Cat Fighting share one developer domain. The published app-ads.txt
// lives at the domain root, not at /echo/app-ads.txt.
// This is a read-only check: it NEVER changes the other game's files.
const URL_TO_CHECK = process.env.ECHO_APP_ADS_URL || 'https://cat-fight.ru/app-ads.txt';
const REQUIRED = [
  ['ads.vk.com', '30961603', 'DIRECT'],
  ['target.vk.ru', '30961603', 'DIRECT']
];

function parseRecords(source) {
  const records = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const fields = line.split(',').map(field => field.trim());
    if (fields.length < 3 || fields.length > 4) continue;
    if (!/^[a-z0-9.-]+$/i.test(fields[0])) continue;
    if (!fields[1] || !/^(DIRECT|RESELLER)$/i.test(fields[2])) continue;
    records.push(fields.slice(0, 3).map((field, index) => index === 2 ? field.toUpperCase() : field.toLowerCase()));
  }
  return records;
}

async function check() {
  const res = await fetch(URL_TO_CHECK, {
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
    headers: { 'Accept': 'text/plain' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + URL_TO_CHECK);
  const body = await res.text();
  if (!body.trim() || /<!doctype html|<html/i.test(body)) {
    throw new Error('Expected plain app-ads.txt; received an empty file or HTML page');
  }
  const records = parseRecords(body);
  if (!records.length) throw new Error('No valid app-ads.txt seller records found');
  const missing = REQUIRED.filter(wanted => !records.some(record =>
    record.length === 3 && record.every((field, i) => field === (i === 2 ? wanted[i] : wanted[i].toLowerCase()))
  ));
  if (missing.length) {
    throw new Error('Missing VK seller records: ' + missing.map(record => record.join(', ')).join(' | '));
  }
  console.log('OK:', URL_TO_CHECK, '-', records.length, 'valid seller records; VK entries found');
}

if (require.main === module) {
  check().catch(error => {
    console.error('FAIL: app-ads.txt check:', error.message);
    process.exitCode = 1;
  });
}
module.exports = { parseRecords };

'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const INCLUDE = 'artists,albums,albums.coverArt';
const STALE_ID = '241512492';

function parseEnvFile(pathname) {
  const values = {};
  for (const rawLine of fs.readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function getAccessToken() {
  const env = parseEnvFile(ENV_FILE);
  const refreshToken = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.TIDAL_CLIENT_ID || '',
      refresh_token: refreshToken
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error('TIDAL token refresh failed');
  return String(payload.access_token);
}

async function request(token, path) {
  const started = Date.now();
  const response = await fetch(API_BASE + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.api+json' }
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ms: Date.now() - started, payload };
}

async function collectRelationshipIds(token, wanted) {
  const ids = [];
  let next = '/userCollectionTracks/me/relationships/items?countryCode=GB';
  const seen = new Set();
  while (next && ids.length < wanted) {
    if (seen.has(next)) throw new Error('Relationship pagination repeated a URL');
    seen.add(next);
    const result = await request(token, next);
    if (result.status !== 200) throw new Error('Relationship pagination failed with HTTP ' + result.status);
    const data = Array.isArray(result.payload?.data) ? result.payload.data : [];
    ids.push(...data.map(item => String(item?.id || '')).filter(Boolean));
    next = result.payload?.links?.next || null;
  }
  return ids.slice(0, wanted);
}

function bulkPath(ids) {
  return '/tracks?filter%5Bid%5D=' + encodeURIComponent(ids.join(',')) +
    '&include=' + encodeURIComponent(INCLUDE) + '&countryCode=GB';
}

function summarize(label, requestedIds, result) {
  const data = Array.isArray(result.payload?.data) ? result.payload.data : [];
  const returnedIds = data.map(item => String(item?.id || ''));
  const included = Array.isArray(result.payload?.included) ? result.payload.included : [];
  const includedTypes = {};
  for (const item of included) {
    const type = String(item?.type || 'unknown');
    includedTypes[type] = (includedTypes[type] || 0) + 1;
  }
  return {
    label,
    status: result.status,
    ms: result.ms,
    requestedCount: requestedIds.length,
    returnedCount: returnedIds.length,
    missingRequestedIds: requestedIds.filter(id => !returnedIds.includes(id)),
    sameReturnedOrderAsRequestedSubset: returnedIds.every((id, index) => id === requestedIds.filter(requested => returnedIds.includes(requested))[index]),
    includedCount: included.length,
    includedTypes,
    errors: result.payload?.errors || null
  };
}

async function main() {
  console.log('READ-ONLY TIDAL bulk track batch-size and stale-ID probe');
  const token = await getAccessToken();
  const ids = await collectRelationshipIds(token, 100);
  console.log(JSON.stringify({ relationshipIdsCollected: ids.length }, null, 2));

  for (const size of [20, 50, 100]) {
    const requested = ids.slice(0, size);
    const result = await request(token, bulkPath(requested));
    console.log(JSON.stringify(summarize('bulk ' + size, requested, result), null, 2));
  }

  const mixed = [ids[0], ids[1], STALE_ID, ids[2], ids[3]].filter(Boolean);
  const mixedResult = await request(token, bulkPath(mixed));
  console.log(JSON.stringify(summarize('mixed live + known stale', mixed, mixedResult), null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const COUNTRY_CODE = 'GB';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';

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
  const clientId = String(env.TIDAL_CLIENT_ID || '').trim();
  const refreshToken = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim();
  if (!clientId || !refreshToken) throw new Error('Missing TIDAL credentials');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error('TIDAL token refresh failed');
  return String(payload.access_token);
}

async function timedGet(token, path) {
  const started = Date.now();
  const response = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.api+json' }
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ms: Date.now() - started, payload };
}

function summarize(label, result) {
  const data = Array.isArray(result.payload?.data) ? result.payload.data : result.payload?.data ? [result.payload.data] : [];
  const included = Array.isArray(result.payload?.included) ? result.payload.included : [];
  const includedTypes = {};
  for (const item of included) includedTypes[item?.type || 'unknown'] = (includedTypes[item?.type || 'unknown'] || 0) + 1;
  const firstTrack = data.find(item => item?.type === 'tracks') || included.find(item => item?.type === 'tracks') || null;
  return {
    label,
    status: result.status,
    ms: result.ms,
    dataCount: data.length,
    includedCount: included.length,
    includedTypes,
    hasNext: Boolean(result.payload?.links?.next),
    next: result.payload?.links?.next || null,
    firstTrack: firstTrack ? {
      id: String(firstTrack.id || ''),
      attributeKeys: Object.keys(firstTrack.attributes || {}),
      relationshipKeys: Object.keys(firstTrack.relationships || {})
    } : null,
    errors: result.payload?.errors || null
  };
}

async function main() {
  console.log('READ-ONLY Favourite Tracks official API shape/performance probe');
  const token = await getAccessToken();
  const tests = [
    ['relationship default', '/userCollectionTracks/me/relationships/items?countryCode=GB'],
    ['relationship page 50', '/userCollectionTracks/me/relationships/items?countryCode=GB&page%5Blimit%5D=50'],
    ['relationship page 100', '/userCollectionTracks/me/relationships/items?countryCode=GB&page%5Blimit%5D=100'],
    ['collection include items', '/userCollectionTracks/me?include=items&countryCode=GB'],
    ['collection include rich items', '/userCollectionTracks/me?include=' + encodeURIComponent('items,items.artists,items.albums,items.albums.coverArt') + '&countryCode=GB'],
    ['collection rich page 50', '/userCollectionTracks/me?include=' + encodeURIComponent('items,items.artists,items.albums,items.albums.coverArt') + '&countryCode=GB&page%5Blimit%5D=50'],
    ['collection rich page 100', '/userCollectionTracks/me?include=' + encodeURIComponent('items,items.artists,items.albums,items.albums.coverArt') + '&countryCode=GB&page%5Blimit%5D=100']
  ];
  const results = [];
  for (const [label, path] of tests) {
    const result = await timedGet(token, path);
    results.push(summarize(label, result));
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const INCLUDE = 'items,items.artists,items.albums,items.albums.coverArt';

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

async function token() {
  const env = parseEnvFile(ENV_FILE);
  const refreshToken = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.TIDAL_CLIENT_ID || '', refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error('TIDAL token refresh failed');
  return String(payload.access_token);
}

async function get(accessToken, path) {
  const url = /^https?:\/\//.test(path) ? path : API_BASE + (path.startsWith('/') ? path : '/' + path);
  const started = Date.now();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.api+json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TIDAL ${response.status}: ${JSON.stringify(payload.errors || payload)}`);
  return { payload, ms: Date.now() - started };
}

function summarizeIncluded(included) {
  const list = Array.isArray(included) ? included : [];
  const types = {};
  for (const item of list) types[item?.type || 'unknown'] = (types[item?.type || 'unknown'] || 0) + 1;
  return {
    count: list.length,
    types,
    trackIds: list.filter(item => item?.type === 'tracks').map(item => String(item.id || ''))
  };
}

function summarizePage(label, result) {
  const root = result.payload?.data && !Array.isArray(result.payload.data) ? result.payload.data : null;
  const items = root?.relationships?.items || null;
  return {
    label,
    ms: result.ms,
    relationshipDataCount: Array.isArray(items?.data) ? items.data.length : items?.data ? 1 : 0,
    self: items?.links?.self || null,
    next: items?.links?.next || null,
    included: summarizeIncluded(result.payload?.included)
  };
}

function collectionPathFromNext(next) {
  if (!next) return null;
  const parsed = new URL(next, API_BASE);
  const cursor = parsed.searchParams.get('page[cursor]');
  if (!cursor) return null;
  return '/userCollectionTracks/me?include=' + encodeURIComponent(INCLUDE) + '&countryCode=GB&page%5Bcursor%5D=' + encodeURIComponent(cursor);
}

async function main() {
  console.log('READ-ONLY Favourite Tracks rich pagination probe');
  const accessToken = await token();
  const firstPath = '/userCollectionTracks/me?include=' + encodeURIComponent(INCLUDE) + '&countryCode=GB';
  const first = await get(accessToken, firstPath);
  const firstSummary = summarizePage('PAGE 1', first);
  console.log(JSON.stringify(firstSummary, null, 2));

  const secondPath = collectionPathFromNext(firstSummary.next);
  if (!secondPath) {
    console.log('NO USABLE NEXT CURSOR AFTER PAGE 1; stopping read-only probe.');
    return;
  }
  const second = await get(accessToken, secondPath);
  const secondSummary = summarizePage('PAGE 2', second);
  console.log(JSON.stringify(secondSummary, null, 2));

  const thirdPath = collectionPathFromNext(secondSummary.next);
  if (!thirdPath) {
    console.log('NO USABLE NEXT CURSOR AFTER PAGE 2; stopping read-only probe.');
    return;
  }
  const third = await get(accessToken, thirdPath);
  const thirdSummary = summarizePage('PAGE 3', third);
  console.log(JSON.stringify(thirdSummary, null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

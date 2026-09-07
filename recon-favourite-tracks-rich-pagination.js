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

function linkSummary(value) {
  if (!value || typeof value !== 'object') return value || null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => ['self', 'related', 'next', 'prev', 'first', 'last'].includes(key)));
}

function summarizeIncluded(included) {
  const list = Array.isArray(included) ? included : [];
  const types = {};
  for (const item of list) types[item?.type || 'unknown'] = (types[item?.type || 'unknown'] || 0) + 1;
  return { count: list.length, types, trackIds: list.filter(item => item?.type === 'tracks').map(item => String(item.id || '')) };
}

async function main() {
  console.log('READ-ONLY Favourite Tracks rich pagination probe');
  const accessToken = await token();
  const rootPath = '/userCollectionTracks/me?include=' + encodeURIComponent(INCLUDE) + '&countryCode=GB';
  const first = await get(accessToken, rootPath);
  const root = first.payload?.data && !Array.isArray(first.payload.data) ? first.payload.data : null;
  const items = root?.relationships?.items || null;
  console.log('ROOT');
  console.log(JSON.stringify({
    ms: first.ms,
    rootRelationshipKeys: Object.keys(root?.relationships || {}),
    itemsRelationship: items ? {
      dataCount: Array.isArray(items.data) ? items.data.length : items.data ? 1 : 0,
      links: linkSummary(items.links),
      meta: items.meta || null
    } : null,
    included: summarizeIncluded(first.payload?.included)
  }, null, 2));

  const related = items?.links?.related || '';
  if (!related) {
    console.log('NO RELATED ITEMS LINK; stopping read-only probe.');
    return;
  }

  const separator = related.includes('?') ? '&' : '?';
  const richRelated = related + separator + 'include=' + encodeURIComponent('artists,albums,albums.coverArt') + '&countryCode=GB';
  const page1 = await get(accessToken, richRelated);
  console.log('RELATED PAGE 1');
  console.log(JSON.stringify({
    ms: page1.ms,
    dataCount: Array.isArray(page1.payload?.data) ? page1.payload.data.length : 0,
    links: linkSummary(page1.payload?.links),
    included: summarizeIncluded(page1.payload?.included)
  }, null, 2));

  const next = page1.payload?.links?.next || '';
  if (!next) {
    console.log('NO NEXT LINK ON RELATED PAGE; stopping read-only probe.');
    return;
  }
  const nextSeparator = next.includes('?') ? '&' : '?';
  const richNext = next + nextSeparator + 'include=' + encodeURIComponent('artists,albums,albums.coverArt');
  const page2 = await get(accessToken, richNext);
  console.log('RELATED PAGE 2');
  console.log(JSON.stringify({
    ms: page2.ms,
    dataCount: Array.isArray(page2.payload?.data) ? page2.payload.data.length : 0,
    links: linkSummary(page2.payload?.links),
    included: summarizeIncluded(page2.payload?.included)
  }, null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

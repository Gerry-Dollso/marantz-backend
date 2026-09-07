'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const ROOT_INCLUDE = 'items,items.artists,items.albums,items.albums.coverArt';
const REL_INCLUDE = 'artists,albums,albums.coverArt';

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
  return { status: response.status, payload, ms: Date.now() - started };
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

function addQuery(path, key, value) {
  const parsed = new URL(path, API_BASE);
  parsed.searchParams.set(key, value);
  return parsed.pathname + '?' + parsed.searchParams.toString();
}

function summarizeRelationshipPage(label, result) {
  const data = Array.isArray(result.payload?.data) ? result.payload.data : [];
  return {
    label,
    status: result.status,
    ms: result.ms,
    dataCount: data.length,
    firstIds: data.slice(0, 5).map(item => String(item?.id || '')),
    next: result.payload?.links?.next || null,
    included: summarizeIncluded(result.payload?.included),
    errors: result.payload?.errors || null
  };
}

async function main() {
  console.log('READ-ONLY Favourite Tracks relationship cursor metadata probe');
  const accessToken = await token();

  const rootPath = '/userCollectionTracks/me?include=' + encodeURIComponent(ROOT_INCLUDE) + '&countryCode=GB';
  const rootResult = await get(accessToken, rootPath);
  if (rootResult.status !== 200) throw new Error(`Root request failed with ${rootResult.status}`);
  const root = rootResult.payload?.data && !Array.isArray(rootResult.payload.data) ? rootResult.payload.data : null;
  const items = root?.relationships?.items || null;
  const firstNext = items?.links?.next || null;
  console.log(JSON.stringify({
    label: 'ROOT PAGE 1',
    status: rootResult.status,
    ms: rootResult.ms,
    relationshipDataCount: Array.isArray(items?.data) ? items.data.length : 0,
    firstIds: Array.isArray(items?.data) ? items.data.slice(0, 5).map(item => String(item?.id || '')) : [],
    next: firstNext,
    included: summarizeIncluded(rootResult.payload?.included)
  }, null, 2));

  if (!firstNext) {
    console.log('NO NEXT RELATIONSHIP CURSOR; stopping read-only probe.');
    return;
  }

  const page2Path = addQuery(firstNext, 'include', REL_INCLUDE);
  const page2 = await get(accessToken, page2Path);
  const page2Summary = summarizeRelationshipPage('RELATIONSHIP PAGE 2 + include', page2);
  console.log(JSON.stringify(page2Summary, null, 2));

  if (page2.status !== 200 || !page2Summary.next) return;

  const page3Path = addQuery(page2Summary.next, 'include', REL_INCLUDE);
  const page3 = await get(accessToken, page3Path);
  console.log(JSON.stringify(summarizeRelationshipPage('RELATIONSHIP PAGE 3 + include', page3), null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

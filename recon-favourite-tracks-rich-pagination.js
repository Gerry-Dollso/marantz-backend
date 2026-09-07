'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const IDS = ['487926786', '430143675', '513907656', '125226', '501665'];
const INCLUDE = 'artists,albums,albums.coverArt';

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

function summarize(label, result) {
  const data = Array.isArray(result.payload?.data) ? result.payload.data : [];
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
    dataCount: data.length,
    dataIds: data.map(item => String(item?.id || '')),
    includedCount: included.length,
    includedTypes,
    errors: result.payload?.errors || null
  };
}

async function main() {
  console.log('READ-ONLY TIDAL bulk track metadata probe');
  const token = await getAccessToken();
  const include = encodeURIComponent(INCLUDE);
  const commaIds = encodeURIComponent(IDS.join(','));
  const repeatedFilters = IDS.map(id => 'filter%5Bid%5D=' + encodeURIComponent(id)).join('&');
  const tests = [
    ['comma filter[id]', '/tracks?filter%5Bid%5D=' + commaIds + '&include=' + include + '&countryCode=GB'],
    ['repeated filter[id]', '/tracks?' + repeatedFilters + '&include=' + include + '&countryCode=GB'],
    ['comma ids', '/tracks?ids=' + commaIds + '&include=' + include + '&countryCode=GB']
  ];
  for (const [label, path] of tests) {
    console.log(JSON.stringify(summarize(label, await request(token, path)), null, 2));
  }
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

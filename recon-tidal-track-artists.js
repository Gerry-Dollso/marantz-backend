'use strict';

const fs = require('fs');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const COUNTRY_CODE = 'GB';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const TRACK_IDS = ['125226', '161317', '1404361', '77638341'];

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
  if (!clientId) throw new Error('TIDAL_CLIENT_ID is missing');
  if (!refreshToken) throw new Error('TIDAL refresh token is missing');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error('TIDAL token refresh failed');
  return String(payload.access_token);
}

async function tidalGet(accessToken, path) {
  const response = await fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.api+json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.detail || `HTTP ${response.status}`;
    throw new Error(`TIDAL ${response.status}: ${detail}`);
  }
  return payload;
}

function compactResource(resource) {
  return {
    type: String(resource?.type || ''),
    id: String(resource?.id || ''),
    attributes: resource?.attributes || {},
    relationships: resource?.relationships || {}
  };
}

async function main() {
  console.log('READ-ONLY TIDAL track artist relationship probe');
  const accessToken = await getAccessToken();
  for (const id of TRACK_IDS) {
    const payload = await tidalGet(
      accessToken,
      '/tracks/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent('artists,albums') +
      '&countryCode=' + encodeURIComponent(COUNTRY_CODE)
    );
    const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
    const included = Array.isArray(payload?.included) ? payload.included : [];
    const artistLinks = Array.isArray(root?.relationships?.artists?.data)
      ? root.relationships.artists.data
      : root?.relationships?.artists?.data
        ? [root.relationships.artists.data]
        : [];
    const artistResources = included.filter(item => item?.type === 'artists');
    const albumResources = included.filter(item => item?.type === 'albums');
    console.log('\nTRACK ' + id);
    console.log(JSON.stringify({
      root: compactResource(root),
      artistRelationshipOrder: artistLinks.map(link => ({ type: link.type, id: String(link.id || '') })),
      includedArtists: artistResources.map(compactResource),
      includedAlbums: albumResources.map(compactResource)
    }, null, 2));
  }
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

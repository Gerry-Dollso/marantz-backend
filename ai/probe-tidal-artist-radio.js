'use strict';

const TOKEN_URL = 'https://login.tidal.com/oauth2/token';
const API_BASE = 'https://openapi.tidal.com/v2';
const DEFAULT_ARTIST_ID = '64520';

async function main() {
  const clientId = String(process.env.TIDAL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.TIDAL_CLIENT_SECRET || '').trim();
  const artistId = String(process.argv[2] || DEFAULT_ARTIST_ID).trim();

  if (!clientId || !clientSecret) {
    throw new Error('TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET are not available in this process');
  }
  if (!/^\d+$/.test(artistId)) {
    throw new Error('Artist ID must be numeric');
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(`Token request failed: ${tokenPayload.error_description || tokenPayload.error || `HTTP ${tokenResponse.status}`}`);
  }

  const url = `${API_BASE}/artists/${encodeURIComponent(artistId)}/relationships/radio?countryCode=GB`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      Accept: 'application/vnd.api+json'
    }
  });
  const payload = await response.json().catch(() => ({}));

  const safeSummary = {
    artistId,
    httpStatus: response.status,
    ok: response.ok,
    dataType: Array.isArray(payload?.data) ? 'array' : typeof payload?.data,
    itemCount: Array.isArray(payload?.data) ? payload.data.length : (payload?.data ? 1 : 0),
    data: payload?.data || null,
    errors: payload?.errors || null,
    links: payload?.links || null,
    meta: payload?.meta || null
  };

  console.log(JSON.stringify(safeSummary, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(`TIDAL artist radio probe failed: ${error.message}`);
  process.exitCode = 1;
});

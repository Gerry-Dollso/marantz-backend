'use strict';

const TOKEN_URL = 'https://login.tidal.com/oauth2/token';
const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

function createTidalMetadataClient(options = {}) {
  const clientId = String(options.clientId || process.env.TIDAL_CLIENT_ID || '').trim();
  const clientSecret = String(options.clientSecret || process.env.TIDAL_CLIENT_SECRET || '').trim();
  const countryCode = String(options.countryCode || 'GB').trim() || 'GB';

  let cachedToken = '';
  let tokenExpiresAt = 0;
  let tokenPromise = null;

  function assertConfigured() {
    if (!clientId || !clientSecret) {
      throw new Error('TIDAL metadata credentials are not configured');
    }
  }

  async function requestToken() {
    assertConfigured();

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
      throw new Error(`TIDAL token request failed: ${detail}`);
    }

    cachedToken = String(payload.access_token);
    const expiresInMs = Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    tokenExpiresAt = Date.now() + expiresInMs;
    return cachedToken;
  }

  async function getToken() {
    if (
      cachedToken &&
      Date.now() < tokenExpiresAt - TOKEN_REFRESH_SKEW_MS
    ) {
      return cachedToken;
    }

    if (!tokenPromise) {
      tokenPromise = requestToken().finally(() => {
        tokenPromise = null;
      });
    }

    return tokenPromise;
  }

  async function apiGet(path) {
    let token = await getToken();

    const makeRequest = () => fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.api+json'
      }
    });

    let response = await makeRequest();

    if (response.status === 401) {
      cachedToken = '';
      tokenExpiresAt = 0;
      token = await getToken();
      response = await makeRequest();
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        payload?.errors?.[0]?.detail ||
        payload?.detail ||
        `HTTP ${response.status}`;
      throw new Error(`TIDAL API request failed: ${detail}`);
    }

    return payload;
  }

  async function getTrackArtists(mid) {
    const trackId = String(mid || '').trim();
    if (!/^\d+$/.test(trackId)) {
      throw new Error('Invalid TIDAL track id');
    }

    const payload = await apiGet(
      `/tracks/${encodeURIComponent(trackId)}?countryCode=${encodeURIComponent(countryCode)}&include=artists`
    );

    const relationship = Array.isArray(payload?.data?.relationships?.artists?.data)
      ? payload.data.relationships.artists.data
      : [];

    const includedArtists = new Map(
      (Array.isArray(payload?.included) ? payload.included : [])
        .filter(item => item?.type === 'artists' && item?.id)
        .map(item => [String(item.id), item])
    );

    const artists = relationship.map(item => {
      const id = String(item?.id || '');
      const included = includedArtists.get(id);
      return {
        id,
        cid: id ? `LIBARTIST-${id}` : '',
        name: String(included?.attributes?.name || '')
      };
    }).filter(artist => artist.id);

    return {
      trackId,
      title: String(payload?.data?.attributes?.title || ''),
      artists
    };
  }

  return {
    getTrackArtists
  };
}

module.exports = {
  createTidalMetadataClient
};

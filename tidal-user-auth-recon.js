'use strict';

const crypto = require('crypto');
const fs = require('fs');

const AUTHORIZE_URL = 'https://login.tidal.com/authorize';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const API_BASE = 'https://openapi.tidal.com/v2';
const DEFAULT_REDIRECT_URI = 'http://192.168.50.145:3100/api/tidal/oauth/callback';
const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read', 'search.read'];
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token'; // TIDAL_PERSISTENT_REFRESH_AUTH_V1

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createVerifier() {
  return base64Url(crypto.randomBytes(48));
}

function createChallenge(verifier) {
  return base64Url(
    crypto.createHash('sha256').update(verifier, 'ascii').digest()
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
  return true;
}

function sendHtml(res, statusCode, title, message) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${title}</title></head><body style="font-family:sans-serif;padding:2rem">` +
    `<h1>${title}</h1><p>${message}</p></body></html>`
  );
}

function simplifyResource(resource) {
  if (!resource || typeof resource !== 'object') return null;
  const attributes = resource.attributes || {};
  return {
    id: String(resource.id || ''),
    type: String(resource.type || ''),
    name: String(
      attributes.name ||
      attributes.title ||
      attributes.mixName ||
      ''
    ),
    relationshipKeys: resource.relationships
      ? Object.keys(resource.relationships)
      : []
  };
}

function summarisePayload(payload) {
  const data = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data
      ? [payload.data]
      : [];
  const included = Array.isArray(payload?.included) ? payload.included : [];

  return {
    dataCount: data.length,
    data: data.slice(0, 12).map(simplifyResource),
    includedCount: included.length,
    included: included.slice(0, 20).map(simplifyResource),
    links: payload?.links || null,
    meta: payload?.meta || null
  };
}

function createTidalUserAuthRecon(options = {}) {
  const clientId = String(
    options.clientId || process.env.TIDAL_CLIENT_ID || ''
  ).trim();
  const redirectUri = String(
    options.redirectUri ||
    process.env.TIDAL_REDIRECT_URI ||
    DEFAULT_REDIRECT_URI
  ).trim();
  const countryCode = String(options.countryCode || 'GB').trim() || 'GB';
  const scopes = Array.isArray(options.scopes) && options.scopes.length
    ? options.scopes.map(scope => String(scope).trim()).filter(Boolean)
    : DEFAULT_SCOPES.slice();

  let pendingAuth = null;
  let session = null;
  let refreshInFlight = null;
  const personalisedRecommendationsCache = { value: null, expiresAt: 0 };
  const personalisedPlaylistCache = new Map();
  const PERSONALISED_RECOMMENDATIONS_TTL_MS = 5 * 60 * 1000;
  const PERSONALISED_PLAYLIST_TTL_MS = 5 * 60 * 1000;
  const PERSONALISED_PLAYLIST_MAX_PAGES = 10;
  const refreshTokenFile = String(
    options.refreshTokenFile || process.env.TIDAL_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_TOKEN_FILE
  ).trim();

  function loadRefreshToken() {
    try {
      return fs.readFileSync(refreshTokenFile, 'utf8').trim();
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }

  function persistRefreshToken(refreshToken) {
    const token = String(refreshToken || '').trim();
    if (!token) return;
    fs.writeFileSync(refreshTokenFile, token + '\n', { mode: 0o600 });
    fs.chmodSync(refreshTokenFile, 0o600);
  }

  function clearPersistedRefreshToken() {
    try {
      fs.writeFileSync(refreshTokenFile, '', { mode: 0o600 });
      fs.chmodSync(refreshTokenFile, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }


  function assertConfigured() {
    if (!clientId) {
      throw new Error('TIDAL_CLIENT_ID is not configured');
    }
  }

  async function exchangeCode(code, verifier) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const detail =
        payload.error_description ||
        payload.error ||
        `HTTP ${response.status}`;
      throw new Error(`TIDAL authorization-code exchange failed: ${detail}`);
    }

    const expiresIn = Math.max(60, Number(payload.expires_in) || 86400);
    return {
      accessToken: String(payload.access_token),
      refreshToken: String(payload.refresh_token || ''),
      tokenType: String(payload.token_type || 'Bearer'),
      scope: String(payload.scope || ''),
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  async function exchangeRefreshToken(refreshToken) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description || payload.error || ('HTTP ' + response.status);
      throw new Error('TIDAL refresh-token exchange failed: ' + detail);
    }
    const expiresIn = Math.max(60, Number(payload.expires_in) || 86400);
    return {
      accessToken: String(payload.access_token),
      refreshToken: String(payload.refresh_token || refreshToken),
      tokenType: String(payload.token_type || 'Bearer'),
      scope: String(payload.scope || ''),
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  async function ensureSession() {
    if (session?.accessToken && Date.now() < session.expiresAt - 60000) return session;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const refreshToken = session?.refreshToken || loadRefreshToken();
      if (!refreshToken) {
        throw new Error('TIDAL user authorization has not been completed');
      }
      try {
        const refreshed = await exchangeRefreshToken(refreshToken);
        session = refreshed;
        persistRefreshToken(refreshed.refreshToken);
        return session;
      } catch (error) {
        if (/invalid_grant|invalid refresh|expired|revoked/i.test(String(error.message || ''))) {
          clearPersistedRefreshToken();
          session = null;
        }
        throw error;
      }
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function apiGet(path) {
    await ensureSession();

    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.api+json'
      }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.errors?.[0]?.detail ||
        payload?.detail ||
        `HTTP ${response.status}`;
      throw new Error(`${response.status}: ${detail}`);
    }

    return {
      httpStatus: response.status,
      ...summarisePayload(payload)
    };
  }

  async function apiGetRaw(path) {
    await ensureSession();

    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.api+json'
      }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.errors?.[0]?.detail ||
        payload?.detail ||
        `HTTP ${response.status}`;
      throw new Error(`${response.status}: ${detail}`);
    }

    return payload;
  }

  async function probeRawRecommendations() {
    const resources = {
      dailyMixes: '/userDailyMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),
      dailyDiscovery: '/userDiscoveryMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),
      newArrivals: '/userNewReleaseMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)
    };

    const results = {};
    for (const [name, resourcePath] of Object.entries(resources)) {
      results[name] = await apiGetRaw(resourcePath);
    }
    return results;
  }

  async function probeRawPlaylist(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    return apiGetRaw(
      '/playlists/' + encodeURIComponent(id) +
      '?include=items&countryCode=' + encodeURIComponent(countryCode)
    );
  }

  async function probeRichPlaylist(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    return apiGetRaw(
      '/playlists/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums') +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }

  async function probePlaylistArtworkAndPage(playlistId, cursor) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    const pageCursor = String(cursor || '').trim();
    if (pageCursor && !/^[a-zA-Z0-9_-]+$/.test(pageCursor)) {
      throw new Error('Playlist cursor contains unsupported characters');
    }

    let resourcePath =
      '/playlists/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums.coverArt') +
      '&countryCode=' + encodeURIComponent(countryCode);

    if (pageCursor) {
      resourcePath += '&page%5Bcursor%5D=' + encodeURIComponent(pageCursor);
    }

    return apiGetRaw(resourcePath);
  }

  async function probePlaylistItemsPage(playlistId, cursor) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    const pageCursor = String(cursor || '').trim();
    if (!pageCursor || !/^[a-zA-Z0-9_-]+$/.test(pageCursor)) {
      throw new Error('Playlist cursor is required and contains unsupported characters');
    }

    return apiGetRaw(
      '/playlists/' + encodeURIComponent(id) + '/relationships/items' +
      '?countryCode=' + encodeURIComponent(countryCode) +
      '&page%5Bcursor%5D=' + encodeURIComponent(pageCursor) +
      '&include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums.coverArt')
    );
  }

  function resourceKey(resource) {
    return String(resource?.type || '') + ':' + String(resource?.id || '');
  }

  function buildResourceMap(resources) {
    const map = new Map();
    for (const resource of resources || []) {
      if (!resource?.type || !resource?.id) continue;
      map.set(resourceKey(resource), resource);
    }
    return map;
  }

  function relationshipItems(relationship) {
    const data = relationship?.data;
    if (Array.isArray(data)) return data;
    return data ? [data] : [];
  }

  function pickArtworkHref(artwork) {
    const files = Array.isArray(artwork?.attributes?.files)
      ? artwork.attributes.files.filter(file => file?.href)
      : [];
    if (!files.length) return null;
    const exact = files.find(file => Number(file?.meta?.width) === 320);
    if (exact) return String(exact.href);
    const sorted = files.slice().sort((a, b) => {
      const aw = Number(a?.meta?.width) || Number.MAX_SAFE_INTEGER;
      const bw = Number(b?.meta?.width) || Number.MAX_SAFE_INTEGER;
      return Math.abs(aw - 320) - Math.abs(bw - 320);
    });
    return String(sorted[0].href);
  }

  function compactTrack(linkage, resources) {
    if (!linkage || linkage.type !== 'tracks') return null;
    const track = resources.get(resourceKey(linkage));
    if (!track) return null;

    const artistLink = relationshipItems(track.relationships?.artists)[0] || null;
    const albumLink = relationshipItems(track.relationships?.albums)[0] || null;
    const artist = artistLink ? resources.get(resourceKey(artistLink)) : null;
    const album = albumLink ? resources.get(resourceKey(albumLink)) : null;
    const artworkLink = relationshipItems(album?.relationships?.coverArt)[0] || null;
    const artwork = artworkLink ? resources.get(resourceKey(artworkLink)) : null;

    return {
      id: String(track.id),
      title: String(track.attributes?.title || ''),
      artist: String(artist?.attributes?.name || ''),
      artistId: artist?.id ? String(artist.id) : null,
      album: String(album?.attributes?.title || ''),
      albumId: album?.id ? String(album.id) : null,
      duration: track.attributes?.duration || null,
      explicit: Boolean(track.attributes?.explicit),
      isrc: track.attributes?.isrc ? String(track.attributes.isrc) : null,
      artwork: pickArtworkHref(artwork)
    };
  }

  function playlistName(resource) {
    return String(
      resource?.attributes?.name ||
      resource?.attributes?.title ||
      resource?.attributes?.mixName ||
      ''
    );
  }

  async function getPersonalisedRecommendations() {
    if (personalisedRecommendationsCache.value && Date.now() < personalisedRecommendationsCache.expiresAt) {
      return { ...personalisedRecommendationsCache.value, cached: true };
    }

    const raw = await probeRawRecommendations();
    const playlists = [];
    const seen = new Set();

    const add = (kind, resource) => {
      if (!resource || resource.type !== 'playlists' || !resource.id) return;
      const id = String(resource.id);
      if (seen.has(id)) return;
      seen.add(id);
      playlists.push({ id, name: playlistName(resource), kind });
    };

    const dailyMixResources = (raw.dailyMixes?.included || [])
      .filter(resource => resource?.type === 'playlists');
    dailyMixResources.sort((a, b) => {
      const an = Number((playlistName(a).match(/My Mix (\d+)/i) || [])[1]) || 999;
      const bn = Number((playlistName(b).match(/My Mix (\d+)/i) || [])[1]) || 999;
      return an - bn;
    });
    for (const resource of dailyMixResources) add('mix', resource);

    for (const resource of raw.dailyDiscovery?.included || []) {
      if (resource?.type === 'playlists') add('daily-discovery', resource);
    }
    for (const resource of raw.newArrivals?.included || []) {
      if (resource?.type === 'playlists') add('new-arrivals', resource);
    }

    const value = { playlists };
    personalisedRecommendationsCache.value = value;
    personalisedRecommendationsCache.expiresAt = Date.now() + PERSONALISED_RECOMMENDATIONS_TTL_MS;
    return { ...value, cached: false };
  }

  async function getPersonalisedPlaylist(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    const cached = personalisedPlaylistCache.get(id);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.value, cached: true };
    }

    const include = 'items,items.tracks:artists,items.tracks:albums.coverArt';
    const first = await apiGetRaw(
      '/playlists/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent(include) +
      '&countryCode=' + encodeURIComponent(countryCode)
    );

    const root = first?.data && !Array.isArray(first.data) ? first.data : null;
    if (!root || root.type !== 'playlists') {
      throw new Error('TIDAL playlist response did not contain a playlist resource');
    }

    const linkages = relationshipItems(root.relationships?.items).slice();
    const included = Array.isArray(first.included) ? first.included.slice() : [];
    let next = root.relationships?.items?.links?.next || first?.links?.next || null;
    const seenNext = new Set();
    let pages = 1;

    while (next) {
      if (pages >= PERSONALISED_PLAYLIST_MAX_PAGES) {
        throw new Error('TIDAL playlist pagination safety limit reached');
      }
      const nextUrl = new URL(String(next), API_BASE);
      const cursor = String(nextUrl.searchParams.get('page[cursor]') || '').trim();
      if (!cursor || !/^[a-zA-Z0-9_-]+$/.test(cursor)) {
        throw new Error('TIDAL playlist next link did not contain a supported cursor');
      }
      if (seenNext.has(cursor)) {
        throw new Error('TIDAL playlist pagination repeated a cursor');
      }
      seenNext.add(cursor);

      const page = await apiGetRaw(
        '/playlists/' + encodeURIComponent(id) + '/relationships/items' +
        '?countryCode=' + encodeURIComponent(countryCode) +
        '&page%5Bcursor%5D=' + encodeURIComponent(cursor) +
        '&include=' + encodeURIComponent(include)
      );
      if (Array.isArray(page?.data)) linkages.push(...page.data);
      if (Array.isArray(page?.included)) included.push(...page.included);
      next = page?.links?.next || null;
      pages += 1;
    }

    const resources = buildResourceMap(included);
    const tracks = linkages.map(linkage => compactTrack(linkage, resources)).filter(Boolean);
    const value = {
      playlist: {
        id: String(root.id),
        name: playlistName(root),
        trackCount: tracks.length
      },
      tracks,
      pages
    };

    personalisedPlaylistCache.set(id, {
      value,
      expiresAt: Date.now() + PERSONALISED_PLAYLIST_TTL_MS
    });
    if (personalisedPlaylistCache.size > 16) {
      const oldestKey = personalisedPlaylistCache.keys().next().value;
      personalisedPlaylistCache.delete(oldestKey);
    }
    return { ...value, cached: false };
  }

  async function probeRecommendations() {
    const resources = [
      ['dailyMixes', '/userDailyMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['dailyDiscovery', '/userDiscoveryMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['newArrivals', '/userNewReleaseMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)]
    ];

    const results = {};
    for (const [name, path] of resources) {
      try {
        results[name] = {
          ok: true,
          ...(await apiGet(path))
        };
      } catch (error) {
        results[name] = {
          ok: false,
          error: error.message
        };
      }
    }
    return results;
  }

  async function probePersonalisedPlaylists() {
    const recommendationSets = await probeRecommendations();
    const selected = [];

    const addPlaylist = (label, item) => {
      if (!item?.id || item.type !== 'playlists') return;
      selected.push({ label, id: item.id, name: item.name || label });
    };

    const mixes = recommendationSets.dailyMixes?.included || [];
    addPlaylist('My Mix 1', mixes.find(item => item.name === 'My Mix 1'));
    addPlaylist('My Daily Discovery', recommendationSets.dailyDiscovery?.included?.[0]);
    addPlaylist('My New Arrivals', recommendationSets.newArrivals?.included?.[0]);

    const results = {};
    for (const playlist of selected) {
      try {
        results[playlist.label] = {
          playlistId: playlist.id,
          playlistName: playlist.name,
          ok: true,
          ...(await apiGet(
            '/playlists/' + encodeURIComponent(playlist.id) +
            '?include=items&countryCode=' + encodeURIComponent(countryCode)
          ))
        };
      } catch (error) {
        results[playlist.label] = {
          playlistId: playlist.id,
          playlistName: playlist.name,
          ok: false,
          error: error.message
        };
      }
    }

    return {
      discoveredCount: selected.length,
      playlists: results
    };
  }

  async function inspectCollectionResource(path) {
    await ensureSession();

    const startedAt = process.hrtime.bigint();
    const response = await fetch(API_BASE + path, {
      headers: {
        Authorization: 'Bearer ' + session.accessToken,
        Accept: 'application/vnd.api+json'
      }
    });
    const payload = await response.json().catch(() => ({}));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
      throw new Error(response.status + ': ' + detail);
    }

    const included = Array.isArray(payload?.included) ? payload.included : [];
    const first = included[0] || null;
    const attrs = first?.attributes || {};

    return {
      httpStatus: response.status,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      includedCount: included.length,
      firstResource: first ? {
        id: String(first.id || ''),
        type: String(first.type || ''),
        attributeKeys: Object.keys(attrs),
        attributes: Object.fromEntries(
          Object.entries(attrs).filter(([key, value]) =>
            ['name', 'title', 'duration', 'releaseDate', 'barcodeId', 'explicit', 'popularity'].includes(key) &&
            ['string', 'number', 'boolean'].includes(typeof value)
          )
        ),
        relationshipKeys: first.relationships ? Object.keys(first.relationships) : []
      } : null,
      links: payload?.links || null,
      meta: payload?.meta || null
    };
  }

  async function probeCollections() {
    const resources = [
      ['artists', '/userCollectionArtists/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['albums', '/userCollectionAlbums/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['tracks', '/userCollectionTracks/me?include=items&countryCode=' + encodeURIComponent(countryCode)]
    ];

    const results = {};
    for (const [name, path] of resources) {
      try {
        results[name] = { ok: true, ...(await inspectCollectionResource(path)) };
      } catch (error) {
        results[name] = { ok: false, error: error.message };
      }
    }
    return results;
  }

  async function probeCollectionPagination() {
    await ensureSession();

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const pageDelayMs = 1000;
    const collectionDelayMs = 3000;
    const maxRateLimitRetries = 5;

    async function traverse(label, initialPath) {
      const startedAt = process.hrtime.bigint();
      let next = initialPath;
      let pages = 0;
      let totalItems = 0;
      let rateLimitRetries = 0;
      const pageTimesMs = [];
      const seen = new Set();

      while (next) {
        if (pages >= 250) throw new Error(label + ': pagination safety limit reached');
        const url = next.startsWith('http') ? next : API_BASE + next;
        if (seen.has(url)) throw new Error(label + ': repeated pagination URL');

        let response;
        let payload;
        let pageElapsedMs;
        let retriesForPage = 0;

        while (true) {
          const pageStartedAt = process.hrtime.bigint();
          response = await fetch(url, {
            headers: {
              Authorization: 'Bearer ' + session.accessToken,
              Accept: 'application/vnd.api+json'
            }
          });
          payload = await response.json().catch(() => ({}));
          pageElapsedMs = Number(process.hrtime.bigint() - pageStartedAt) / 1e6;

          if (response.status !== 429) break;
          if (retriesForPage >= maxRateLimitRetries) {
            throw new Error(label + ': HTTP 429 after ' + retriesForPage + ' retries');
          }

          const retryAfter = response.headers.get('retry-after');
          const retryAfterSeconds = retryAfter == null ? NaN : Number(retryAfter);
          const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? Math.max(1000, Math.ceil(retryAfterSeconds * 1000))
            : Math.min(30000, 2000 * (2 ** retriesForPage));
          retriesForPage += 1;
          rateLimitRetries += 1;
          await sleep(waitMs);
        }

        if (!response.ok) {
          const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
          throw new Error(response.status + ': ' + detail);
        }

        seen.add(url);
        pages += 1;
        pageTimesMs.push(Math.round(pageElapsedMs * 10) / 10);
        const data = Array.isArray(payload?.data) ? payload.data : [];
        totalItems += data.length;
        next = payload?.links?.next || null;
        if (next) await sleep(pageDelayMs);
      }

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        pages,
        totalItems,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        averagePageMs: pages ? Math.round((elapsedMs / pages) * 10) / 10 : 0,
        rateLimitRetries,
        firstFivePageTimesMs: pageTimesMs.slice(0, 5),
        lastPageMs: pageTimesMs.length ? pageTimesMs[pageTimesMs.length - 1] : null
      };
    }

    const resources = [
      ['artists', '/userCollectionArtists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)],
      ['albums', '/userCollectionAlbums/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)],
      ['tracks', '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)]
    ];

    const results = {};
    for (let i = 0; i < resources.length; i += 1) {
      const [name, initialPath] = resources[i];
      try {
        results[name] = { ok: true, ...(await traverse(name, initialPath)) };
      } catch (error) {
        results[name] = { ok: false, error: error.message };
      }
      if (i < resources.length - 1) await sleep(collectionDelayMs);
    }
    return results;
  }

  async function probeRichMetadata() {
    await ensureSession();

    async function inspect(label, resourcePath) {
      const startedAt = process.hrtime.bigint();
      const response = await fetch(API_BASE + resourcePath, {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
        return { ok: false, httpStatus: response.status, elapsedMs: Math.round(elapsedMs * 10) / 10, error: detail };
      }

      const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
      const included = Array.isArray(payload?.included) ? payload.included : [];
      return {
        ok: true,
        httpStatus: response.status,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        root: root ? {
          id: root.id,
          type: root.type,
          attributes: root.attributes || {},
          relationshipKeys: Object.keys(root.relationships || {})
        } : null,
        included: included.map(item => ({
          id: item.id,
          type: item.type,
          attributes: item.attributes || {},
          relationshipKeys: Object.keys(item.relationships || {})
        }))
      };
    }

    const artistId = '64520';
    const albumId = '58080303';
    const trackId = '58080305';
    return {
      artist: await inspect('artist', '/artists/' + artistId + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode)),
      album: await inspect('album', '/albums/' + albumId + '?include=artists,coverArt&countryCode=' + encodeURIComponent(countryCode)),
      track: await inspect('track', '/tracks/' + trackId + '?include=artists,albums,albums.coverArt&countryCode=' + encodeURIComponent(countryCode))
    };
  }


  async function probeRecommendationResolutionBatch() {
    // This endpoint intentionally stops at official TIDAL metadata. The HEOS
    // catalogue half is driven separately from the shell so every browse step
    // and candidate match remains visible during reconnaissance.
    const playlists = await probePersonalisedPlaylists();
    const selected = [];

    for (const [label, playlist] of Object.entries(playlists.playlists || {})) {
      if (!playlist?.ok) continue;
      const tracks = (playlist.included || [])
        .filter(item => item?.type === 'tracks' && /^\d+$/.test(String(item.id || '')))
        .slice(0, label === 'My Mix 1' ? 10 : 8);
      for (const track of tracks) {
        selected.push({ source: label, id: String(track.id) });
      }
    }

    const unique = [];
    const seen = new Set();
    for (const item of selected) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
      if (unique.length >= 26) break;
    }

    const results = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); // TIDAL_RECOMMENDATION_RECON_PACING_V1
    for (const item of unique) {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (results.length > 0 || attempt > 0) {
          await sleep(attempt > 0 ? 2500 : 1000);
        }
        try {
          const metadata = await probeTrackMetadata(item.id);
          results.push({ source: item.source, id: item.id, ok: true, metadata });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!/HTTP 429/i.test(String(error.message || ''))) break;
        }
      }
      if (lastError) {
        results.push({ source: item.source, id: item.id, ok: false, error: lastError.message });
      }
    }

    return { count: results.length, tracks: results };
  }

  async function probeTrackMetadata(trackId) {
    await ensureSession(); // TIDAL_PERSISTENT_REFRESH_AUTH_V3
    if (!/^\d+$/.test(trackId || '')) {
      throw new Error('Track id must contain digits only');
    }

    const response = await fetch(
      API_BASE + '/tracks/' + encodeURIComponent(trackId) +
        '?include=artists,albums,albums.coverArt&countryCode=' + encodeURIComponent(countryCode),
      {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
      throw new Error(detail);
    }
    return payload;
  }
async function probeSearch() {
    await ensureSession();

    async function inspectSearch(label, path) {
      const startedAt = process.hrtime.bigint();
      const response = await fetch(API_BASE + path, {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
        return {
          ok: false,
          httpStatus: response.status,
          elapsedMs: Math.round(elapsedMs * 10) / 10,
          error: detail
        };
      }

      const data = Array.isArray(payload?.data) ? payload.data : (payload?.data ? [payload.data] : []);
      const included = Array.isArray(payload?.included) ? payload.included : [];
      const simplify = item => ({
        id: String(item?.id || ''),
        type: String(item?.type || ''),
        name: String(item?.attributes?.name || item?.attributes?.title || ''),
        attributeKeys: Object.keys(item?.attributes || {}),
        relationshipKeys: Object.keys(item?.relationships || {})
      });

      return {
        ok: true,
        httpStatus: response.status,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        dataCount: data.length,
        data: data.slice(0, 20).map(simplify),
        includedCount: included.length,
        included: included.slice(0, 40).map(simplify),
        includedTypes: [...new Set(included.map(item => String(item?.type || '')).filter(Boolean))],
        links: payload?.links || null,
        meta: payload?.meta || null
      };
    }

    const encodedCountry = encodeURIComponent(countryCode);
    async function runQuery(query) {
      const encodedQuery = encodeURIComponent(query);
      const base = '/searchResults/' + encodedQuery + '/relationships/';
      return {
        artists: await inspectSearch(
          'artists',
          base + 'artists?countryCode=' + encodedCountry + '&include=artists.profileArt'
        ),
        albums: await inspectSearch(
          'albums',
          base + 'albums?countryCode=' + encodedCountry + '&include=albums.coverArt,albums.artists'
        ),
        tracks: await inspectSearch(
          'tracks',
          base + 'tracks?countryCode=' + encodedCountry + '&include=tracks.artists,tracks.albums,tracks.albums.coverArt'
        ),
        topHits: await inspectSearch(
          'topHits',
          base + 'topHits?countryCode=' + encodedCountry + '&include=topHits'
        ),
        suggestions: await inspectSearch(
          'suggestions',
          '/searchSuggestions/' + encodedQuery + '/relationships/directHits?countryCode=' + encodedCountry + '&include=directHits'
        )
      };
    }

    return {
      interpol: await runQuery('Interpol'),
      documentedControl: await runQuery('hello')
    };
  }

  async function handle(req, res) {
    const requestUrl = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/login') {
      try {
        assertConfigured();
        const verifier = createVerifier();
        const state = base64Url(crypto.randomBytes(32));
        pendingAuth = {
          verifier,
          state,
          createdAt: Date.now()
        };

        const authorizeUrl = new URL(AUTHORIZE_URL);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', clientId);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('scope', scopes.join(' '));
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('code_challenge', createChallenge(verifier));
        authorizeUrl.searchParams.set('state', state);

        res.statusCode = 302;
        res.setHeader('Location', authorizeUrl.toString());
        res.end();
      } catch (error) {
        sendHtml(res, 500, 'TIDAL authorization failed', error.message);
      }
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/callback') {
      try {
        const returnedState = requestUrl.searchParams.get('state') || '';
        const errorCode = requestUrl.searchParams.get('error') || '';
        const errorDescription = requestUrl.searchParams.get('error_description') || '';

        if (!pendingAuth) {
          throw new Error('No TIDAL authorization attempt is pending');
        }
        if (Date.now() - pendingAuth.createdAt > PENDING_AUTH_TTL_MS) {
          pendingAuth = null;
          throw new Error('TIDAL authorization attempt expired');
        }
        if (!safeEqual(returnedState, pendingAuth.state)) {
          pendingAuth = null;
          throw new Error('TIDAL OAuth state validation failed');
        }
        if (errorCode) {
          pendingAuth = null;
          throw new Error(
            `TIDAL denied authorization: ${errorDescription || errorCode}`
          );
        }

        const code = String(requestUrl.searchParams.get('code') || '').trim();
        if (!code) {
          pendingAuth = null;
          throw new Error('TIDAL callback did not contain an authorization code');
        }

        const verifier = pendingAuth.verifier;
        pendingAuth = null;
        session = await exchangeCode(code, verifier);
        persistRefreshToken(session.refreshToken);

        console.log(
          'TIDAL USER AUTHORIZED:',
          JSON.stringify({
            scopesRequested: scopes,
            tokenScope: session.scope,
            expiresAt: new Date(session.expiresAt).toISOString(),
            refreshTokenReceived: Boolean(session.refreshToken)
          })
        );

        sendHtml(
          res,
          200,
          'TIDAL authorization succeeded',
          'MarantzPi is authorized. The refresh token is stored securely outside Git so authorization can survive backend restarts. Return to Termius.'
        );
      } catch (error) {
        console.error('TIDAL USER AUTH FAILED:', error.message);
        sendHtml(res, 400, 'TIDAL authorization failed', error.message);
      }
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/refresh') {
      try {
        await ensureSession();
        return sendJson(res, 200, {
          ok: true,
          authorized: true,
          expiresAt: new Date(session.expiresAt).toISOString(),
          tokenScope: session.scope || '',
          refreshTokenStored: Boolean(loadRefreshToken())
        });
      } catch (error) {
        return sendJson(res, 401, { ok: false, authorized: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/status') {
      // TIDAL_PERSISTENT_REFRESH_AUTH_V2
      try { await ensureSession(); } catch {}
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(clientId),
        redirectUri,
        scopesRequested: scopes,
        pending: Boolean(
          pendingAuth && Date.now() - pendingAuth.createdAt <= PENDING_AUTH_TTL_MS
        ),
        authorized: Boolean(session?.accessToken && Date.now() < session.expiresAt),
        expiresAt: session?.expiresAt
          ? new Date(session.expiresAt).toISOString()
          : null,
        tokenScope: session?.scope || '',
        refreshTokenReceived: Boolean(session?.refreshToken),
        refreshTokenStored: Boolean(loadRefreshToken())
      });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-search') {
      try {
        const search = await probeSearch();
        return sendJson(res, 200, { ok: true, search });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendation-resolution-batch') {
      try {
        return sendJson(res, 200, await probeRecommendationResolutionBatch());
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackMetadata(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {
      try {
        const metadata = await probeRichMetadata();
        return sendJson(res, 200, { ok: true, metadata });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collection-pagination') {
      try {
        const pagination = await probeCollectionPagination();
        return sendJson(res, 200, { ok: true, pagination });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collections') {
      try {
        const collections = await probeCollections();
        return sendJson(res, 200, { ok: true, collections });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/personalised') {
      try {
        const personalised = await getPersonalisedRecommendations();
        return sendJson(res, 200, { ok: true, ...personalised });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/personalised/playlist') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const playlist = await getPersonalisedPlaylist(playlistId);
        return sendJson(res, 200, { ok: true, ...playlist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendations-raw') {
      try {
        const recommendations = await probeRawRecommendations();
        return sendJson(res, 200, { ok: true, recommendations });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-raw') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const playlist = await probeRawPlaylist(playlistId);
        return sendJson(res, 200, { ok: true, playlist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-rich') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const playlist = await probeRichPlaylist(playlistId);
        return sendJson(res, 200, { ok: true, playlist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-page') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const cursor = requestUrl.searchParams.get('cursor') || '';
        const playlist = await probePlaylistArtworkAndPage(playlistId, cursor);
        return sendJson(res, 200, { ok: true, playlist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-items-page') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const cursor = requestUrl.searchParams.get('cursor') || '';
        const items = await probePlaylistItemsPage(playlistId, cursor);
        return sendJson(res, 200, { ok: true, items });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {
      try {
        const personalisedPlaylists = await probePersonalisedPlaylists();
        return sendJson(res, 200, {
          ok: true,
          personalisedPlaylists
        });
      } catch (error) {
        return sendJson(res, 401, {
          ok: false,
          error: error.message
        });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe') {
      try {
        const recommendations = await probeRecommendations();
        return sendJson(res, 200, {
          ok: true,
          recommendations
        });
      } catch (error) {
        return sendJson(res, 401, {
          ok: false,
          error: error.message
        });
      }
    }

    return false;
  }

  return {
    handle,
    getTrackMetadata: probeTrackMetadata
  };
}

module.exports = {
  createTidalUserAuthRecon
};

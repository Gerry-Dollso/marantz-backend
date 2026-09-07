'use strict';

const fs = require('fs');

const path = 'tidal-user-auth-recon.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0) throw new Error(label + ': anchor not found');
  if (first !== last) throw new Error(label + ': anchor is not unique');
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'cache state',
  "  const personalisedArtworkCache = new Map();\n  const PERSONALISED_RECOMMENDATIONS_TTL_MS = 5 * 60 * 1000;",
  "  const personalisedArtworkCache = new Map();\n  const favouriteTracksCache = { value: null, expiresAt: 0 };\n  let favouriteTracksRefreshInFlight = null;\n  const PERSONALISED_RECOMMENDATIONS_TTL_MS = 5 * 60 * 1000;\n  const FAVOURITE_TRACKS_TTL_MS = 5 * 60 * 1000;\n  const FAVOURITE_TRACKS_MAX_PAGES = 250;\n  const FAVOURITE_TRACKS_BATCH_SIZE = 20;\n  const FAVOURITE_TRACKS_METADATA_CONCURRENCY = 4;"
);

replaceOnce(
  'canonical function insertion',
  "  async function probeRecommendations() {",
  `  function normaliseApiPath(next) {
    const url = new URL(String(next || ''), API_BASE);
    const api = new URL(API_BASE);
    if (url.origin !== api.origin) {
      throw new Error('TIDAL pagination next link changed origin');
    }
    return url.pathname + url.search;
  }

  async function apiGetRawWithRateLimitRetry(path, label) {
    let attempt = 0;
    while (true) {
      try {
        return await apiGetRaw(path);
      } catch (error) {
        const message = String(error?.message || error || '');
        if (!/^429:/.test(message) || attempt >= 4) throw error;
        const waitMs = Math.min(8000, 1000 * (2 ** attempt));
        console.warn('TIDAL Favourite Tracks rate limited:', label, 'retry in', waitMs, 'ms');
        await new Promise(resolve => setTimeout(resolve, waitMs));
        attempt += 1;
      }
    }
  }

  async function getFavouriteTrackReferenceIds() {
    const ids = [];
    const seenIds = new Set();
    const seenPages = new Set();
    let next = '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(countryCode);
    let pages = 0;

    while (next) {
      if (pages >= FAVOURITE_TRACKS_MAX_PAGES) {
        throw new Error('TIDAL Favourite Tracks pagination safety limit reached');
      }
      const path = normaliseApiPath(next);
      if (seenPages.has(path)) {
        throw new Error('TIDAL Favourite Tracks pagination repeated a page');
      }
      seenPages.add(path);

      const payload = await apiGetRawWithRateLimitRetry(path, 'relationship page ' + (pages + 1));
      const data = Array.isArray(payload?.data) ? payload.data : [];
      for (const linkage of data) {
        const id = String(linkage?.id || '').trim();
        if (linkage?.type !== 'tracks' || !/^\\d+$/.test(id)) {
          throw new Error('TIDAL Favourite Tracks relationship contained an invalid track linkage');
        }
        if (seenIds.has(id)) {
          throw new Error('TIDAL Favourite Tracks relationship contained duplicate track id ' + id);
        }
        seenIds.add(id);
        ids.push(id);
      }

      next = payload?.links?.next || null;
      pages += 1;
    }

    return { ids, pages };
  }

  async function getFavouriteTrackMetadataBatch(ids, batchNumber) {
    const requested = ids.map(id => String(id));
    if (!requested.length || requested.length > FAVOURITE_TRACKS_BATCH_SIZE) {
      throw new Error('TIDAL Favourite Tracks metadata batch size is invalid');
    }

    const filter = encodeURIComponent(requested.join(','));
    const include = encodeURIComponent('artists,albums,albums.coverArt');
    const payload = await apiGetRawWithRateLimitRetry(
      '/tracks?filter%5Bid%5D=' + filter +
        '&include=' + include +
        '&countryCode=' + encodeURIComponent(countryCode),
      'metadata batch ' + batchNumber
    );

    const data = Array.isArray(payload?.data) ? payload.data : [];
    const included = Array.isArray(payload?.included) ? payload.included : [];
    const requestedSet = new Set(requested);
    const resources = buildResourceMap([...data, ...included]);
    const tracks = [];

    for (const resource of data) {
      const id = String(resource?.id || '');
      if (resource?.type !== 'tracks' || !requestedSet.has(id)) {
        throw new Error('TIDAL Favourite Tracks bulk metadata returned an unexpected resource');
      }
      const track = compactTrack({ type: 'tracks', id }, resources);
      if (!track || !track.title || !track.artist || !track.album || !track.albumId) {
        throw new Error('TIDAL Favourite Tracks metadata is incomplete for track ' + id);
      }
      tracks.push(track);
    }

    return tracks;
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }

    const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async function refreshFavouriteTracks() {
    if (favouriteTracksRefreshInFlight) return favouriteTracksRefreshInFlight;

    favouriteTracksRefreshInFlight = (async () => {
      const startedAt = Date.now();
      const relationship = await getFavouriteTrackReferenceIds();
      const batches = [];
      for (let i = 0; i < relationship.ids.length; i += FAVOURITE_TRACKS_BATCH_SIZE) {
        batches.push(relationship.ids.slice(i, i + FAVOURITE_TRACKS_BATCH_SIZE));
      }

      const batchTracks = await mapWithConcurrency(
        batches,
        FAVOURITE_TRACKS_METADATA_CONCURRENCY,
        (batch, index) => getFavouriteTrackMetadataBatch(batch, index + 1)
      );

      const byId = new Map();
      for (const tracks of batchTracks) {
        for (const track of tracks) {
          if (byId.has(track.id)) {
            throw new Error('TIDAL Favourite Tracks metadata returned duplicate track id ' + track.id);
          }
          byId.set(track.id, track);
        }
      }

      const tracks = [];
      const staleReferenceIds = [];
      for (const id of relationship.ids) {
        const track = byId.get(id);
        if (track) tracks.push(track);
        else staleReferenceIds.push(id);
      }

      if (!tracks.length && relationship.ids.length) {
        throw new Error('TIDAL Favourite Tracks resolved zero live tracks');
      }

      const refreshedAt = Date.now();
      const value = {
        tracks,
        trackCount: tracks.length,
        referenceCount: relationship.ids.length,
        staleReferenceCount: staleReferenceIds.length,
        staleReferenceIds,
        relationshipPages: relationship.pages,
        metadataBatches: batches.length,
        buildMs: refreshedAt - startedAt,
        refreshedAt: new Date(refreshedAt).toISOString()
      };

      favouriteTracksCache.value = value;
      favouriteTracksCache.expiresAt = refreshedAt + FAVOURITE_TRACKS_TTL_MS;
      return value;
    })();

    try {
      return await favouriteTracksRefreshInFlight;
    } finally {
      favouriteTracksRefreshInFlight = null;
    }
  }

  async function getFavouriteTracks(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();

    if (!forceRefresh && favouriteTracksCache.value) {
      if (now < favouriteTracksCache.expiresAt) {
        return {
          ...favouriteTracksCache.value,
          cached: true,
          stale: false,
          refreshing: Boolean(favouriteTracksRefreshInFlight)
        };
      }

      if (!favouriteTracksRefreshInFlight) {
        refreshFavouriteTracks().catch(error => {
          console.error('TIDAL Favourite Tracks background refresh failed:', error.message);
        });
      }
      return {
        ...favouriteTracksCache.value,
        cached: true,
        stale: true,
        refreshing: true
      };
    }

    try {
      const value = await refreshFavouriteTracks();
      return { ...value, cached: false, stale: false, refreshing: false };
    } catch (error) {
      if (favouriteTracksCache.value) {
        return {
          ...favouriteTracksCache.value,
          cached: true,
          stale: true,
          refreshing: false,
          refreshError: error.message
        };
      }
      throw error;
    }
  }

  async function probeRecommendations() {`
);

replaceOnce(
  'diagnostic endpoint insertion',
  "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendations-raw') {",
  `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-favourite-tracks-canonical') {
      try {
        const favourites = await getFavouriteTracks({
          forceRefresh: requestUrl.searchParams.get('refresh') === '1'
        });
        const tracks = Array.isArray(favourites.tracks) ? favourites.tracks : [];
        const { tracks: ignoredTracks, ...summary } = favourites;
        return sendJson(res, 200, {
          ok: true,
          ...summary,
          firstTracks: tracks.slice(0, 3),
          lastTracks: tracks.slice(-3)
        });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendations-raw') {`
);

replaceOnce(
  'public method',
  "    handle,\n    getTrackMetadata: probeTrackMetadata,\n    getPersonalisedPlaylist",
  "    handle,\n    getTrackMetadata: probeTrackMetadata,\n    getPersonalisedPlaylist,\n    getFavouriteTracks"
);

fs.writeFileSync(path, source);
console.log('Updated ' + path + ' with guarded canonical Favourite Tracks loader/cache.');

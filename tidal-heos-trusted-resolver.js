'use strict';

// Read-only trusted-context layer for official-TIDAL -> HEOS resolution.
//
// This layer NEVER introduces a new playback candidate. It may only choose
// between candidates that the base resolver has already qualified as exact
// title/artist matches. A complete index of user-created HEOS playlists is
// built in the background. Ambiguous requests consult that index without
// blocking on HEOS playlist crawling. Partial refreshes are never trusted.

function createTidalHeosTrustedResolver(options = {}) {
  const baseResolver = options.baseResolver;
  const heosBrowse = options.heosBrowse;
  const sid = String(options.sid || '10');
  const maxPlaylistPages = Math.max(1, Number(options.maxPlaylistPages) || 20);
  const playlistConcurrency = Math.max(1, Math.min(8, Number(options.playlistConcurrency) || 4));
  const autoWarm = options.autoWarm !== false;
  const refreshIntervalMs = Number.isFinite(Number(options.refreshIntervalMs))
    ? Math.max(0, Number(options.refreshIntervalMs))
    : 30 * 60 * 1000;

  if (!baseResolver || typeof baseResolver.resolveTrack !== 'function') {
    throw new Error('baseResolver.resolveTrack is required');
  }
  if (typeof heosBrowse !== 'function') {
    throw new Error('heosBrowse is required');
  }

  const trustedCache = new Map();
  let trustedIndex = null;
  let refreshPromise = null;
  let lastRefreshAt = 0;
  let lastRefreshError = '';

  function normalise(value) {
    return String(value || '')
      .replace(/%26/gi, '&')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function candidateKey(candidate) {
    return String(candidate?.cid || '') + '|' + String(candidate?.mid || '');
  }

  function parseCount(response) {
    const message = String(response?.heos?.message || '');
    const match = message.match(/(?:^|&)count=(\d+)/);
    return match ? Number(match[1]) : null;
  }

  async function browsePage(cid, start, end) {
    return heosBrowse(
      'heos://browse/browse?sid=' + encodeURIComponent(sid) +
      '&cid=' + encodeURIComponent(cid).replace(/%20/g, ' ') +
      '&range=' + start + ',' + end
    );
  }

  async function browseAll(cid) {
    const pageSize = 50;
    const items = [];
    let start = 0;
    let total = null;
    let pages = 0;

    while (total === null || start < total) {
      if (pages >= maxPlaylistPages) {
        throw new Error('HEOS trusted-context pagination safety limit reached');
      }

      const response = await browsePage(cid, start, start + pageSize - 1);
      const payload = Array.isArray(response?.payload) ? response.payload : [];
      items.push(...payload);
      pages += 1;

      const reportedTotal = parseCount(response);
      if (reportedTotal !== null) total = reportedTotal;
      if (!payload.length) break;

      start += payload.length;
      if (total === null && payload.length < pageSize) break;
    }

    return items;
  }

  async function discoverCreatedPlaylistCids() {
    const roots = await browseAll('My Music-Playlists');
    const createdRoot = roots.find(item =>
      String(item?.cid || '') === 'My Music-Playlists-Created by me'
    );

    if (!createdRoot) return [];

    const items = await browseAll(String(createdRoot.cid));
    return [...new Set(
      items
        .map(item => String(item?.cid || ''))
        .filter(cid => cid.startsWith('LIBPLAYLIST-'))
    )];
  }

  function itemSupportsCandidate(item, candidate) {
    if (!item || !candidate) return false;
    if (String(item.mid || '') !== String(candidate.mid || '')) return false;

    const candidateTitle = normalise(candidate.title);
    const itemTitle = normalise(item.name);
    if (candidateTitle && itemTitle && candidateTitle !== itemTitle) return false;

    const candidateArtist = normalise(candidate.artist);
    const itemArtist = normalise(item.artist);
    if (candidateArtist && itemArtist && candidateArtist !== itemArtist) return false;

    const candidateAlbumId = String(candidate.albumId || '').trim();
    const itemAlbumId = String(item.album_id || '').trim();
    if (candidateAlbumId && itemAlbumId && candidateAlbumId !== itemAlbumId) return false;

    return true;
  }

  async function mapWithConcurrency(values, concurrency, worker) {
    let next = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => {
        while (next < values.length) {
          const index = next++;
          await worker(values[index], index);
        }
      }
    );
    await Promise.all(workers);
  }

  async function buildTrustedIndex() {
    const playlistCids = await discoverCreatedPlaylistCids();
    const byMid = new Map();
    let trackEntries = 0;

    // The refresh is atomic: any failed playlist browse rejects the entire
    // build so absence from a partial scan can never be treated as evidence.
    await mapWithConcurrency(
      playlistCids,
      playlistConcurrency,
      async playlistCid => {
        const items = await browseAll(playlistCid);
        for (const item of items) {
          const mid = String(item?.mid || '').trim();
          if (!mid) continue;

          const entry = {
            mid,
            name: String(item?.name || ''),
            artist: String(item?.artist || ''),
            album_id: String(item?.album_id || ''),
            playlistCid
          };

          if (!byMid.has(mid)) byMid.set(mid, []);
          byMid.get(mid).push(entry);
          trackEntries += 1;
        }
      }
    );

    for (const entries of byMid.values()) {
      entries.sort((a, b) => a.playlistCid.localeCompare(b.playlistCid));
    }

    return {
      byMid,
      playlistCount: playlistCids.length,
      trackEntries,
      builtAt: Date.now()
    };
  }

  function refreshIndex() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = buildTrustedIndex()
      .then(nextIndex => {
        trustedIndex = nextIndex;
        lastRefreshAt = nextIndex.builtAt;
        lastRefreshError = '';
        trustedCache.clear();
        return nextIndex;
      })
      .catch(error => {
        lastRefreshError = error.message;
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  function findIndexedEvidence(candidates) {
    if (!trustedIndex) return null;

    const evidenced = new Map();
    for (const candidate of candidates) {
      const entries = trustedIndex.byMid.get(String(candidate.mid || '')) || [];
      const supporting = entries.filter(item => itemSupportsCandidate(item, candidate));
      if (!supporting.length) continue;

      evidenced.set(candidateKey(candidate), {
        candidate,
        playlistCid: supporting[0].playlistCid
      });
    }

    return [...evidenced.values()];
  }

  function cacheKey(target) {
    return String(target?.officialTrackId || '');
  }

  function cachedCandidate(target, candidates) {
    const key = cacheKey(target);
    if (!key || !trustedCache.has(key)) return null;

    const cached = trustedCache.get(key);
    const current = candidates.find(
      candidate => candidateKey(candidate) === candidateKey(cached.resolution)
    );

    if (!current) {
      trustedCache.delete(key);
      return null;
    }

    return {
      ...current,
      method: 'trusted-context-cache',
      confidence: 'deterministic-context',
      evidence: cached.evidence
    };
  }

  async function resolveTrack(target) {
    const base = await baseResolver.resolveTrack(target);
    if (base?.status !== 'ambiguous') return base;

    const candidates = Array.isArray(base.candidates)
      ? base.candidates.filter(candidate => candidate?.cid && candidate?.mid)
      : [];

    if (candidates.length < 2) return base;

    const cached = cachedCandidate(target, candidates);
    if (cached) {
      return {
        status: 'resolved',
        cid: String(cached.cid),
        mid: String(cached.mid),
        method: cached.method,
        confidence: cached.confidence,
        evidence: cached.evidence
      };
    }

    const evidence = findIndexedEvidence(candidates);
    if (evidence === null) {
      return {
        ...base,
        trustedContext: {
          status: refreshPromise ? 'warming' : 'not-ready',
          reason: lastRefreshError || undefined
        }
      };
    }

    if (evidence.length !== 1) {
      return {
        ...base,
        trustedContext: {
          status: evidence.length > 1 ? 'ambiguous' : 'not-found',
          matches: evidence.map(item => ({
            cid: String(item.candidate.cid),
            mid: String(item.candidate.mid),
            playlistCid: item.playlistCid
          }))
        }
      };
    }

    const match = evidence[0];
    const resolution = {
      cid: String(match.candidate.cid),
      mid: String(match.candidate.mid)
    };
    const trustedEvidence = {
      type: 'heos-user-created-playlist-index',
      playlistCid: match.playlistCid,
      indexBuiltAt: trustedIndex.builtAt
    };

    const key = cacheKey(target);
    if (key) {
      trustedCache.set(key, {
        resolution,
        evidence: trustedEvidence
      });
    }

    return {
      status: 'resolved',
      ...resolution,
      method: 'trusted-user-playlist-context',
      confidence: 'deterministic-context',
      evidence: trustedEvidence
    };
  }

  function stats() {
    return {
      trustedMappings: trustedCache.size,
      indexReady: Boolean(trustedIndex),
      indexRefreshing: Boolean(refreshPromise),
      indexedPlaylists: trustedIndex?.playlistCount || 0,
      indexedTrackEntries: trustedIndex?.trackEntries || 0,
      lastRefreshAt,
      lastRefreshError
    };
  }

  if (autoWarm) {
    refreshIndex().catch(error => {
      console.warn('TIDAL TRUSTED CONTEXT INDEX REFRESH FAILED:', error.message);
    });
  }

  if (refreshIntervalMs > 0) {
    const timer = setInterval(() => {
      refreshIndex().catch(error => {
        console.warn('TIDAL TRUSTED CONTEXT INDEX REFRESH FAILED:', error.message);
      });
    }, refreshIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    resolveTrack,
    refreshIndex,
    stats
  };
}

module.exports = {
  createTidalHeosTrustedResolver
};

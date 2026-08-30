'use strict';

// Read-only trusted-context layer for official-TIDAL -> HEOS resolution.
//
// This layer NEVER introduces a new playback candidate. It may only choose
// between candidates that the base resolver has already qualified as exact
// title/artist matches. User HEOS playlists are used as trusted context: if
// exactly one qualified candidate is observed there, that candidate can be
// selected. Otherwise ambiguity is preserved.

function createTidalHeosTrustedResolver(options = {}) {
  const baseResolver = options.baseResolver;
  const heosBrowse = options.heosBrowse;
  const sid = String(options.sid || '10');
  const maxPlaylistPages = Math.max(1, Number(options.maxPlaylistPages) || 20);

  if (!baseResolver || typeof baseResolver.resolveTrack !== 'function') {
    throw new Error('baseResolver.resolveTrack is required');
  }
  if (typeof heosBrowse !== 'function') {
    throw new Error('heosBrowse is required');
  }

  const trustedCache = new Map();

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

  async function findPlaylistEvidence(candidates) {
    const candidateMap = new Map(
      candidates.map(candidate => [candidateKey(candidate), candidate])
    );
    const evidenced = new Map();

    const playlistRoots = await browseAll('My Music-Playlists');
    const playlistCids = [...new Set(
      playlistRoots
        .map(item => String(item?.cid || ''))
        .filter(cid => cid.startsWith('LIBPLAYLIST-'))
    )];

    for (const playlistCid of playlistCids) {
      let items;
      try {
        items = await browseAll(playlistCid);
      } catch (error) {
        console.warn(
          'TIDAL TRUSTED CONTEXT PLAYLIST SKIP:',
          playlistCid,
          error.message
        );
        continue;
      }

      for (const candidate of candidateMap.values()) {
        if (items.some(item => itemSupportsCandidate(item, candidate))) {
          evidenced.set(candidateKey(candidate), {
            candidate,
            playlistCid
          });
        }
      }

      if (evidenced.size > 1) break;
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

    let evidence;
    try {
      evidence = await findPlaylistEvidence(candidates);
    } catch (error) {
      return {
        ...base,
        trustedContext: {
          status: 'unavailable',
          reason: error.message
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
      type: 'heos-user-playlist',
      playlistCid: match.playlistCid
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
      trustedMappings: trustedCache.size
    };
  }

  return {
    resolveTrack,
    stats
  };
}

module.exports = {
  createTidalHeosTrustedResolver
};

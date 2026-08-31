'use strict';

// Reusable official-TIDAL -> HEOS catalogue resolver.
// The injected browse function must be read-only. This module never constructs
// player commands or browse/add_to_queue commands itself.

function createTidalHeosResolver(options = {}) {
  const heosBrowse = options.heosBrowse;
  const sid = String(options.sid || '10');
  if (typeof heosBrowse !== 'function') throw new Error('heosBrowse is required');

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

  function albumNormalise(value) {
    return normalise(value)
      .replace(/\s+'n'\s+/g, ' n ')
      .replace(/\s+(?:and|n)\s+/g, ' n ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function baseTitle(value) {
    return albumNormalise(value)
      .replace(/\b(deluxe|expanded|remaster(?:ed)?|anniversary|edition|bonus|explicit)\b.*$/i, '')
      .trim();
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function relationIds(resource, key) {
    const data = resource?.relationships?.[key]?.data;
    if (Array.isArray(data)) return data.map(item => String(item?.id || '')).filter(Boolean);
    if (data?.id) return [String(data.id)];
    return [];
  }

  function extractOfficialTrack(item) {
    const payload = item?.metadata || item || {};
    const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
    const included = Array.isArray(payload?.included) ? payload.included : [];
    if (!root) throw new Error('Official TIDAL track payload has no root data');
    const artistIds = relationIds(root, 'artists');
    const albumIds = relationIds(root, 'albums');
    const artist = included.find(resource => resource?.type === 'artists' && artistIds.includes(String(resource.id || '')));
    const album = included.find(resource => resource?.type === 'albums' && albumIds.includes(String(resource.id || '')));
    return {
      source: item?.source || '',
      officialTrackId: String(root.id || item?.id || ''),
      title: String(root?.attributes?.title || root?.attributes?.name || ''),
      artistId: String(artist?.id || artistIds[0] || ''),
      artist: String(artist?.attributes?.name || ''),
      albumId: String(album?.id || albumIds[0] || ''),
      album: String(album?.attributes?.title || album?.attributes?.name || ''),
      isrc: String(root?.attributes?.isrc || ''),
      duration: String(root?.attributes?.duration || '')
    };
  }

  function titleMatches(item, target) {
    return item?.mid && item.playable === 'yes' && normalise(item.name) === normalise(target.title);
  }

  function strictTrackMatches(item, target) {
    if (!titleMatches(item, target)) return false;
    if (target.artist && item.artist && normalise(item.artist) !== normalise(target.artist)) return false;
    return true;
  }

  function officialMidMatch(tracks, target) {
    if (!target.officialTrackId) return null;
    const matches = tracks.filter(item => item?.mid && item.playable === 'yes' && String(item.mid) === target.officialTrackId);
    return matches.length === 1 ? matches[0] : null;
  }

  function albumTitleScore(candidate, target) {
    const a = albumNormalise(candidate);
    const b = albumNormalise(target);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aa = baseTitle(candidate);
    const bb = baseTitle(target);
    return aa && bb && aa === bb ? 0.9 : 0;
  }

  const artistCache = new Map();
  const artistAlbumsCache = new Map();

  async function browse(cid) {
    const response = await heosBrowse('heos://browse/browse?sid=' + sid + '&cid=' + encodeURIComponent(cid));
    return response.payload || [];
  }

  async function resolveArtistCid(target) {
    if (target.artistId) {
      const directCid = 'LIBARTIST-' + target.artistId;
      try { if ((await browse(directCid)).length) return directCid; } catch {}
    }
    const key = normalise(target.artist);
    if (artistCache.has(key)) return artistCache.get(key);
    const response = await heosBrowse('heos://browse/search?sid=' + sid + '&scid=1&search=' + encodeURIComponent(target.artist));
    const exact = (response.payload || []).filter(item => item.cid && normalise(item.name) === key).map(item => String(item.cid));
    const unique = [...new Set(exact)];
    const result = unique.length === 1 ? unique[0] : null;
    artistCache.set(key, result);
    return result;
  }

  async function artistAlbums(artistCid) {
    if (artistAlbumsCache.has(artistCid)) return artistAlbumsCache.get(artistCid);
    const artistId = String(artistCid).replace(/^LIBARTIST-/, '');
    const categoryCids = new Set(['LIBARTIST-Albums-' + artistId]);
    try {
      for (const item of await browse(artistCid)) {
        if (item.cid && /(album|single|ep)/.test(normalise(item.name))) categoryCids.add(String(item.cid));
      }
    } catch {}
    const albums = [];
    const seen = new Set();
    for (const cid of categoryCids) {
      try {
        for (const item of await browse(cid)) {
          if (!item.cid || seen.has(String(item.cid))) continue;
          seen.add(String(item.cid));
          albums.push({ name: String(item.name || ''), cid: String(item.cid) });
        }
      } catch {}
      await sleep(80);
    }
    artistAlbumsCache.set(artistCid, albums);
    return albums;
  }

  async function resolveTrack(input) {
    const target = input?.officialTrackId ? input : extractOfficialTrack(input);
    if (target.albumId) {
      const cid = 'LIBALBUM-' + target.albumId;
      try {
        const tracks = await browse(cid);
        const byMid = officialMidMatch(tracks, target);
        if (byMid) return { status: 'resolved', method: 'direct-album-id+official-mid', confidence: 'deterministic-id', cid, mid: String(byMid.mid) };
        const strict = tracks.filter(item => strictTrackMatches(item, target));
        if (strict.length === 1) return { status: 'resolved', method: 'direct-album-id', confidence: 'exact-metadata', cid, mid: String(strict[0].mid) };
      } catch {}
    }
    if (!target.artist) return { status: 'unresolved', reason: 'official metadata has no artist name' };
    const artistCid = await resolveArtistCid(target);
    if (!artistCid) return { status: 'unresolved', reason: 'no safe HEOS artist resolution' };
    const ranked = (await artistAlbums(artistCid)).map(album => ({ ...album, score: albumTitleScore(album.name, target.album) }))
      .filter(album => album.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) return { status: 'unresolved', reason: 'no HEOS album-title candidate' };
    const best = ranked[0].score;
    const candidates = ranked.filter(album => album.score === best);
    const deterministic = [];
    const metadata = [];
    for (const album of candidates) {
      try {
        const tracks = await browse(album.cid);
        const byMid = officialMidMatch(tracks, target);
        if (byMid) deterministic.push({ album, track: byMid });
        for (const track of tracks.filter(item => strictTrackMatches(item, target))) metadata.push({ album, track });
      } catch {}
      await sleep(80);
    }
    const deterministicUnique = [...new Map(deterministic.map(x => [x.album.cid + '|' + x.track.mid, x])).values()];
    if (deterministicUnique.length === 1) {
      const x = deterministicUnique[0];
      return { status: 'resolved', method: 'artist-album+official-mid', confidence: 'deterministic-id', cid: x.album.cid, mid: String(x.track.mid) };
    }
    const unique = [...new Map(metadata.map(x => [x.album.cid + '|' + x.track.mid, x])).values()];
    if (unique.length === 1) {
      const x = unique[0];
      return { status: 'resolved', method: 'artist-album-track', confidence: x.album.score === 1 ? 'exact' : 'edition-normalised', cid: x.album.cid, mid: String(x.track.mid) };
    }
    if (unique.length > 1 || deterministicUnique.length > 1) {
      const ambiguous = unique.length > 1 ? unique : deterministicUnique;
      return {
        status: 'ambiguous',
        reason: 'multiple HEOS album/track matches',
        candidates: ambiguous.map(x => ({
          cid: String(x.album.cid),
          albumId: String(x.album.cid).replace(/^LIBALBUM-/, ''),
          mid: String(x.track.mid),
          title: String(x.track.name || target.title || ''),
          artist: String(x.track.artist || target.artist || '')
        }))
      };
    }
    return { status: 'unresolved', reason: 'album candidates did not contain a safe track match' };
  }

  return { extractOfficialTrack, resolveTrack };
}

module.exports = { createTidalHeosResolver };

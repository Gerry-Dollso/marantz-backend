'use strict';

function normaliseMatchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function simplifyMatchText(value) {
  return normaliseMatchText(value)
    .split(' ')
    .filter(word => !['a', 'an', 'the', 'of'].includes(word))
    .join(' ');
}

function phoneticKey(value) {
  return simplifyMatchText(value)
    .replace(/ph/g, 'f')
    .replace(/ng/g, 'n')
    .replace(/[zxs]/g, 's')
    .replace(/[ckq]/g, 'k')
    .replace(/[v]/g, 'f')
    .replace(/[dt]/g, 't')
    .replace(/[gj]/g, 'j')
    .replace(/[aeiouy ]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function editSimilarity(left, right) {
  const a = String(left || '');
  const b = String(right || '');

  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    for (let j = 0; j < current.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function tokenSimilarity(left, right) {
  const a = new Set(simplifyMatchText(left).split(' ').filter(Boolean));
  const b = new Set(simplifyMatchText(right).split(' ').filter(Boolean));

  if (!a.size || !b.size) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  return overlap / Math.max(a.size, b.size);
}

function matchScore(candidate, requested) {
  const name = normaliseMatchText(candidate);
  const target = normaliseMatchText(requested);

  if (!name || !target) return 0;
  if (name === target) return 1;

  const simpleName = simplifyMatchText(name);
  const simpleTarget = simplifyMatchText(target);

  if (simpleName === simpleTarget) return 0.98;

  if (
    name.startsWith(`${target} (`) ||
    name.startsWith(`${target} -`)
  ) {
    return 0.94;
  }

  if (
    Math.min(simpleName.length, simpleTarget.length) >= 4 &&
    (simpleName.includes(simpleTarget) || simpleTarget.includes(simpleName))
  ) {
    return 0.9;
  }

  const spelling = editSimilarity(simpleName, simpleTarget);
  const tokens = tokenSimilarity(simpleName, simpleTarget);
  const phonetic = editSimilarity(
    phoneticKey(simpleName),
    phoneticKey(simpleTarget)
  );

  return Math.max(
    spelling,
    tokens * 0.92,
    phonetic * 0.88,
    spelling * 0.65 + phonetic * 0.35
  );
}

function chooseBestMatch(items, requested, getName, minimumScore = 0.52) {
  let best = null;
  let bestScore = -1;

  for (const item of items) {
    const score = matchScore(getName(item), requested);

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore >= minimumScore
    ? { item: best, score: bestScore }
    : null;
}

function createTidalVoiceControl({ heosBrowse, playerId, selectTidalSource }) {
  async function searchArtists(query) {
    const queries = [
      normaliseMatchText(query),
      simplifyMatchText(query)
    ].filter((value, index, all) => value && all.indexOf(value) === index);

    const artists = [];
    const seen = new Set();

    for (const searchQuery of queries) {
      const response = await heosBrowse(
        'heos://browse/search?sid=10&scid=1&search=' +
        encodeURIComponent(searchQuery)
      );

      for (const item of response.payload || []) {
        const cid = String(item.cid || '');
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        artists.push({
          name: item.name || '',
          cid
        });
      }
    }

    return artists;
  }

  async function getArtistAlbums(artistCid) {
    const artistId = String(artistCid || '')
      .trim()
      .replace('LIBARTIST-', '');

    const response = await heosBrowse(
      'heos://browse/browse?sid=10&cid=' +
      encodeURIComponent(`LIBARTIST-Albums-${artistId}`)
    );

    return (response.payload || []).map(item => ({
      name: item.name || '',
      artist: item.artist || '',
      cid: item.cid || '',
      playable: item.playable === 'yes'
    }));
  }

  async function queueAlbum(albumCid) {
    const response = await heosBrowse(
      'heos://browse/browse?sid=10&cid=' + encodeURIComponent(albumCid)
    );

    const tracks = (response.payload || []).filter(
      item => item.playable === 'yes' && item.mid
    );

    if (!tracks.length) {
      throw new Error('Album has no playable tracks');
    }

    await heosBrowse(
      'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
      '&sid=10&cid=' + encodeURIComponent(albumCid) +
      '&mid=' + encodeURIComponent(tracks[0].mid) + '&aid=4'
    );

    for (const track of tracks.slice(1)) {
      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
        '&sid=10&cid=' + encodeURIComponent(albumCid) +
        '&mid=' + encodeURIComponent(track.mid) + '&aid=3'
      );
    }

    return tracks.length;
  }

  return async function playAlbumByArtist(albumName, artistName) {
    const requestedAlbum = String(albumName || '').trim();
    const requestedArtist = String(artistName || '').trim();

    if (!requestedAlbum || !requestedArtist) {
      throw new Error('Missing album or artist');
    }

    const artists = await searchArtists(requestedArtist);
    const artistMatch = chooseBestMatch(
      artists,
      requestedArtist,
      item => item.name,
      0.5
    );

    if (!artistMatch?.item?.cid) {
      throw new Error(`TIDAL artist not found: ${requestedArtist}`);
    }

    const artist = artistMatch.item;
    const albums = await getArtistAlbums(artist.cid);
    const playableAlbums = albums.filter(item => item.playable && item.cid);
    const albumMatch = chooseBestMatch(
      playableAlbums,
      requestedAlbum,
      item => item.name,
      0.48
    );

    if (!albumMatch?.item?.cid) {
      throw new Error(`TIDAL album not found: ${requestedAlbum} by ${artist.name}`);
    }

    const album = albumMatch.item;

    if (typeof selectTidalSource === 'function') {
      await selectTidalSource();
    }

    const queued = await queueAlbum(album.cid);

    return {
      ok: true,
      action: 'play-album',
      artist: artist.name,
      album: album.name,
      albumCid: album.cid,
      queued,
      match: {
        requestedArtist,
        artistScore: Number(artistMatch.score.toFixed(3)),
        requestedAlbum,
        albumScore: Number(albumMatch.score.toFixed(3))
      }
    };
  };
}

module.exports = { createTidalVoiceControl };

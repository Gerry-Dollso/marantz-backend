'use strict';

function normalise(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARTIST_CORRECTIONS = new Map([
  ['a mass of attack', 'Massive Attack'],
  ['mass of attack', 'Massive Attack'],
  ['moss of attack', 'Massive Attack']
]);

function correctArtistName(value) {
  const key = normalise(value);
  return ARTIST_CORRECTIONS.get(key) || String(value || '').trim();
}

function createTidalArtistVoiceControl({
  heosBrowse,
  heosStart,
  playerId,
  selectTidalSource,
  resolveLearnedArtist
}) {
  const artistCache = new Map();

  async function searchArtists(query) {
    const response = await heosBrowse(
      'heos://browse/search?sid=10&scid=1&search=' + encodeURIComponent(query)
    );

    return (response.payload || [])
      .filter(item => item.cid)
      .map(item => ({
        name: item.name || '',
        cid: String(item.cid)
      }));
  }

  async function resolveArtist(requestedArtist) {
    const learnedArtist =
      typeof resolveLearnedArtist === 'function'
        ? resolveLearnedArtist(requestedArtist)
        : null;

    if (learnedArtist && learnedArtist.name && learnedArtist.cid) {
      const exactArtist = {
        name: String(learnedArtist.name),
        cid: String(learnedArtist.cid)
      };
      const correctedArtist = exactArtist.name;
      const cacheKey = normalise(correctedArtist);

      artistCache.set(cacheKey, exactArtist);
      artistCache.set(normalise(requestedArtist), exactArtist);

      return {
        exactArtist,
        correctedArtist,
        cacheHit: true,
        learnedAlias: true
      };
    }

    const requestedKey = normalise(requestedArtist);
    const correctedArtist = correctArtistName(requestedArtist);
    const cacheKey = normalise(correctedArtist);
    const trustedCorrection =
      ARTIST_CORRECTIONS.has(requestedKey);

    const cachedArtist = trustedCorrection
      ? artistCache.get(cacheKey)
      : null;

    if (cachedArtist) {
      return {
        exactArtist: cachedArtist,
        correctedArtist,
        cacheHit: true,
        learnedAlias: false
      };
    }

    const artists = await searchArtists(correctedArtist);
    const exactArtist = artists.find(
      item => normalise(item.name) === cacheKey
    );

    if (!exactArtist || !trustedCorrection) {
      throw new Error(
        `TIDAL artist not found safely: ${requestedArtist}`
      );
    }

    artistCache.set(cacheKey, exactArtist);

    return {
      exactArtist,
      correctedArtist,
      cacheHit: false,
      learnedAlias: false
    };
  }

  function getArtistTrackContainer(artistCid) {
    const artistId = String(artistCid || '')
      .trim()
      .replace('LIBARTIST-', '');

    return `LIBARTIST-Tracks-${artistId}`;
  }

  async function playArtistContainer(containerCid) {
    const command =
      'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
      '&sid=10&cid=' + encodeURIComponent(containerCid) +
      '&aid=4';

    if (typeof heosStart === 'function') {
      await heosStart(command);
      return;
    }

    await heosBrowse(command);
  }

  return async function playArtist(artistName) {
    const requestedArtist = String(artistName || '').trim();

    if (!requestedArtist) {
      throw new Error('Missing artist');
    }

    const startedAt = Date.now();

    const resolveStartedAt = Date.now();
    const {
      exactArtist,
      correctedArtist,
      cacheHit,
      learnedAlias
    } = await resolveArtist(requestedArtist);
    const resolveArtistMs = Date.now() - resolveStartedAt;

    const cid = getArtistTrackContainer(exactArtist.cid);

    const sourceStartedAt = Date.now();
    if (typeof selectTidalSource === 'function') {
      await selectTidalSource();
    }
    const selectTidalSourceMs = Date.now() - sourceStartedAt;

    const playStartedAt = Date.now();
    await playArtistContainer(cid);
    const playArtistContainerMs = Date.now() - playStartedAt;

    const shuffleStartedAt = Date.now();
    await heosBrowse(
      'heos://player/set_play_mode?pid=' + encodeURIComponent(playerId) +
      '&repeat=off&shuffle=on'
    );
    const setShuffleMs = Date.now() - shuffleStartedAt;

    const timings = {
      resolveArtistMs,
      selectTidalSourceMs,
      playArtistContainerMs,
      setShuffleMs,
      totalMs: Date.now() - startedAt
    };

    console.log(
      'TIDAL ARTIST TIMING:',
      JSON.stringify({
        artist: exactArtist.name,
        cacheHit,
        learnedAlias,
        ...timings
      })
    );

    return {
      ok: true,
      action: 'play-artist',
      artist: exactArtist.name,
      shuffle: true,
      cacheHit,
      learnedAlias,
      timings,
      match: {
        requestedArtist,
        correctedArtist
      }
    };
  };
}

module.exports = { createTidalArtistVoiceControl };

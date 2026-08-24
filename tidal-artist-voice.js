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

function createTidalArtistVoiceControl({ heosBrowse, playerId, selectTidalSource }) {
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
    const correctedArtist = correctArtistName(requestedArtist);
    const artists = await searchArtists(correctedArtist);
    const exactArtist = artists.find(
      item => normalise(item.name) === normalise(correctedArtist)
    );

    if (!exactArtist) {
      throw new Error(`TIDAL artist not found safely: ${requestedArtist}`);
    }

    return { exactArtist, correctedArtist };
  }

  function getArtistTrackContainer(artistCid) {
    const artistId = String(artistCid || '')
      .trim()
      .replace('LIBARTIST-', '');

    return `LIBARTIST-Tracks-${artistId}`;
  }

  async function playArtistContainer(containerCid) {
    await heosBrowse(
      'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
      '&sid=10&cid=' + encodeURIComponent(containerCid) +
      '&aid=4'
    );
  }

  return async function playArtist(artistName) {
    const requestedArtist = String(artistName || '').trim();

    if (!requestedArtist) {
      throw new Error('Missing artist');
    }

    const { exactArtist, correctedArtist } = await resolveArtist(requestedArtist);
    const cid = getArtistTrackContainer(exactArtist.cid);

    if (typeof selectTidalSource === 'function') {
      await selectTidalSource();
    }

    await playArtistContainer(cid);

    await heosBrowse(
      'heos://player/set_play_mode?pid=' + encodeURIComponent(playerId) +
      '&repeat=off&shuffle=on'
    );

    return {
      ok: true,
      action: 'play-artist',
      artist: exactArtist.name,
      shuffle: true,
      match: {
        requestedArtist,
        correctedArtist
      }
    };
  };
}

module.exports = { createTidalArtistVoiceControl };

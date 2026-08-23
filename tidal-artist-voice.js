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

  async function getArtistTracks(artistCid) {
    const artistId = String(artistCid || '')
      .trim()
      .replace('LIBARTIST-', '');
    const cid = `LIBARTIST-Tracks-${artistId}`;

    const response = await heosBrowse(
      'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid),
      8000
    );

    const tracks = (response.payload || []).filter(
      item => item.playable === 'yes' && item.mid
    );

    return { cid, tracks };
  }

  async function queueTracks(containerCid, tracks) {
    if (!tracks.length) {
      throw new Error('Artist has no playable tracks');
    }

    await heosBrowse(
      'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
      '&sid=10&cid=' + encodeURIComponent(containerCid) +
      '&mid=' + encodeURIComponent(tracks[0].mid) + '&aid=4'
    );

    for (const track of tracks.slice(1)) {
      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(playerId) +
        '&sid=10&cid=' + encodeURIComponent(containerCid) +
        '&mid=' + encodeURIComponent(track.mid) + '&aid=3'
      );
    }
  }

  return async function playArtist(artistName) {
    const requestedArtist = String(artistName || '').trim();

    if (!requestedArtist) {
      throw new Error('Missing artist');
    }

    const { exactArtist, correctedArtist } = await resolveArtist(requestedArtist);
    const { cid, tracks } = await getArtistTracks(exactArtist.cid);

    if (typeof selectTidalSource === 'function') {
      await selectTidalSource();
    }

    await queueTracks(cid, tracks);

    await heosBrowse(
      'heos://player/set_play_mode?pid=' + encodeURIComponent(playerId) +
      '&repeat=off&shuffle=on'
    );

    return {
      ok: true,
      action: 'play-artist',
      artist: exactArtist.name,
      queued: tracks.length,
      shuffle: true,
      match: {
        requestedArtist,
        correctedArtist
      }
    };
  };
}

module.exports = { createTidalArtistVoiceControl };

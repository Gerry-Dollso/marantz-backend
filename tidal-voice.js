'use strict';

function normaliseMatchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ');
}

function chooseExactOrClosest(items, requested, getName) {
  const target = normaliseMatchText(requested);

  const exact = items.find(
    item => normaliseMatchText(getName(item)) === target
  );
  if (exact) return exact;

  const edition = items.find(item => {
    const name = normaliseMatchText(getName(item));
    return name.startsWith(`${target} (`) || name.startsWith(`${target} -`);
  });
  if (edition) return edition;

  return items.find(
    item => normaliseMatchText(getName(item)).includes(target)
  ) || null;
}

function createTidalVoiceControl({ heosBrowse, playerId, selectTidalSource }) {
  async function searchArtists(query) {
    const response = await heosBrowse(
      'heos://browse/search?sid=10&scid=1&search=' +
      encodeURIComponent(String(query || '').trim())
    );

    return (response.payload || []).map(item => ({
      name: item.name || '',
      cid: item.cid || ''
    }));
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
    const artist = chooseExactOrClosest(artists, requestedArtist, item => item.name);

    if (!artist || !artist.cid) {
      throw new Error(`TIDAL artist not found: ${requestedArtist}`);
    }

    const albums = await getArtistAlbums(artist.cid);
    const playableAlbums = albums.filter(item => item.playable && item.cid);
    const album = chooseExactOrClosest(playableAlbums, requestedAlbum, item => item.name);

    if (!album || !album.cid) {
      throw new Error(`TIDAL album not found: ${requestedAlbum} by ${artist.name}`);
    }

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
      queued
    };
  };
}

module.exports = { createTidalVoiceControl };

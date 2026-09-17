'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-artist-details.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes('[Artist Details timing]')) {
  throw new Error('Artist Details timing instrumentation is already installed');
}

const oldLoad = `  async function load(artistId) {
    const pause = () => new Promise(resolve => setTimeout(resolve, 250));
    const artistPayload = await apiGet('/artists/' + encodeURIComponent(artistId) + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode));
    await pause();
    const albumsHeos = await heosArtistCategory(artistId, 'Albums');
    const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles');
    const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums');
    await pause();
    const radioPayload = await relationship(artistId, 'radio', 'radio,radio.coverArt,radio.items');
    await pause();
    const similarPayload = await relationship(artistId, 'similarArtists', 'similarArtists.profileArt');
    await pause();
    const topTracks = await getAllTracks(artistId);

    const artistArt = artworkMap(artistPayload);
    const artistResource = Array.isArray(artistPayload?.data) ? artistPayload.data[0] : artistPayload?.data;
    const artist = mapArtist(artistResource, artistArt);
    const [albums, singles, appearsOn] = await enrichHeosAlbums([albumsHeos.rows, singlesHeos.rows, appearsOnHeos.rows]);
    const similarArt = artworkMap(similarPayload);
    const similarArtists = resources(similarPayload, 'artists').map(item => mapArtist(item, similarArt));
    const radioResource = resources(radioPayload, 'playlists')[0] || null;
    const radio = radioResource ? { playlistId: String(radioResource.id || ''), name: String(radioResource.attributes?.name || radioResource.attributes?.title || artist.name || '') } : null;

    const biography = await biographyResolver.getBiography({
      artistId: artist.id,
      name: artist.name,
      albumTitles: [...albums, ...singles, ...appearsOn].map(item => item.name || item.title).filter(Boolean)
    });

    return { artist, topTracks, albums, singles, radio, similarArtists, biography, appearsOn, source: 'TIDAL + HEOS hybrid' };
  }
`;

const newLoad = `  async function load(artistId) {
    const startedAt = Date.now();
    let stageAt = startedAt;
    const timing = {};
    const mark = name => {
      const now = Date.now();
      timing[name] = now - stageAt;
      stageAt = now;
    };
    const pause = () => new Promise(resolve => setTimeout(resolve, 250));
    const artistPayload = await apiGet('/artists/' + encodeURIComponent(artistId) + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode));
    mark('artistProfileMs');
    await pause();
    const albumsHeos = await heosArtistCategory(artistId, 'Albums');
    mark('albumsHeosMs');
    const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles');
    mark('singlesHeosMs');
    const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums');
    mark('appearsOnHeosMs');
    await pause();
    const radioPayload = await relationship(artistId, 'radio', 'radio,radio.coverArt,radio.items');
    mark('radioMs');
    await pause();
    const similarPayload = await relationship(artistId, 'similarArtists', 'similarArtists.profileArt');
    mark('similarArtistsMs');
    await pause();
    const topTracks = await getAllTracks(artistId);
    mark('topTracksMs');

    const artistArt = artworkMap(artistPayload);
    const artistResource = Array.isArray(artistPayload?.data) ? artistPayload.data[0] : artistPayload?.data;
    const artist = mapArtist(artistResource, artistArt);
    const [albums, singles, appearsOn] = await enrichHeosAlbums([albumsHeos.rows, singlesHeos.rows, appearsOnHeos.rows]);
    mark('albumMetadataEnrichmentMs');
    const similarArt = artworkMap(similarPayload);
    const similarArtists = resources(similarPayload, 'artists').map(item => mapArtist(item, similarArt));
    const radioResource = resources(radioPayload, 'playlists')[0] || null;
    const radio = radioResource ? { playlistId: String(radioResource.id || ''), name: String(radioResource.attributes?.name || radioResource.attributes?.title || artist.name || '') } : null;

    const biography = await biographyResolver.getBiography({
      artistId: artist.id,
      name: artist.name,
      albumTitles: [...albums, ...singles, ...appearsOn].map(item => item.name || item.title).filter(Boolean)
    });
    mark('biographyMs');
    timing.totalMs = Date.now() - startedAt;
    console.log('[Artist Details timing]', JSON.stringify({ artistId: String(artistId), artist: artist.name, ...timing }));

    return { artist, topTracks, albums, singles, radio, similarArtists, biography, appearsOn, source: 'TIDAL + HEOS hybrid' };
  }
`;

if (!source.includes(oldLoad)) {
  throw new Error('Expected load() block not found; refusing to modify tidal-artist-details.js');
}

source = source.replace(oldLoad, newLoad);
fs.writeFileSync(target, source, 'utf8');
console.log('Installed guarded Artist Details per-stage timing instrumentation');

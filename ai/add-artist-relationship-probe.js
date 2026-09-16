'use strict';

const fs = require('fs');

const file = 'tidal-user-auth-recon.js';
let source = fs.readFileSync(file, 'utf8');

const functionMarker = '  async function probeArtistMetadata(artistId) {';
if (!source.includes(functionMarker)) throw new Error('probeArtistMetadata marker not found');
if (source.includes('probeArtistRelationship(artistId, relationship)')) throw new Error('Artist relationship probe already installed');

const functionText = `  async function probeArtistRelationship(artistId, relationship) {
    if (!/^\\d+$/.test(artistId || '')) {
      throw new Error('Artist id must contain digits only');
    }

    const includes = {
      albums: 'albums.coverArt,albums.artists',
      biography: 'biography',
      radio: 'radio,radio.albums,radio.artists,radio.albums.coverArt',
      similarArtists: 'similarArtists.profileArt',
      tracks: 'tracks.albums,tracks.artists,tracks.albums.coverArt',
      videos: 'videos.thumbnailArt,videos.artists',
      roles: 'roles'
    };
    const include = includes[relationship];
    if (!include) throw new Error('Unsupported artist relationship');

    return apiGetRaw(
      '/artists/' + encodeURIComponent(artistId) + '/relationships/' + encodeURIComponent(relationship) +
      '?include=' + encodeURIComponent(include) +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }

`;
source = source.replace(functionMarker, functionText + functionMarker);

const routeMarker = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-artist') {";
if (!source.includes(routeMarker)) throw new Error('probe-artist route marker not found');

const routeText = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-artist-relationship') {
      try {
        const artistId = requestUrl.searchParams.get('id') || '';
        const relationship = requestUrl.searchParams.get('relationship') || '';
        const result = await probeArtistRelationship(artistId, relationship);
        return sendJson(res, 200, { ok: true, artistId, relationship, result });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

`;
source = source.replace(routeMarker, routeText + routeMarker);

fs.writeFileSync(file, source);
console.log('Added temporary artist relationship probe to ' + file);

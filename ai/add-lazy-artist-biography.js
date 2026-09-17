'use strict';

const fs = require('fs');

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(label + ': expected exactly one match, found ' + count);
  return text.replace(before, after);
}

const detailsPath = 'tidal-artist-details.js';
const serverPath = 'server.js';
let details = fs.readFileSync(detailsPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

if (!details.includes("const APPEARS_ON_PREVIEW_LIMIT = 4;")) throw new Error('Expected Appears On optimization checkpoint is missing');
if (!details.includes("console.log('[Artist Details timing]'")) throw new Error('Expected Artist Details timing checkpoint is missing');
if (details.includes('async function getArtistBiography(') || server.includes('/api/tidal/artist-biography?')) throw new Error('Lazy biography change appears to be installed already');

const oldBiography = `    const biography = await biographyResolver.getBiography({
      artistId: artist.id,
      name: artist.name,
      albumTitles: [...albums, ...singles, ...appearsOn].map(item => item.name || item.title).filter(Boolean)
    });
    mark('biographyMs');
    timing.totalMs = Date.now() - startedAt;
    console.log('[Artist Details timing]', JSON.stringify({ artistId: String(artistId), artist: artist.name, ...timing }));

    return { artist, topTracks, albums, singles, radio, similarArtists, biography, appearsOn, source: 'TIDAL + HEOS hybrid' };`;
const newBiography = `    timing.totalMs = Date.now() - startedAt;
    console.log('[Artist Details timing]', JSON.stringify({ artistId: String(artistId), artist: artist.name, ...timing }));

    return { artist, topTracks, albums, singles, radio, similarArtists, biography: null, appearsOn, source: 'TIDAL + HEOS hybrid' };`;
details = replaceOnce(details, oldBiography, newBiography, 'remove blocking biography');

const oldReturn = `  return { getArtistDetails };
}`;
const newReturn = `  async function getArtistBiography(artistId, options = {}) {
    const id = String(artistId || '').trim();
    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const details = await getArtistDetails(id);
    const artist = details?.artist || {};
    const name = String(artist.name || '').trim();
    if (!name) return null;
    const albumTitles = [...(details.albums || []), ...(details.singles || []), ...(details.appearsOn || [])]
      .map(item => item.name || item.title)
      .filter(Boolean);
    return biographyResolver.getBiography({ artistId: id, name, albumTitles }, options);
  }

  return { getArtistDetails, getArtistBiography };
}`;
details = replaceOnce(details, oldReturn, newReturn, 'export lazy biography method');

const routeAnchor = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist/albums?')) {`;
const biographyRoute = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-biography?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const artistId = url.searchParams.get('id') || '';
      const biography = await tidalArtistDetails.getArtistBiography(artistId, {
        forceRefresh: url.searchParams.get('refresh') === '1'
      });
      return sendJson(res, 200, { ok: true, artistId: String(artistId), biography });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error.message });
    }
  }

` + routeAnchor;
server = replaceOnce(server, routeAnchor, biographyRoute, 'insert biography route');

fs.writeFileSync(detailsPath, details);
fs.writeFileSync(serverPath, server);
console.log('Installed guarded lazy Artist biography backend split');

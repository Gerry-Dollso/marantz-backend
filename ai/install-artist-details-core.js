'use strict';

const fs = require('fs');

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(label + ' marker not found');
  if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(label + ' marker is not unique');
  return source.replace(before, after);
}

const authFile = 'tidal-user-auth-recon.js';
let auth = fs.readFileSync(authFile, 'utf8');
auth = replaceOnce(
  auth,
  '    handle,\n    getTrackMetadata: probeTrackMetadata,',
  '    handle,\n    authenticatedApiGet: apiGetRaw,\n    getTrackMetadata: probeTrackMetadata,',
  'authenticated API export'
);
fs.writeFileSync(authFile, auth);

const moduleFile = 'tidal-artist-details.js';
if (fs.existsSync(moduleFile)) throw new Error(moduleFile + ' already exists');
fs.writeFileSync(moduleFile, `'use strict';

const ARTIST_DETAILS_TTL_MS = 15 * 60 * 1000;
const MAX_TRACK_PAGES = 50;
const TOP_TRACK_LIMIT = 10;

function createTidalArtistDetails(options = {}) {
  const apiGet = options.apiGet;
  const countryCode = String(options.countryCode || 'GB').trim() || 'GB';
  if (typeof apiGet !== 'function') throw new Error('apiGet is required');

  const cache = new Map();
  const inFlight = new Map();

  function resources(payload, type) {
    return (Array.isArray(payload?.included) ? payload.included : [])
      .filter(item => item && item.type === type);
  }

  function artworkUrl(resource) {
    const files = resource?.attributes?.files;
    if (!Array.isArray(files) || !files.length) return '';
    const sorted = files.slice().sort((a, b) =>
      (Number(b.width) || 0) * (Number(b.height) || 0) -
      (Number(a.width) || 0) * (Number(a.height) || 0)
    );
    return String(sorted[0]?.href || sorted[0]?.url || '');
  }

  function artworkMap(payload) {
    return new Map(resources(payload, 'artworks').map(item => [String(item.id), artworkUrl(item)]));
  }

  function relatedId(resource, key) {
    const data = resource?.relationships?.[key]?.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first?.id ? String(first.id) : '';
  }

  function mapArtist(resource, art) {
    const a = resource?.attributes || {};
    const artId = relatedId(resource, 'profileArt');
    return {
      id: String(resource?.id || ''),
      name: String(a.name || ''),
      fans: Number(a.followers) || 0,
      popularity: Number(a.popularity) || 0,
      imageUrl: art.get(artId) || '',
      heosCid: resource?.id ? 'LIBARTIST-' + resource.id : ''
    };
  }

  function mapAlbum(resource, art) {
    const a = resource?.attributes || {};
    const artId = relatedId(resource, 'coverArt');
    return {
      id: String(resource?.id || ''),
      title: String(a.title || ''),
      releaseDate: String(a.releaseDate || ''),
      albumType: String(a.albumType || ''),
      version: String(a.version || ''),
      numberOfItems: Number(a.numberOfItems) || 0,
      popularity: Number(a.popularity) || 0,
      imageUrl: art.get(artId) || '',
      heosCid: resource?.id ? 'LIBALBUM-' + resource.id : ''
    };
  }

  function mapTrack(resource, payload, art) {
    const a = resource?.attributes || {};
    const albumId = relatedId(resource, 'albums') || relatedId(resource, 'album');
    const album = resources(payload, 'albums').find(item => String(item.id) === albumId);
    const albumArtId = relatedId(album, 'coverArt');
    return {
      id: String(resource?.id || ''),
      title: String(a.title || ''),
      popularity: Number(a.popularity) || 0,
      duration: Number(a.duration) || 0,
      explicit: Boolean(a.explicit),
      albumId,
      album: String(album?.attributes?.title || ''),
      imageUrl: art.get(albumArtId) || ''
    };
  }

  async function relationship(artistId, name, include, extra = '') {
    return apiGet(
      '/artists/' + encodeURIComponent(artistId) + '/relationships/' + encodeURIComponent(name) +
      '?' + extra + 'include=' + encodeURIComponent(include) +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }

  async function getAllTracks(artistId) {
    const byId = new Map();
    let cursor = '';
    for (let page = 0; page < MAX_TRACK_PAGES; page += 1) {
      const suffix = cursor ? '&page%5Bcursor%5D=' + encodeURIComponent(cursor) : '';
      const payload = await apiGet(
        '/artists/' + encodeURIComponent(artistId) + '/relationships/tracks' +
        '?collapseBy=FINGERPRINT&include=' + encodeURIComponent('tracks.albums,tracks.artists,tracks.albums.coverArt') +
        '&countryCode=' + encodeURIComponent(countryCode) + suffix
      );
      const art = artworkMap(payload);
      for (const track of resources(payload, 'tracks')) {
        const mapped = mapTrack(track, payload, art);
        const previous = byId.get(mapped.id);
        if (!previous || mapped.popularity > previous.popularity) byId.set(mapped.id, mapped);
      }
      cursor = String(payload?.links?.meta?.nextCursor || payload?.meta?.nextCursor || '');
      if (!cursor) break;
    }
    return Array.from(byId.values())
      .sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title))
      .slice(0, TOP_TRACK_LIMIT);
  }

  async function load(artistId) {
    const [artistPayload, albumsPayload, radioPayload, similarPayload, topTracks] = await Promise.all([
      apiGet('/artists/' + encodeURIComponent(artistId) + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode)),
      relationship(artistId, 'albums', 'albums.coverArt,albums.artists'),
      relationship(artistId, 'radio', 'radio,radio.coverArt,radio.items'),
      relationship(artistId, 'similarArtists', 'similarArtists.profileArt'),
      getAllTracks(artistId)
    ]);

    const artistArt = artworkMap(artistPayload);
    const artistResource = Array.isArray(artistPayload?.data) ? artistPayload.data[0] : artistPayload?.data;
    const artist = mapArtist(artistResource, artistArt);

    const albumArt = artworkMap(albumsPayload);
    const releases = resources(albumsPayload, 'albums').map(item => mapAlbum(item, albumArt));
    const albums = releases.filter(item => item.albumType === 'ALBUM');
    const singles = releases.filter(item => item.albumType === 'SINGLE');

    const similarArt = artworkMap(similarPayload);
    const similarArtists = resources(similarPayload, 'artists').map(item => mapArtist(item, similarArt));

    const radioResource = resources(radioPayload, 'playlists')[0] || null;
    const radio = radioResource ? {
      playlistId: String(radioResource.id || ''),
      name: String(radioResource.attributes?.name || radioResource.attributes?.title || artist.name || '')
    } : null;

    return {
      artist,
      topTracks,
      albums,
      singles,
      radio,
      similarArtists,
      biography: null,
      appearsOn: [],
      source: 'TIDAL public API'
    };
  }

  async function getArtistDetails(artistId, options = {}) {
    const id = String(artistId || '').trim();
    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const forceRefresh = options.forceRefresh === true;
    const cached = cache.get(id);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
      return { ...cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt };
    }
    if (!forceRefresh && inFlight.has(id)) return inFlight.get(id);
    const promise = (async () => {
      const value = await load(id);
      const createdAt = Date.now();
      cache.set(id, { value, createdAt, expiresAt: createdAt + ARTIST_DETAILS_TTL_MS });
      return { ...value, cached: false, cacheAgeMs: 0 };
    })();
    inFlight.set(id, promise);
    try { return await promise; } finally { if (inFlight.get(id) === promise) inFlight.delete(id); }
  }

  return { getArtistDetails };
}

module.exports = { createTidalArtistDetails };
`);

const serverFile = 'server.js';
let server = fs.readFileSync(serverFile, 'utf8');
server = replaceOnce(
  server,
  "const {\n  createTidalUserAuthRecon\n} = require('./tidal-user-auth-recon');",
  "const {\n  createTidalUserAuthRecon\n} = require('./tidal-user-auth-recon');\nconst { createTidalArtistDetails } = require('./tidal-artist-details');",
  'artist details require'
);
server = replaceOnce(
  server,
  "const tidalUserAuthRecon = createTidalUserAuthRecon({\n  countryCode: 'GB'\n});",
  "const tidalUserAuthRecon = createTidalUserAuthRecon({\n  countryCode: 'GB'\n});\nconst tidalArtistDetails = createTidalArtistDetails({\n  apiGet: tidalUserAuthRecon.authenticatedApiGet,\n  countryCode: 'GB'\n});",
  'artist details construction'
);
server = replaceOnce(
  server,
  "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist/albums?')) {",
  "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-details?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const artistId = url.searchParams.get('id') || '';\n      const details = await tidalArtistDetails.getArtistDetails(artistId, {\n        forceRefresh: url.searchParams.get('refresh') === '1'\n      });\n      return sendJson(res, 200, { ok: true, ...details });\n    } catch (error) {\n      return sendJson(res, 500, { ok: false, error: error.message });\n    }\n  }\n\n  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist/albums?')) {",
  'artist details route'
);
fs.writeFileSync(serverFile, server);

console.log('Installed production TIDAL artist details core');

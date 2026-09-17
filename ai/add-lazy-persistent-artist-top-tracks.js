'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-artist-details.js');
let source = fs.readFileSync(target, 'utf8');

const guards = [
  "const { createTidalArtistDetailsStore } = require('./tidal-artist-details-store');",
  'const TOP_TRACK_LIMIT = 10;',
  'const RELEASE_PREVIEW_LIMIT = 3;',
  'const topTracks = await getAllTracks(artistId);',
  "mark('topTracksMs');",
  "return { artist, topTracks, albums, singles, radio, similarArtists, biography: null, appearsOn, source: 'TIDAL + HEOS hybrid' };",
  'return { getArtistDetails, getArtistBiography };'
];
for (const marker of guards) if (!source.includes(marker)) throw new Error('Guard failed; expected marker missing: ' + marker);
if (source.includes('createTidalArtistTopTracksStore')) throw new Error('Lazy persistent Artist Top Tracks already installed');

source = source.replace(
  "const { createTidalArtistDetailsStore } = require('./tidal-artist-details-store');",
  "const { createTidalArtistDetailsStore } = require('./tidal-artist-details-store');\nconst { createTidalArtistTopTracksStore } = require('./tidal-artist-top-tracks-store');"
);
source = source.replace(
  '  const persistentStore = options.persistentStore || createTidalArtistDetailsStore(options.persistentStoreOptions);',
  "  const persistentStore = options.persistentStore || createTidalArtistDetailsStore(options.persistentStoreOptions);\n  const topTracksStore = options.topTracksStore || createTidalArtistTopTracksStore(options.topTracksStoreOptions);"
);
source = source.replace(
  '  const inFlight = new Map();',
  '  const inFlight = new Map();\n  const topTracksCache = new Map();\n  const topTracksInFlight = new Map();'
);
source = source.replace(
  "    await pause();\n    const topTracks = await getAllTracks(artistId);\n    mark('topTracksMs');\n\n    const artistArt = artworkMap(artistPayload);",
  "\n    const artistArt = artworkMap(artistPayload);"
);
source = source.replace(
  "    return { artist, topTracks, albums, singles, radio, similarArtists, biography: null, appearsOn, source: 'TIDAL + HEOS hybrid' };",
  "    return { artist, topTracks: [], albums, singles, radio, similarArtists, biography: null, appearsOn, source: 'TIDAL + HEOS hybrid' };"
);

const biographyMarker = '  async function getArtistBiography(artistId, options = {}) {';
const topTracksMethods = `  function rememberTopTracks(id, value, createdAt) {\n    topTracksCache.set(id, { value, createdAt, expiresAt: Date.now() + ARTIST_DETAILS_TTL_MS });\n  }\n\n  function startTopTracksRefresh(id) {\n    if (topTracksInFlight.has(id)) return topTracksInFlight.get(id);\n    const promise = (async () => {\n      const value = await getAllTracks(id);\n      const createdAt = Date.now();\n      rememberTopTracks(id, value, createdAt);\n      try { topTracksStore.write(id, value, createdAt); }\n      catch (error) { console.warn('TIDAL Artist Top Tracks persistent cache write failed:', error.message); }\n      return { tracks: value, cached: false, cacheAgeMs: 0, cacheSource: 'refresh' };\n    })();\n    topTracksInFlight.set(id, promise);\n    promise.finally(() => { if (topTracksInFlight.get(id) === promise) topTracksInFlight.delete(id); }).catch(() => {});\n    return promise;\n  }\n\n  async function getArtistTopTracks(artistId, options = {}) {\n    const id = String(artistId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');\n    const forceRefresh = options.forceRefresh === true;\n    const cached = topTracksCache.get(id);\n    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {\n      return { tracks: cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt, cacheSource: 'memory' };\n    }\n    if (!forceRefresh) {\n      const disk = topTracksStore.read(id);\n      if (disk) {\n        rememberTopTracks(id, disk.value, disk.createdAt);\n        if (!disk.fresh) startTopTracksRefresh(id).catch(error => console.warn('TIDAL Artist Top Tracks background refresh failed:', error.message));\n        return { tracks: disk.value, cached: true, cacheAgeMs: disk.ageMs, cacheSource: disk.fresh ? 'disk' : 'disk-stale', refreshing: !disk.fresh };\n      }\n      if (topTracksInFlight.has(id)) return topTracksInFlight.get(id);\n    }\n    return startTopTracksRefresh(id);\n  }\n\n`;
if (!source.includes(biographyMarker)) throw new Error('Guard failed; biography insertion marker missing');
source = source.replace(biographyMarker, topTracksMethods + biographyMarker);
source = source.replace(
  '  return { getArtistDetails, getArtistBiography };',
  '  return { getArtistDetails, getArtistTopTracks, getArtistBiography };'
);

fs.writeFileSync(target, source);
console.log('Installed guarded lazy persistent Artist Top Tracks backend split');

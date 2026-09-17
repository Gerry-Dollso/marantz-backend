'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'tidal-artist-details.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected anchor not found');
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(label + ': anchor was not unique');
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'persistent store import',
  "const { createArtistBiography } = require('./artist-biography');\n",
  "const { createArtistBiography } = require('./artist-biography');\nconst { createTidalArtistDetailsStore } = require('./tidal-artist-details-store');\n"
);

replaceOnce(
  'persistent store instance',
  "  const biographyResolver = options.biographyResolver || createArtistBiography();\n\n  const cache = new Map();\n",
  "  const biographyResolver = options.biographyResolver || createArtistBiography();\n  const persistentStore = options.persistentStore || createTidalArtistDetailsStore(options.persistentStoreOptions);\n\n  const cache = new Map();\n"
);

replaceOnce(
  'artist details cache function',
  "  async function getArtistDetails(artistId, options = {}) {\n    const id = String(artistId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');\n    const forceRefresh = options.forceRefresh === true;\n    const cached = cache.get(id);\n    if (!forceRefresh && cached && Date.now() < cached.expiresAt) return { ...cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt };\n    if (!forceRefresh && inFlight.has(id)) return inFlight.get(id);\n    const promise = (async () => {\n      const value = await load(id);\n      const createdAt = Date.now();\n      cache.set(id, { value, createdAt, expiresAt: createdAt + ARTIST_DETAILS_TTL_MS });\n      return { ...value, cached: false, cacheAgeMs: 0 };\n    })();\n    inFlight.set(id, promise);\n    try { return await promise; } finally { if (inFlight.get(id) === promise) inFlight.delete(id); }\n  }\n",
  "  function remember(id, value, createdAt) {\n    cache.set(id, { value, createdAt, expiresAt: Date.now() + ARTIST_DETAILS_TTL_MS });\n  }\n\n  function startRefresh(id) {\n    if (inFlight.has(id)) return inFlight.get(id);\n    const promise = (async () => {\n      const value = await load(id);\n      const createdAt = Date.now();\n      remember(id, value, createdAt);\n      try { persistentStore.write(id, value, createdAt); }\n      catch (error) { console.warn('TIDAL Artist Details persistent cache write failed:', error.message); }\n      return { ...value, cached: false, cacheAgeMs: 0, cacheSource: 'refresh' };\n    })();\n    inFlight.set(id, promise);\n    promise.finally(() => { if (inFlight.get(id) === promise) inFlight.delete(id); }).catch(() => {});\n    return promise;\n  }\n\n  async function getArtistDetails(artistId, options = {}) {\n    const id = String(artistId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');\n    const forceRefresh = options.forceRefresh === true;\n    const cached = cache.get(id);\n    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {\n      return { ...cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt, cacheSource: 'memory' };\n    }\n    if (!forceRefresh) {\n      const disk = persistentStore.read(id);\n      if (disk) {\n        remember(id, disk.value, disk.createdAt);\n        if (!disk.fresh) startRefresh(id).catch(error => console.warn('TIDAL Artist Details background refresh failed:', error.message));\n        return { ...disk.value, cached: true, cacheAgeMs: disk.ageMs, cacheSource: disk.fresh ? 'disk' : 'disk-stale', refreshing: !disk.fresh };\n      }\n      if (inFlight.has(id)) return inFlight.get(id);\n    }\n    return startRefresh(id);\n  }\n"
);

fs.writeFileSync(target, source, 'utf8');
console.log('Applied persistent TIDAL Artist Details cache to tidal-artist-details.js');

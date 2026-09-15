'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'tidal-user-auth-recon.js');
let auth = fs.readFileSync(authPath, 'utf8');

function exactlyOnce(source, needle, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one ${label}, found ${count}`);
}

const stateOld = "  const favouriteTracksCache = { value: null, expiresAt: 0 };\n  let favouriteTracksRefreshInFlight = null;";
const stateNew = "  const favouriteTracksCache = { value: null, expiresAt: 0 };\n  let favouriteTracksCacheGeneration = 0;\n  let favouriteTracksRefreshInFlight = null;\n  let favouriteTracksRefreshGeneration = null;";

const mutationOld = "    favouriteTracksCache.value = null;\n    favouriteTracksCache.expiresAt = 0;\n    return { httpStatus: response.status, payload };";
const mutationNew = "    favouriteTracksCacheGeneration += 1;\n    favouriteTracksCache.value = null;\n    favouriteTracksCache.expiresAt = 0;\n    return { httpStatus: response.status, payload };";

const refreshStartOld = "  async function refreshFavouriteTracks() {\n    if (favouriteTracksRefreshInFlight) return favouriteTracksRefreshInFlight;\n\n    favouriteTracksRefreshInFlight = (async () => {\n      const startedAt = Date.now();";
const refreshStartNew = "  async function refreshFavouriteTracks() {\n    const generation = favouriteTracksCacheGeneration;\n    if (favouriteTracksRefreshInFlight) {\n      if (favouriteTracksRefreshGeneration === generation) return favouriteTracksRefreshInFlight;\n      try { await favouriteTracksRefreshInFlight; } catch {}\n      return refreshFavouriteTracks();\n    }\n\n    favouriteTracksRefreshGeneration = generation;\n    favouriteTracksRefreshInFlight = (async () => {\n      const startedAt = Date.now();";

const cacheWriteOld = "      favouriteTracksCache.value = value;\n      favouriteTracksCache.expiresAt = refreshedAt + FAVOURITE_TRACKS_TTL_MS;\n      return value;";
const cacheWriteNew = "      if (generation === favouriteTracksCacheGeneration) {\n        favouriteTracksCache.value = value;\n        favouriteTracksCache.expiresAt = refreshedAt + FAVOURITE_TRACKS_TTL_MS;\n      }\n      return value;";

const refreshFinallyOld = "    } finally {\n      favouriteTracksRefreshInFlight = null;\n    }\n  }\n\n  async function getFavouriteTracks(options = {}) {";
const refreshFinallyNew = "    } finally {\n      favouriteTracksRefreshInFlight = null;\n      favouriteTracksRefreshGeneration = null;\n    }\n  }\n\n  async function getFavouriteTracks(options = {}) {";

const already = auth.includes('let favouriteTracksCacheGeneration = 0;') &&
  auth.includes('let favouriteTracksRefreshGeneration = null;') &&
  auth.includes('favouriteTracksCacheGeneration += 1;');
if (already) {
  console.log(checkOnly ? 'OK: TIDAL favourite cache race guard already present' : 'No change: TIDAL favourite cache race guard already present');
  process.exit(0);
}

exactlyOnce(auth, stateOld, 'favourite cache state anchor');
exactlyOnce(auth, mutationOld, 'favourite mutation cache anchor');
exactlyOnce(auth, refreshStartOld, 'favourite refresh start anchor');
exactlyOnce(auth, cacheWriteOld, 'favourite cache write anchor');
exactlyOnce(auth, refreshFinallyOld, 'favourite refresh finally anchor');

if (checkOnly) {
  console.log('OK: guarded TIDAL favourite cache race patch can be applied cleanly');
  process.exit(0);
}

auth = auth.replace(stateOld, stateNew);
auth = auth.replace(mutationOld, mutationNew);
auth = auth.replace(refreshStartOld, refreshStartNew);
auth = auth.replace(cacheWriteOld, cacheWriteNew);
auth = auth.replace(refreshFinallyOld, refreshFinallyNew);
fs.writeFileSync(authPath, auth);
console.log('Updated TIDAL Favourite Tracks cache with mutation generation guard');

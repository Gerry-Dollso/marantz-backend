'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const target = path.resolve(__dirname, '..', 'server.js');
let source = fs.readFileSync(target, 'utf8');

const stateAnchor = `let favouriteTracksValidationCache = null;\n`;
const stateReplacement = `let favouriteTracksValidationCache = null;\nconst recentFavouriteTrackMutations = new Map();\n`;

const statusAnchor = `      const official = await tidalUserAuthRecon.getFavouriteTracks();\n      const tracks = Array.isArray(official.tracks) ? official.tracks : [];\n      const favourite = tracks.some(track => String(track?.id || '') === officialId);\n\n      return sendJson(res, 200, {\n        ok: true,\n        readOnly: true,\n        id: officialId,\n        favourite,\n        collectionCached: Boolean(official.cached),\n        collectionStale: Boolean(official.stale)\n      });`;
const statusReplacement = `      if (recentFavouriteTrackMutations.has(officialId)) {\n        return sendJson(res, 200, {\n          ok: true,\n          readOnly: true,\n          id: officialId,\n          favourite: recentFavouriteTrackMutations.get(officialId),\n          recentMutation: true\n        });\n      }\n\n      const official = await tidalUserAuthRecon.getFavouriteTracks();\n      const tracks = Array.isArray(official.tracks) ? official.tracks : [];\n      const favourite = tracks.some(track => String(track?.id || '') === officialId);\n\n      return sendJson(res, 200, {\n        ok: true,\n        readOnly: true,\n        id: officialId,\n        favourite,\n        collectionCached: Boolean(official.cached),\n        collectionStale: Boolean(official.stale)\n      });`;

const mutationAnchor = `      const mutation = await tidalUserAuthRecon.mutateFavouriteTrack(officialId, favourite, idempotencyKey);\n      invalidateFavouriteTracksPlaybackValidation();\n\n      return sendJson(res, 200, {`;
const mutationReplacement = `      const mutation = await tidalUserAuthRecon.mutateFavouriteTrack(officialId, favourite, idempotencyKey);\n      invalidateFavouriteTracksPlaybackValidation();\n      recentFavouriteTrackMutations.set(officialId, favourite);\n\n      return sendJson(res, 200, {`;

const replacements = [
  [stateAnchor, stateReplacement, 'recent mutation state'],
  [statusAnchor, statusReplacement, 'single-track status overlay'],
  [mutationAnchor, mutationReplacement, 'mutation overlay update']
];

for (const [before, after, label] of replacements) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    console.error(`REFUSED: expected exactly one ${label} anchor, found ${count}`);
    process.exit(1);
  }
  source = source.replace(before, after);
}

if (checkOnly) {
  console.log('OK: guarded favourite heart status overlay can be applied cleanly');
  process.exit(0);
}

fs.writeFileSync(target, source);
console.log('Added recent-mutation overlay to single-track favourite status');

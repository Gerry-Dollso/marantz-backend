'use strict';

const fs = require('fs');
const path = 'server.js';
const source = fs.readFileSync(path, 'utf8');

const oldBlock = `  if (sameCollection && ageMs <= FAVOURITE_TRACKS_VALIDATION_MAX_AGE_MS) {
    if (!favouriteTracksValidationRefresh) {
      refreshFavouriteTracksPlaybackValidation().catch(error => {
        console.warn('TIDAL Favourite Tracks validation refresh failed:', error.message);
      });
    }
    return { tracks, validationCached: true, validationAgeMs: ageMs, validationRefreshing: true };
  }
`;

const newBlock = `  if (sameCollection && ageMs <= FAVOURITE_TRACKS_VALIDATION_MAX_AGE_MS) {
    return { tracks, validationCached: true, validationAgeMs: ageMs, validationRefreshDeferred: true };
  }
`;

const matches = source.split(oldBlock).length - 1;
if (matches !== 1) {
  throw new Error('Expected exactly one stale validation refresh block; found ' + matches);
}

fs.writeFileSync(path, source.replace(oldBlock, newBlock));
console.log('Deferred stale Favourite Tracks HEOS validation until a later playback boundary.');

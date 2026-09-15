'use strict';

const fs = require('fs');
const path = 'server.js';
const checkOnly = process.argv.includes('--check');
const source = fs.readFileSync(path, 'utf8');

const oldBlock = `      const mutation = await tidalUserAuthRecon.mutateFavouriteTrack(officialId, favourite, idempotencyKey);
      invalidateFavouriteTracksPlaybackValidation();
      const refreshed = await tidalUserAuthRecon.getFavouriteTracks({ forceRefresh: true });
      const tracks = Array.isArray(refreshed.tracks) ? refreshed.tracks : [];
      const confirmed = tracks.some(track => String(track?.id || '') === officialId);
      if (confirmed !== favourite) {
        return sendJson(res, 502, { ok: false, id: officialId, favourite: confirmed, error: 'TIDAL collection mutation was not confirmed by the subsequent official collection read' });
      }

      return sendJson(res, 200, {
        ok: true,
        id: officialId,
        favourite: confirmed,
        operation: favourite ? 'add' : 'remove',
        tidalHttpStatus: mutation.httpStatus,
        collectionRefreshed: true
      });`;

const newBlock = `      const mutation = await tidalUserAuthRecon.mutateFavouriteTrack(officialId, favourite, idempotencyKey);
      invalidateFavouriteTracksPlaybackValidation();

      return sendJson(res, 200, {
        ok: true,
        id: officialId,
        favourite,
        operation: favourite ? 'add' : 'remove',
        tidalHttpStatus: mutation.httpStatus,
        collectionInvalidated: true
      });`;

const count = source.split(oldBlock).length - 1;
if (count !== 1) {
  console.error('REFUSED: expected exactly one known favourite mutation block, found ' + count);
  process.exit(1);
}

if (checkOnly) {
  console.log('OK: guarded favourite heart latency fix can be applied cleanly');
  process.exit(0);
}

fs.writeFileSync(path, source.replace(oldBlock, newBlock));
console.log('Removed synchronous Favourite Tracks rebuild from heart mutation path');

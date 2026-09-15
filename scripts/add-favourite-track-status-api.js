'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const target = path.resolve(__dirname, '..', 'server.js');
const source = fs.readFileSync(target, 'utf8');

const marker = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-tracks')) {";
const routeMarker = "url.pathname === '/api/tidal/favourite-track-status'";

if (source.includes(routeMarker)) {
  console.log(checkOnly ? 'OK: favourite track status API already present' : 'No change: favourite track status API already present');
  process.exit(0);
}

const occurrences = source.split(marker).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one favourite-tracks route anchor, found ${occurrences}`);
}

const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-track-status?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      if (!/^\\d+$/.test(id)) {
        return sendJson(res, 400, { ok: false, readOnly: true, error: 'Track id must contain digits only' });
      }

      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);
      const officialId = String(metadata?.data?.id || '');
      if (officialId !== id || metadata?.data?.type !== 'tracks') {
        return sendJson(res, 409, {
          ok: false,
          readOnly: true,
          error: 'Track id did not resolve to the same official TIDAL track id'
        });
      }

      const official = await tidalUserAuthRecon.getFavouriteTracks();
      const tracks = Array.isArray(official.tracks) ? official.tracks : [];
      const favourite = tracks.some(track => String(track?.id || '') === officialId);

      return sendJson(res, 200, {
        ok: true,
        readOnly: true,
        id: officialId,
        favourite,
        collectionCached: Boolean(official.cached),
        collectionStale: Boolean(official.stale)
      });
    } catch (error) {
      const message = String(error?.message || error);
      const statusCode = /^404:/.test(message) ? 404 : 502;
      return sendJson(res, statusCode, { ok: false, readOnly: true, error: message });
    }
  }

`;

const updated = source.replace(marker, route + marker);

if (checkOnly) {
  console.log('OK: guarded patch can be applied cleanly');
  process.exit(0);
}

fs.writeFileSync(target, updated);
console.log('Updated server.js with read-only favourite track status API');

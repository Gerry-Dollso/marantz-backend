'use strict';

// Guarded migration: add one deliberately narrow playback route for an
// official TIDAL track ID. The route resolves the official metadata to a
// proven HEOS {cid,mid} context and then reuses the existing aid=4
// (play-only) queue semantics. It refuses ambiguous/unresolved tracks.
//
// This migration edits server.js only. It does not itself contact HEOS,
// restart the backend, or change playback/queue state.

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const before = fs.readFileSync(serverPath, 'utf8');

const anchor = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {`;

const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play-resolved?')) {
    try {
      await supersedeAndDrainTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      if (!/^\\d+$/.test(id)) {
        return sendJson(res, 400, { error: 'Track id must contain digits only' });
      }

      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);
      const track = tidalHeosResolver.extractOfficialTrack(metadata);
      const resolution = await tidalHeosResolver.resolveTrack(track);

      if (resolution.status !== 'resolved' || !resolution.cid || !resolution.mid) {
        return sendJson(res, 409, {
          ok: false,
          track,
          resolution,
          error: 'Track could not be resolved safely for HEOS playback'
        });
      }

      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(resolution.cid) +
        '&mid=' + encodeURIComponent(resolution.mid) +
        '&aid=4'
      );

      return sendJson(res, 200, {
        ok: true,
        action: 'play-only',
        track,
        resolution
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

`;

if (!before.includes(anchor)) {
  throw new Error('Expected /api/tidal/browse route anchor not found; refusing to edit server.js');
}

if (before.includes("/api/tidal/play-resolved?")) {
  console.log('Playback route already present; no changes made.');
  process.exit(0);
}

const after = before.replace(anchor, route + anchor);
if (after === before) {
  throw new Error('Guarded replacement made no change');
}

fs.writeFileSync(serverPath, after);
console.log('Added guarded /api/tidal/play-resolved?id=<official-track-id> route.');
console.log('Route is deliberately limited to resolved tracks and existing aid=4 play-only semantics.');
console.log('Migration itself did not contact HEOS or alter playback.');

'use strict';

// Guarded migration: add a read-only recommendation-resolution reconnaissance route.
// It deliberately does NOT call browse/add_to_queue or any player command.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes('probeRecommendationResolutionBatch')) {
  console.log('Recommendation resolution recon already present; no changes made.');
  process.exit(0);
}

const functionAnchor = '  async function probeTrackMetadata(trackId) {';
const functionAt = source.indexOf(functionAnchor);
if (functionAt < 0) throw new Error('Expected probeTrackMetadata anchor not found');

const routeAnchor = "    if (pathname === '/api/tidal/oauth/probe-track') {";
const routeAt = source.indexOf(routeAnchor);
if (routeAt < 0) throw new Error('Expected probe-track route anchor not found');

const insertFunction = `  async function probeRecommendationResolutionBatch() {
    // This endpoint intentionally stops at official TIDAL metadata. The HEOS
    // catalogue half is driven separately from the shell so every browse step
    // and candidate match remains visible during reconnaissance.
    const playlists = await probePersonalisedPlaylists();
    const selected = [];

    for (const [label, playlist] of Object.entries(playlists.playlists || {})) {
      if (!playlist?.ok) continue;
      const tracks = (playlist.included || [])
        .filter(item => item?.type === 'tracks' && /^\\d+$/.test(String(item.id || '')))
        .slice(0, label === 'My Mix 1' ? 10 : 8);
      for (const track of tracks) {
        selected.push({ source: label, id: String(track.id) });
      }
    }

    const unique = [];
    const seen = new Set();
    for (const item of selected) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
      if (unique.length >= 26) break;
    }

    const results = [];
    for (const item of unique) {
      try {
        const metadata = await probeTrackMetadata(item.id);
        results.push({ source: item.source, id: item.id, ok: true, metadata });
      } catch (error) {
        results.push({ source: item.source, id: item.id, ok: false, error: error.message });
      }
    }

    return { count: results.length, tracks: results };
  }

`;
source = source.slice(0, functionAt) + insertFunction + source.slice(functionAt);

const newRouteAt = source.indexOf(routeAnchor);
const insertRoute = `    if (pathname === '/api/tidal/oauth/probe-recommendation-resolution-batch') {
      try {
        return sendJson(res, 200, await probeRecommendationResolutionBatch());
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

`;
source = source.slice(0, newRouteAt) + insertRoute + source.slice(newRouteAt);

fs.writeFileSync(target, source);
console.log('Added read-only TIDAL recommendation-resolution batch recon route.');

'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'server.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(label + ': expected anchor not found');
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(label + ': expected anchor is not unique');
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const functionAnchor = "function getHeosNowPlaying() {\n";
const bridge = `async function getFavouriteTracksLibraryBridge() {
  const official = await tidalUserAuthRecon.getFavouriteTracks();
  const officialTracks = Array.isArray(official.tracks) ? official.tracks : [];
  const officialIds = officialTracks.map(track => String(track.id || '')).filter(Boolean);

  const cid = 'My Music-Tracks';
  const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');
  const pageSize = 50;
  const heosRows = [];
  let start = 0;
  let total = null;

  while (total === null || start < total) {
    const response = await heosBrowse(
      'heos://browse/browse?sid=10&cid=' + heosCid +
      '&range=' + start + ',' + (start + pageSize - 1)
    );
    const payload = Array.isArray(response.payload) ? response.payload : [];
    heosRows.push(...payload);
    const message = response.heos?.message || '';
    const countMatch = message.match(/(?:^|&)count=(\\d+)/);
    if (countMatch) total = Number(countMatch[1]);
    if (!payload.length) break;
    start += payload.length;
    if (total === null && payload.length < pageSize) break;
  }

  const playableRows = heosRows.filter(item => item.playable === 'yes' && item.mid);
  const seen = new Set();
  const heosUniqueIds = [];
  for (const item of playableRows) {
    const mid = String(item.mid || '');
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    heosUniqueIds.push(mid);
  }

  const officialSet = new Set(officialIds);
  const heosSet = new Set(heosUniqueIds);
  const officialOnlyIds = officialIds.filter(id => !heosSet.has(id));
  const heosOnlyIds = heosUniqueIds.filter(id => !officialSet.has(id));
  const exactIdSetMatch = officialOnlyIds.length === 0 && heosOnlyIds.length === 0;
  const sameOrder = officialIds.length === heosUniqueIds.length &&
    officialIds.every((id, index) => id === heosUniqueIds[index]);

  return {
    ok: exactIdSetMatch && sameOrder,
    readOnly: true,
    cid,
    tracks: officialTracks,
    officialTrackCount: officialIds.length,
    officialReferenceCount: Number(official.referenceCount || 0),
    officialStaleReferenceCount: Array.isArray(official.staleReferenceIds)
      ? official.staleReferenceIds.length
      : 0,
    officialCached: Boolean(official.cached),
    officialStale: Boolean(official.stale),
    heosReportedCount: total,
    heosRawRowCount: heosRows.length,
    heosPlayableRowCount: playableRows.length,
    heosUniqueTrackCount: heosUniqueIds.length,
    heosDuplicateExcessCount: playableRows.length - heosUniqueIds.length,
    exactIdSetMatch,
    sameOrder,
    officialOnlyIds,
    heosOnlyIds,
    firstOfficialIds: officialIds.slice(0, 5),
    firstHeosIds: heosUniqueIds.slice(0, 5),
    lastOfficialIds: officialIds.slice(-5),
    lastHeosIds: heosUniqueIds.slice(-5)
  };
}

`;
replaceOnce('HEOS now-playing function anchor', functionAnchor, bridge + functionAnchor);

const routeStart = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/probe-favourite-tracks-heos-validation')) {\n";
const routeEnd = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {\n";
const routeStartIndex = source.indexOf(routeStart);
if (routeStartIndex === -1) throw new Error('Favourite Tracks validation route: start anchor not found');
if (source.indexOf(routeStart, routeStartIndex + routeStart.length) !== -1) {
  throw new Error('Favourite Tracks validation route: start anchor is not unique');
}
const routeEndIndex = source.indexOf(routeEnd, routeStartIndex);
if (routeEndIndex === -1) throw new Error('Favourite Tracks validation route: end anchor not found');
const newRoutes = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/probe-favourite-tracks-heos-validation')) {
    try {
      const bridge = await getFavouriteTracksLibraryBridge();
      const { tracks, ...summary } = bridge;
      return sendJson(res, 200, summary);
    } catch (error) {
      return sendJson(res, 502, { ok: false, readOnly: true, error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-tracks')) {
    try {
      const bridge = await getFavouriteTracksLibraryBridge();
      if (!bridge.ok) {
        return sendJson(res, 409, {
          ok: false,
          readOnly: true,
          error: 'Favourite Tracks official/HEOS validation failed',
          exactIdSetMatch: bridge.exactIdSetMatch,
          sameOrder: bridge.sameOrder,
          officialOnlyIds: bridge.officialOnlyIds,
          heosOnlyIds: bridge.heosOnlyIds
        });
      }
      return sendJson(res, 200, {
        ok: true,
        readOnly: true,
        cid: bridge.cid,
        count: bridge.tracks.length,
        cached: bridge.officialCached,
        stale: bridge.officialStale,
        tracks: bridge.tracks
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, readOnly: true, error: error.message });
    }
  }

`;
source = source.slice(0, routeStartIndex) + newRoutes + source.slice(routeEndIndex);

const listenAnchor = `server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(\`Marantz backend listening on port \${HTTP_PORT}; AI fallback \${AI_FALLBACK_ENABLED ? 'enabled' : 'disabled'}\`);
});`;
const listenReplacement = `server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(\`Marantz backend listening on port \${HTTP_PORT}; AI fallback \${AI_FALLBACK_ENABLED ? 'enabled' : 'disabled'}\`);
  setImmediate(() => {
    tidalUserAuthRecon.getFavouriteTracks()
      .then(result => console.log(
        'TIDAL Favourite Tracks prewarm ready:',
        Array.isArray(result.tracks) ? result.tracks.length : 0,
        'tracks'
      ))
      .catch(error => console.warn(
        'TIDAL Favourite Tracks prewarm failed:',
        error.message
      ));
  });
});`;
replaceOnce('server listen anchor', listenAnchor, listenReplacement);

fs.writeFileSync(target, source);
console.log('Added reusable Favourite Tracks library bridge, production read-only endpoint, and async prewarm.');

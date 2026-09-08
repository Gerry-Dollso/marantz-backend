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

const anchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {\n";
const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/probe-favourite-tracks-heos-validation')) {
    try {
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
      const sameOrder = officialIds.length === heosUniqueIds.length &&
        officialIds.every((id, index) => id === heosUniqueIds[index]);

      return sendJson(res, 200, {
        ok: true,
        readOnly: true,
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
        exactIdSetMatch: officialOnlyIds.length === 0 && heosOnlyIds.length === 0,
        sameOrder,
        officialOnlyIds,
        heosOnlyIds,
        firstOfficialIds: officialIds.slice(0, 5),
        firstHeosIds: heosUniqueIds.slice(0, 5),
        lastOfficialIds: officialIds.slice(-5),
        lastHeosIds: heosUniqueIds.slice(-5)
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, readOnly: true, error: error.message });
    }
  }

`;

replaceOnce('TIDAL browse route anchor', anchor, route + anchor);

fs.writeFileSync(target, source);
console.log('Added read-only Favourite Tracks HEOS validation endpoint to server.js.');

'use strict';

const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(targetPath, 'utf8');

function replaceExactlyOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(label + ': anchor not found');
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(label + ': anchor is not unique');
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const functionAnchor = `  async function probeTrackReplacement(trackId) {
    if (!/^\\d+$/.test(trackId || '')) {
      throw new Error('Track id must contain digits only');
    }

    return apiGetRaw(
      '/tracks/' + encodeURIComponent(trackId) +
      '?include=' + encodeURIComponent('artists,albums,albums.coverArt,replacement') +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }
`;

const functionReplacement = functionAnchor + `
  async function probeTrackProvenance(trackId) {
    if (!/^\\d+$/.test(trackId || '')) {
      throw new Error('Track id must contain digits only');
    }

    return apiGetRaw(
      '/tracks/' + encodeURIComponent(trackId) +
      '?include=' + encodeURIComponent('artists,albums,providers,owners,albums.providers,albums.owners') +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }
`;

replaceExactlyOnce(
  'track provenance function',
  functionAnchor,
  functionReplacement
);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track-replacement') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackReplacement(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

const routeReplacement = routeAnchor + `
    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track-provenance') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackProvenance(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

replaceExactlyOnce(
  'track provenance route',
  routeAnchor,
  routeReplacement
);

fs.writeFileSync(targetPath, source);
console.log('Added read-only TIDAL track provenance probe.');

'use strict';

const fs = require('fs');
const path = require('path');

const reconFile = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let recon = fs.readFileSync(reconFile, 'utf8');

const functionSignature = 'async function probeTrackReplacement(trackId)';
const routeSignature = '/api/tidal/oauth/probe-track-replacement';

const functionMarker = `  async function probeTrackMetadata(trackId) {
    await ensureSession(); // TIDAL_PERSISTENT_REFRESH_AUTH_V3
    if (!/^\\d+$/.test(trackId || '')) {
      throw new Error('Track id must contain digits only');
    }
    const response = await fetch(
      API_BASE + '/tracks/' + encodeURIComponent(trackId) +
        '?include=artists,albums,albums.coverArt&countryCode=' + encodeURIComponent(countryCode),
      {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
      throw new Error(detail);
    }
    return payload;
  }
`;

const replacementFunction = `
  async function probeTrackReplacement(trackId) {
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

if (!recon.includes(functionSignature)) {
  const matches = recon.split(functionMarker).length - 1;
  if (matches !== 1) {
    throw new Error('Expected probeTrackMetadata anchor exactly once; found ' + matches);
  }
  recon = recon.replace(functionMarker, functionMarker + replacementFunction);
}

const routeMarker = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackMetadata(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

const replacementRoute = `
    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track-replacement') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackReplacement(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

if (!recon.includes(routeSignature)) {
  const matches = recon.split(routeMarker).length - 1;
  if (matches !== 1) {
    throw new Error('Expected probe-track route anchor exactly once; found ' + matches);
  }
  recon = recon.replace(routeMarker, routeMarker + replacementRoute);
}

fs.writeFileSync(reconFile, recon);
console.log('Added read-only TIDAL replacement relationship probe.');

'use strict';

// Guarded one-shot migration: add a read-only parameterised TIDAL track metadata
// probe to tidal-user-auth-recon.js. Safe to rerun: exits cleanly if already applied.

const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const routeMarker = "requestUrl.pathname === '/api/tidal/oauth/probe-track'";
if (source.includes(routeMarker)) {
  console.log('Already applied: parameterised TIDAL track metadata probe exists.');
  process.exit(0);
}

const functionAnchor = "\n  async function probeSearch() {";
if (!source.includes(functionAnchor)) {
  throw new Error('Guard failed: probeSearch() anchor not found; no changes written.');
}

const helper = `
  async function probeTrackMetadata(trackId) {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }
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
source = source.replace(functionAnchor, '\n' + helper + functionAnchor.trimStart());

const routeAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {";
if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: rich metadata route anchor not found; no changes written.');
}

const route = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackMetadata(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

`;
source = source.replace(routeAnchor, route + routeAnchor);

fs.writeFileSync(target, source);
console.log('Applied: added read-only /api/tidal/oauth/probe-track?id=<numeric-id> route.');

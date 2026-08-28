'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const marker = '  async function probeRichMetadata() {';
if (source.includes(marker)) {
  console.log('Already extended: rich metadata probe present');
  process.exit(0);
}

const anchor = '  async function handle(req, res) {';
if (!source.includes(anchor)) throw new Error('Guard failed: handle() anchor not found');

const addition = `  async function probeRichMetadata() {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

    async function inspect(label, resourcePath) {
      const startedAt = process.hrtime.bigint();
      const response = await fetch(API_BASE + resourcePath, {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
        return { ok: false, httpStatus: response.status, elapsedMs: Math.round(elapsedMs * 10) / 10, error: detail };
      }

      const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
      const included = Array.isArray(payload?.included) ? payload.included : [];
      return {
        ok: true,
        httpStatus: response.status,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        root: root ? {
          id: root.id,
          type: root.type,
          attributes: root.attributes || {},
          relationshipKeys: Object.keys(root.relationships || {})
        } : null,
        included: included.map(item => ({
          id: item.id,
          type: item.type,
          attributes: item.attributes || {},
          relationshipKeys: Object.keys(item.relationships || {})
        }))
      };
    }

    const artistId = '64520';
    const albumId = '58080303';
    const trackId = '58080305';
    return {
      artist: await inspect('artist', '/artists/' + artistId + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode)),
      album: await inspect('album', '/albums/' + albumId + '?include=artists,coverArt&countryCode=' + encodeURIComponent(countryCode)),
      track: await inspect('track', '/tracks/' + trackId + '?include=artists,albums,albums.coverArt&countryCode=' + encodeURIComponent(countryCode))
    };
  }

`;
source = source.replace(anchor, addition + anchor);

const routeAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collection-pagination') {";
if (!source.includes(routeAnchor)) throw new Error('Guard failed: pagination route anchor not found');
const route = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {
      try {
        const metadata = await probeRichMetadata();
        return sendJson(res, 200, { ok: true, metadata });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

`;
source = source.replace(routeAnchor, route + routeAnchor);

fs.writeFileSync(target, source);
console.log('Extended: added read-only TIDAL rich metadata and artwork probe');

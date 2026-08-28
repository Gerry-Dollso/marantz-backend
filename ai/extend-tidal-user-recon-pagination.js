'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const functionMarker = '  async function probeCollectionPagination() {';
const routeMarker = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collection-pagination') {";

const functionBody = `  async function probeCollectionPagination() {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

    async function traverse(label, initialPath) {
      const startedAt = process.hrtime.bigint();
      let next = initialPath;
      let pages = 0;
      let totalItems = 0;
      const pageTimesMs = [];
      const seen = new Set();

      while (next) {
        if (pages >= 250) throw new Error(label + ': pagination safety limit reached');
        const url = next.startsWith('http') ? next : API_BASE + next;
        if (seen.has(url)) throw new Error(label + ': repeated pagination URL');
        seen.add(url);

        const pageStartedAt = process.hrtime.bigint();
        const response = await fetch(url, {
          headers: {
            Authorization: 'Bearer ' + session.accessToken,
            Accept: 'application/vnd.api+json'
          }
        });
        const payload = await response.json().catch(() => ({}));
        const pageElapsedMs = Number(process.hrtime.bigint() - pageStartedAt) / 1e6;

        if (!response.ok) {
          const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
          throw new Error(response.status + ': ' + detail);
        }

        pages += 1;
        pageTimesMs.push(Math.round(pageElapsedMs * 10) / 10);
        const data = Array.isArray(payload?.data) ? payload.data : [];
        totalItems += data.length;
        next = payload?.links?.next || null;
      }

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        pages,
        totalItems,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        averagePageMs: pages ? Math.round((elapsedMs / pages) * 10) / 10 : 0,
        firstFivePageTimesMs: pageTimesMs.slice(0, 5),
        lastPageMs: pageTimesMs.length ? pageTimesMs[pageTimesMs.length - 1] : null
      };
    }

    const resources = [
      ['artists', '/userCollectionArtists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)],
      ['albums', '/userCollectionAlbums/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)],
      ['tracks', '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)]
    ];

    const results = {};
    for (const [name, initialPath] of resources) {
      try {
        results[name] = { ok: true, ...(await traverse(name, initialPath)) };
      } catch (error) {
        results[name] = { ok: false, error: error.message };
      }
    }
    return results;
  }

`;

const routeBody = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collection-pagination') {
      try {
        const pagination = await probeCollectionPagination();
        return sendJson(res, 200, { ok: true, pagination });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

`;

if (!source.includes(functionMarker)) {
  const anchor = '  async function handle(req, res) {';
  if (!source.includes(anchor)) throw new Error('Guard failed: handle() anchor not found');
  source = source.replace(anchor, functionBody + anchor);
} else if (!source.includes('/userCollectionArtists/me/relationships/items?countryCode=')) {
  throw new Error('Guard failed: an unexpected pagination implementation is already present');
}

if (!source.includes(routeMarker)) {
  const routeAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collections') {";
  if (!source.includes(routeAnchor)) throw new Error('Guard failed: collection route anchor not found');
  source = source.replace(routeAnchor, routeBody + routeAnchor);
}

fs.writeFileSync(target, source);
console.log('Extended: added relationship-based full collection pagination benchmark');

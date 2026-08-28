'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const functionStart = '  async function probeCollectionPagination() {';
const handleAnchor = '  async function handle(req, res) {';
const routeMarker = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collection-pagination') {";

const functionBody = `  async function probeCollectionPagination() {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const pageDelayMs = 1000;
    const collectionDelayMs = 3000;
    const maxRateLimitRetries = 5;

    async function traverse(label, initialPath) {
      const startedAt = process.hrtime.bigint();
      let next = initialPath;
      let pages = 0;
      let totalItems = 0;
      let rateLimitRetries = 0;
      const pageTimesMs = [];
      const seen = new Set();

      while (next) {
        if (pages >= 250) throw new Error(label + ': pagination safety limit reached');
        const url = next.startsWith('http') ? next : API_BASE + next;
        if (seen.has(url)) throw new Error(label + ': repeated pagination URL');

        let response;
        let payload;
        let pageElapsedMs;
        let retriesForPage = 0;

        while (true) {
          const pageStartedAt = process.hrtime.bigint();
          response = await fetch(url, {
            headers: {
              Authorization: 'Bearer ' + session.accessToken,
              Accept: 'application/vnd.api+json'
            }
          });
          payload = await response.json().catch(() => ({}));
          pageElapsedMs = Number(process.hrtime.bigint() - pageStartedAt) / 1e6;

          if (response.status !== 429) break;
          if (retriesForPage >= maxRateLimitRetries) {
            throw new Error(label + ': HTTP 429 after ' + retriesForPage + ' retries');
          }

          const retryAfter = response.headers.get('retry-after');
          const retryAfterSeconds = retryAfter == null ? NaN : Number(retryAfter);
          const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? Math.max(1000, Math.ceil(retryAfterSeconds * 1000))
            : Math.min(30000, 2000 * (2 ** retriesForPage));
          retriesForPage += 1;
          rateLimitRetries += 1;
          await sleep(waitMs);
        }

        if (!response.ok) {
          const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
          throw new Error(response.status + ': ' + detail);
        }

        seen.add(url);
        pages += 1;
        pageTimesMs.push(Math.round(pageElapsedMs * 10) / 10);
        const data = Array.isArray(payload?.data) ? payload.data : [];
        totalItems += data.length;
        next = payload?.links?.next || null;
        if (next) await sleep(pageDelayMs);
      }

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        pages,
        totalItems,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        averagePageMs: pages ? Math.round((elapsedMs / pages) * 10) / 10 : 0,
        rateLimitRetries,
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
    for (let i = 0; i < resources.length; i += 1) {
      const [name, initialPath] = resources[i];
      try {
        results[name] = { ok: true, ...(await traverse(name, initialPath)) };
      } catch (error) {
        results[name] = { ok: false, error: error.message };
      }
      if (i < resources.length - 1) await sleep(collectionDelayMs);
    }
    return results;
  }

`;

if (!source.includes(functionStart)) {
  throw new Error('Guard failed: pagination benchmark is not present');
}
if (!source.includes('/userCollectionArtists/me/relationships/items?countryCode=')) {
  throw new Error('Guard failed: relationship-based pagination benchmark not found');
}
if (source.includes('const maxRateLimitRetries = 5;')) {
  console.log('Already extended: rate-limit-aware pagination benchmark present');
  process.exit(0);
}

const functionIndex = source.indexOf(functionStart);
const handleIndex = source.indexOf(handleAnchor, functionIndex);
if (handleIndex < 0) throw new Error('Guard failed: handle() anchor not found after pagination benchmark');
source = source.slice(0, functionIndex) + functionBody + source.slice(handleIndex);

if (!source.includes(routeMarker)) {
  throw new Error('Guard failed: pagination route disappeared during replacement');
}

fs.writeFileSync(target, source);
console.log('Extended: pagination benchmark now throttles requests and retries HTTP 429 safely');

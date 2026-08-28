'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const functionAnchor = '  async function handle(req, res) {';
const routeAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {";

if (source.includes('async function probeSearch()')) {
  throw new Error('Guard failed: TIDAL search probe is already present');
}
if (!source.includes(functionAnchor)) {
  throw new Error('Guard failed: handle() anchor not found');
}
if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: rich metadata route anchor not found');
}

const probeFunction = `  async function probeSearch() {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

    async function inspectSearch(label, path) {
      const startedAt = process.hrtime.bigint();
      const response = await fetch(API_BASE + path, {
        headers: {
          Authorization: 'Bearer ' + session.accessToken,
          Accept: 'application/vnd.api+json'
        }
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);
        return {
          ok: false,
          httpStatus: response.status,
          elapsedMs: Math.round(elapsedMs * 10) / 10,
          error: detail
        };
      }

      const data = Array.isArray(payload?.data) ? payload.data : (payload?.data ? [payload.data] : []);
      const included = Array.isArray(payload?.included) ? payload.included : [];
      const simplify = item => ({
        id: String(item?.id || ''),
        type: String(item?.type || ''),
        name: String(item?.attributes?.name || item?.attributes?.title || ''),
        attributeKeys: Object.keys(item?.attributes || {}),
        relationshipKeys: Object.keys(item?.relationships || {})
      });

      return {
        ok: true,
        httpStatus: response.status,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        dataCount: data.length,
        data: data.slice(0, 20).map(simplify),
        includedCount: included.length,
        included: included.slice(0, 40).map(simplify),
        includedTypes: [...new Set(included.map(item => String(item?.type || '')).filter(Boolean))],
        links: payload?.links || null,
        meta: payload?.meta || null
      };
    }

    const query = 'Interpol';
    const encodedQuery = encodeURIComponent(query);
    const encodedCountry = encodeURIComponent(countryCode);
    return {
      query,
      results: await inspectSearch(
        'results',
        '/searchResults/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=artists,albums,tracks'
      ),
      suggestions: await inspectSearch(
        'suggestions',
        '/searchSuggestions/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=directHits'
      )
    };
  }

`;

const route = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-search') {
      try {
        const search = await probeSearch();
        return sendJson(res, 200, { ok: true, search });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

`;

source = source.replace(functionAnchor, probeFunction + functionAnchor);
source = source.replace(routeAnchor, route + routeAnchor);
fs.writeFileSync(target, source);
console.log('Extended: added read-only TIDAL search and suggestion probe');

'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read'];";
const newScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read'];";
if (!source.includes(oldScopes)) {
  console.error('Refusing to edit: expected OAuth scope marker not found or already changed');
  process.exit(1);
}
source = source.replace(oldScopes, newScopes);

const insertBefore = `\n  async function handle(req, res) {`;
if (!source.includes(insertBefore)) {
  console.error('Refusing to edit: handle marker not found');
  process.exit(1);
}

const helper = `
  async function inspectCollectionResource(path) {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

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
      throw new Error(response.status + ': ' + detail);
    }

    const included = Array.isArray(payload?.included) ? payload.included : [];
    const first = included[0] || null;
    const attrs = first?.attributes || {};

    return {
      httpStatus: response.status,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      includedCount: included.length,
      firstResource: first ? {
        id: String(first.id || ''),
        type: String(first.type || ''),
        attributeKeys: Object.keys(attrs),
        attributes: Object.fromEntries(
          Object.entries(attrs).filter(([key, value]) =>
            ['name', 'title', 'duration', 'releaseDate', 'barcodeId', 'explicit', 'popularity'].includes(key) &&
            ['string', 'number', 'boolean'].includes(typeof value)
          )
        ),
        relationshipKeys: first.relationships ? Object.keys(first.relationships) : []
      } : null,
      links: payload?.links || null,
      meta: payload?.meta || null
    };
  }

  async function probeCollections() {
    const resources = [
      ['artists', '/userCollectionArtists/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['albums', '/userCollectionAlbums/me?include=items&countryCode=' + encodeURIComponent(countryCode)],
      ['tracks', '/userCollectionTracks/me?include=items&countryCode=' + encodeURIComponent(countryCode)]
    ];

    const results = {};
    for (const [name, path] of resources) {
      try {
        results[name] = { ok: true, ...(await inspectCollectionResource(path)) };
      } catch (error) {
        results[name] = { ok: false, error: error.message };
      }
    }
    return results;
  }
`;
source = source.replace(insertBefore, helper + insertBefore);

const oldRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {`;
if (!source.includes(oldRoute)) {
  console.error('Refusing to edit: personalised playlist probe route not found');
  process.exit(1);
}
const newRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-collections') {
      try {
        const collections = await probeCollections();
        return sendJson(res, 200, { ok: true, collections });
      } catch (error) {
        return sendJson(res, 401, { ok: false, error: error.message });
      }
    }

${oldRoute}`;
source = source.replace(oldRoute, newRoute);

fs.writeFileSync(target, source);
console.log('Extended: added collection.read scope and read-only collection benchmark');

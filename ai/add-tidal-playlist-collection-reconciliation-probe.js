'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from('blob ' + body.length + '\0', 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

const expectedSha = 'c8fd6023d9361d2f31cc548ed8260a91708c1efa';
const actualSha = gitBlobSha(source);
if (actualSha !== expectedSha) {
  throw new Error('Guard failed: tidal-user-auth-recon.js blob SHA is ' + actualSha + ', expected ' + expectedSha + '; no changes written.');
}

const functionAnchor = `  async function probeRecommendations() {\n`;
const functionInsert = `  async function probeFavouritePlaylistCollection() {\n    const ids = [];\n    const seenIds = new Set();\n    const seenPages = new Set();\n    let next = '/userCollectionPlaylists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode);\n    let pages = 0;\n\n    while (next) {\n      if (pages >= FAVOURITE_TRACKS_MAX_PAGES) {\n        throw new Error('TIDAL Favourite Playlists pagination safety limit reached');\n      }\n\n      const path = normaliseApiPath(next);\n      if (seenPages.has(path)) {\n        throw new Error('TIDAL Favourite Playlists pagination repeated a page');\n      }\n      seenPages.add(path);\n\n      const payload = await apiGetRawWithRateLimitRetry(\n        path,\n        'Favourite Playlists relationship page ' + (pages + 1)\n      );\n      const data = Array.isArray(payload?.data) ? payload.data : [];\n      for (const linkage of data) {\n        const id = String(linkage?.id || '').trim();\n        if (linkage?.type !== 'playlists' || !/^[a-zA-Z0-9-]+$/.test(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained an invalid playlist linkage');\n        }\n        if (seenIds.has(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained duplicate id ' + id);\n        }\n        seenIds.add(id);\n        ids.push(id);\n      }\n\n      next = payload?.links?.next || null;\n      pages += 1;\n      if (next) {\n        await new Promise(resolve => setTimeout(resolve, FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS));\n      }\n    }\n\n    return { count: ids.length, pages, ids };\n  }\n\n`;
if (!source.includes(functionAnchor)) {
  throw new Error('Guard failed: probeRecommendations anchor not found; no changes written.');
}
source = source.replace(functionAnchor, functionInsert + functionAnchor);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {\n`;
const routeInsert = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-favourite-playlist-collection') {\n      try {\n        const collection = await probeFavouritePlaylistCollection();\n        return sendJson(res, 200, { ok: true, readOnly: true, collection });\n      } catch (error) {\n        return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: probe-playlists route anchor not found; no changes written.');
}
source = source.replace(routeAnchor, routeInsert + routeAnchor);

fs.writeFileSync(target, source);
console.log('Added read-only official TIDAL Favourite Playlists collection probe.');
console.log('tidal-user-auth-recon.js: ' + gitBlobSha(source));
console.log('No HEOS playback, queue, favourites, or Pi files were modified.');

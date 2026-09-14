'use strict';

const crypto = require('crypto');
const fs = require('fs');

const file = 'tidal-user-auth-recon.js';
const expectedBlobSha = 'a7951a895330b0d4fe818b81fb2f7e83c5c4f0fa';

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

const source = fs.readFileSync(file, 'utf8');
const actualBlobSha = gitBlobSha(source);
if (actualBlobSha !== expectedBlobSha) {
  throw new Error(`Refusing to edit ${file}: expected blob ${expectedBlobSha}, found ${actualBlobSha}`);
}

const anchor = '  async function probeRawRecommendations() {';
if (!source.includes(anchor)) throw new Error('Could not locate guarded insertion anchor');

const fn = `  async function probePlaylistBatchMetadata(ids) {\n    const values = String(ids || '').split(',').map(value => value.trim()).filter(Boolean);\n    if (!values.length || values.length > 20) {\n      throw new Error('Playlist batch probe requires 1 to 20 IDs');\n    }\n    if (values.some(id => !/^[a-zA-Z0-9-]+$/.test(id))) {\n      throw new Error('Playlist IDs must contain only letters, numbers, or hyphens');\n    }\n    return apiGetRaw(\n      '/playlists?filter%5Bid%5D=' + encodeURIComponent(values.join(',')) +\n      '&include=' + encodeURIComponent('coverArt') +\n      '&countryCode=' + encodeURIComponent(countryCode)\n    );\n  }\n\n`;

if (source.includes('probePlaylistBatchMetadata')) {
  throw new Error('Playlist batch metadata probe already exists');
}
let updated = source.replace(anchor, fn + anchor);

const routeAnchor = "    if (url.pathname === '/api/tidal/oauth/probe-playlist-raw') {";
if (!updated.includes(routeAnchor)) throw new Error('Could not locate guarded Playlist route anchor');

const route = `    if (url.pathname === '/api/tidal/oauth/probe-playlist-batch') {\n      try {\n        const batch = await probePlaylistBatchMetadata(url.searchParams.get('ids'));\n        return sendJson(res, 200, { ok: true, readOnly: true, batch });\n      } catch (error) {\n        return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
updated = updated.replace(routeAnchor, route + routeAnchor);
fs.writeFileSync(file, updated);

console.log('Added read-only official TIDAL Playlist batch metadata probe (max 20 IDs, coverArt included).');
console.log(`${file}: ${gitBlobSha(updated)}`);
console.log('No production catalogue, HEOS playback, queue, favourites, or Pi files were modified.');

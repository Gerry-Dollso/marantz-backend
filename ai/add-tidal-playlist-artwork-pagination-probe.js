'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const functionAnchor = `  async function probeRichPlaylist(playlistId) {\n    const id = String(playlistId || '').trim();\n    if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }\n\n    return apiGetRaw(\n      '/playlists/' + encodeURIComponent(id) +\n      '?include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums') +\n      '&countryCode=' + encodeURIComponent(countryCode)\n    );\n  }\n`;

const addition = `\n  async function probePlaylistArtworkAndPage(playlistId, cursor) {\n    const id = String(playlistId || '').trim();\n    if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }\n\n    const pageCursor = String(cursor || '').trim();\n    if (pageCursor && !/^[a-zA-Z0-9_-]+$/.test(pageCursor)) {\n      throw new Error('Playlist cursor contains unsupported characters');\n    }\n\n    let resourcePath =\n      '/playlists/' + encodeURIComponent(id) +\n      '?include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums.coverArt') +\n      '&countryCode=' + encodeURIComponent(countryCode);\n\n    if (pageCursor) {\n      resourcePath += '&page%5Bcursor%5D=' + encodeURIComponent(pageCursor);\n    }\n\n    return apiGetRaw(resourcePath);\n  }\n`;

if (!source.includes(functionAnchor)) {
  throw new Error('Guard failed: probeRichPlaylist anchor not found exactly; no changes written.');
}
source = source.replace(functionAnchor, functionAnchor + addition);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {\n`;
const routeBlock = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-page') {\n      try {\n        const playlistId = requestUrl.searchParams.get('id') || '';\n        const cursor = requestUrl.searchParams.get('cursor') || '';\n        const playlist = await probePlaylistArtworkAndPage(playlistId, cursor);\n        return sendJson(res, 200, { ok: true, playlist });\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, error: error.message });\n      }\n    }\n\n`;

if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: probe-playlists route anchor not found exactly; no changes written.');
}
source = source.replace(routeAnchor, routeBlock + routeAnchor);

fs.writeFileSync(target, source);
console.log('Added read-only TIDAL playlist artwork/cursor probe.');
console.log('This migration does not contact HEOS or alter playback.');

'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldBlock = `  async function probePlaylistItemsPage(playlistId, cursor) {\n    const id = String(playlistId || '').trim();\n    if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }\n\n    const pageCursor = String(cursor || '').trim();\n    if (!pageCursor || !/^[a-zA-Z0-9_-]+$/.test(pageCursor)) {\n      throw new Error('Playlist cursor is required and contains unsupported characters');\n    }\n\n    return apiGetRaw(\n      '/playlists/' + encodeURIComponent(id) + '/relationships/items' +\n      '?countryCode=' + encodeURIComponent(countryCode) +\n      '&page%5Bcursor%5D=' + encodeURIComponent(pageCursor) +\n      '&include=' + encodeURIComponent('tracks:artists,tracks:albums.coverArt')\n    );\n  }\n`;

const newBlock = `  async function probePlaylistItemsPage(playlistId, cursor) {\n    const id = String(playlistId || '').trim();\n    if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }\n\n    const pageCursor = String(cursor || '').trim();\n    if (!pageCursor || !/^[a-zA-Z0-9_-]+$/.test(pageCursor)) {\n      throw new Error('Playlist cursor is required and contains unsupported characters');\n    }\n\n    return apiGetRaw(\n      '/playlists/' + encodeURIComponent(id) + '/relationships/items' +\n      '?countryCode=' + encodeURIComponent(countryCode) +\n      '&page%5Bcursor%5D=' + encodeURIComponent(pageCursor) +\n      '&include=' + encodeURIComponent('items')\n    );\n  }\n`;

if (!source.includes(oldBlock)) {
  throw new Error('Guard failed: expected playlist relationship-page probe not found exactly; no changes written.');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);

console.log('Changed TIDAL playlist relationship-page probe to include=items.');
console.log('This migration does not contact HEOS or alter playback.');

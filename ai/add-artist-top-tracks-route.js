'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes("/api/tidal/artist-top-tracks?")) throw new Error('Artist Top Tracks route already installed');

const marker = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-biography?')) {";
if (!source.includes(marker)) throw new Error('Guard failed; Artist biography route marker missing');

const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-top-tracks?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const artistId = url.searchParams.get('id') || '';\n      const result = await tidalArtistDetails.getArtistTopTracks(artistId, {\n        forceRefresh: url.searchParams.get('refresh') === '1'\n      });\n      return sendJson(res, 200, { ok: true, artistId: String(artistId), ...result });\n    } catch (error) {\n      return sendJson(res, 500, { ok: false, error: error.message });\n    }\n  }\n\n`;

source = source.replace(marker, route + marker);
fs.writeFileSync(target, source);
console.log('Installed guarded Artist Top Tracks HTTP route');

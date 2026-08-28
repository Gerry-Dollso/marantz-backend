'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const functionAnchor = `  async function probeRawRecommendations() {\n    const resources = {\n      dailyMixes: '/userDailyMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),\n      dailyDiscovery: '/userDiscoveryMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),\n      newArrivals: '/userNewReleaseMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)\n    };\n\n    const results = {};\n    for (const [name, resourcePath] of Object.entries(resources)) {\n      results[name] = await apiGetRaw(resourcePath);\n    }\n    return results;\n  }\n`;

const functionReplacement = `${functionAnchor}\n  async function probeRawPlaylist(playlistId) {\n    const id = String(playlistId || '').trim();\n    if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }\n\n    return apiGetRaw(\n      '/playlists/' + encodeURIComponent(id) +\n      '?include=items&countryCode=' + encodeURIComponent(countryCode)\n    );\n  }\n`;

if (!source.includes(functionAnchor)) {
  throw new Error('Guard failed: raw recommendations function anchor not found exactly; no changes written.');
}
source = source.replace(functionAnchor, functionReplacement);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendations-raw') {\n      try {\n        const recommendations = await probeRawRecommendations();\n        return sendJson(res, 200, { ok: true, recommendations });\n      } catch (error) {\n        return sendJson(res, 401, { ok: false, error: error.message });\n      }\n    }\n`;

const routeReplacement = `${routeAnchor}\n    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-raw') {\n      try {\n        const playlistId = requestUrl.searchParams.get('id') || '';\n        const playlist = await probeRawPlaylist(playlistId);\n        return sendJson(res, 200, { ok: true, playlist });\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, error: error.message });\n      }\n    }\n`;

if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: raw recommendations route anchor not found exactly; no changes written.');
}
source = source.replace(routeAnchor, routeReplacement);

fs.writeFileSync(target, source);
console.log('Added raw authenticated TIDAL playlist probe.');
console.log('This migration does not contact HEOS or alter playback.');

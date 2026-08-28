'use strict';

// Guarded integration step: expose the proven reusable official-TIDAL -> HEOS
// resolver through a read-only backend endpoint. This migration does not add
// any queue, playback, source, power, volume, or mute command.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const authPath = path.join(root, 'tidal-user-auth-recon.js');

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(label + ': expected exactly one anchor, found ' + count);
  }
  return source.replace(before, after);
}

let auth = fs.readFileSync(authPath, 'utf8');
const authBefore = `  return {\n    handle\n  };`;
const authAfter = `  return {\n    handle,\n    getTrackMetadata: probeTrackMetadata\n  };`;
if (auth.includes(authAfter)) {
  console.log('tidal-user-auth-recon.js already exposes getTrackMetadata');
} else {
  auth = replaceOnce(auth, authBefore, authAfter, 'tidal-user-auth-recon.js return object');
  fs.writeFileSync(authPath, auth);
}

let server = fs.readFileSync(serverPath, 'utf8');
const importBefore = `const {\n  createTidalBrowseCache\n} = require('./tidal-browse-cache');`;
const importAfter = `const {\n  createTidalBrowseCache\n} = require('./tidal-browse-cache');\nconst {\n  createTidalHeosResolver\n} = require('./tidal-heos-resolver');`;
if (!server.includes(importAfter)) {
  server = replaceOnce(server, importBefore, importAfter, 'server.js resolver import');
}

const initBefore = `const tidalUserAuthRecon = createTidalUserAuthRecon({\n  countryCode: 'GB'\n});\nlet pendingTidalVoiceSearch = null;`;
const initAfter = `const tidalUserAuthRecon = createTidalUserAuthRecon({\n  countryCode: 'GB'\n});\nconst tidalHeosResolver = createTidalHeosResolver({\n  heosBrowse,\n  sid: '10'\n});\nlet pendingTidalVoiceSearch = null;`;
if (!server.includes(initAfter)) {
  server = replaceOnce(server, initBefore, initAfter, 'server.js resolver initialization');
}

const routeAnchor = `  if (await tidalUserAuthRecon.handle(req, res)) return;\n\n  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {`;
const routeReplacement = `  if (await tidalUserAuthRecon.handle(req, res)) return;\n\n  if (req.method === 'GET' && req.url.startsWith('/api/tidal/resolve-track?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const id = String(url.searchParams.get('id') || '').trim();\n      if (!/^\\d+$/.test(id)) {\n        return sendJson(res, 400, { error: 'Track id must contain digits only' });\n      }\n\n      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);\n      const track = tidalHeosResolver.extractOfficialTrack(metadata);\n      const resolution = await tidalHeosResolver.resolveTrack(track);\n      return sendJson(res, 200, {\n        ok: true,\n        track,\n        resolution\n      });\n    } catch (error) {\n      return sendJson(res, 502, { ok: false, error: error.message });\n    }\n  }\n\n  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {`;
if (!server.includes("req.url.startsWith('/api/tidal/resolve-track?')")) {
  server = replaceOnce(server, routeAnchor, routeReplacement, 'server.js route anchor');
}

fs.writeFileSync(serverPath, server);

console.log('Added read-only /api/tidal/resolve-track?id=<official-track-id> integration.');
console.log('No queue, playback, source, power, volume, or mute route was added.');

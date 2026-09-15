'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'tidal-user-auth-recon.js');
const serverPath = path.join(root, 'server.js');
let auth = fs.readFileSync(authPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

function exactlyOnce(source, needle, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one ${label}, found ${count}`);
}

const apiMarker = '  async function apiGetRaw(path) {';
const exportMarker = '    getTrackMetadata: probeTrackMetadata,\n    getPersonalisedPlaylist,';
const statusOld = "      if (!/^\\d+$/.test(id)) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: 'Track id must contain digits only' });\n      }";
const statusNew = "      if (!id || id.length > 256) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: 'Track id is required and must be at most 256 characters' });\n      }";
const serverRouteAnchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-tracks')) {";
const validationMarker = 'let favouriteTracksValidationCache = null;';

const already = auth.includes('async function mutateFavouriteTrack(') &&
  auth.includes('mutateFavouriteTrack,') &&
  server.includes("url.pathname === '/api/tidal/favourite-track'");
if (already) {
  console.log(checkOnly ? 'OK: TIDAL favourite mutation API already present' : 'No change: TIDAL favourite mutation API already present');
  process.exit(0);
}

exactlyOnce(auth, apiMarker, 'auth API helper anchor');
exactlyOnce(auth, exportMarker, 'auth export anchor');
exactlyOnce(server, statusOld, 'status id validation anchor');
exactlyOnce(server, serverRouteAnchor, 'server favourite-tracks anchor');
exactlyOnce(server, validationMarker, 'validation cache anchor');

const mutationHelper = `  async function mutateFavouriteTrack(trackId, favourite, idempotencyKey) {\n    const id = String(trackId || '').trim();\n    const key = String(idempotencyKey || '').trim();\n    if (!id || id.length > 256) throw new Error('Track id is required and must be at most 256 characters');\n    if (!key || key.length > 256) throw new Error('Idempotency-Key is required and must be at most 256 characters');\n    if (typeof favourite !== 'boolean') throw new Error('Favourite state must be boolean');\n\n    await ensureSession();\n    const response = await fetch(\n      API_BASE + '/userCollectionTracks/me/relationships/items',\n      {\n        method: favourite ? 'POST' : 'DELETE',\n        headers: {\n          Authorization: 'Bearer ' + session.accessToken,\n          Accept: 'application/vnd.api+json',\n          'Content-Type': 'application/vnd.api+json',\n          'Idempotency-Key': key\n        },\n        body: JSON.stringify({ data: [{ id, type: 'tracks' }] })\n      }\n    );\n    const text = await response.text();\n    let payload = {};\n    if (text) {\n      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }\n    }\n    if (!response.ok) {\n      const detail = payload?.errors?.[0]?.detail || payload?.detail || ('HTTP ' + response.status);\n      throw new Error(response.status + ': ' + detail);\n    }\n\n    favouriteTracksCache.value = null;\n    favouriteTracksCache.expiresAt = 0;\n    return { httpStatus: response.status, payload };\n  }\n\n`;
auth = auth.replace(apiMarker, mutationHelper + apiMarker);
auth = auth.replace(exportMarker, '    getTrackMetadata: probeTrackMetadata,\n    mutateFavouriteTrack,\n    getPersonalisedPlaylist,');

server = server.replace(statusOld, statusNew);
server = server.replace(validationMarker, validationMarker + `\n\nfunction invalidateFavouriteTracksPlaybackValidation() {\n  favouriteTracksValidationCache = null;\n}`);

const route = `  if ((req.method === 'POST' || req.method === 'DELETE') && req.url.startsWith('/api/tidal/favourite-track?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const id = String(url.searchParams.get('id') || '').trim();\n      if (!id || id.length > 256) {\n        return sendJson(res, 400, { ok: false, error: 'Track id is required and must be at most 256 characters' });\n      }\n\n      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);\n      const officialId = String(metadata?.data?.id || '');\n      if (officialId !== id || metadata?.data?.type !== 'tracks') {\n        return sendJson(res, 409, { ok: false, error: 'Track id did not resolve to the same official TIDAL track id' });\n      }\n\n      const favourite = req.method === 'POST';\n      const idempotencyKey = require('crypto').randomUUID();\n      const mutation = await tidalUserAuthRecon.mutateFavouriteTrack(officialId, favourite, idempotencyKey);\n      invalidateFavouriteTracksPlaybackValidation();\n      const refreshed = await tidalUserAuthRecon.getFavouriteTracks({ forceRefresh: true });\n      const tracks = Array.isArray(refreshed.tracks) ? refreshed.tracks : [];\n      const confirmed = tracks.some(track => String(track?.id || '') === officialId);\n      if (confirmed !== favourite) {\n        return sendJson(res, 502, { ok: false, id: officialId, favourite: confirmed, error: 'TIDAL collection mutation was not confirmed by the subsequent official collection read' });\n      }\n\n      return sendJson(res, 200, {\n        ok: true,\n        id: officialId,\n        favourite: confirmed,\n        operation: favourite ? 'add' : 'remove',\n        tidalHttpStatus: mutation.httpStatus,\n        collectionRefreshed: true\n      });\n    } catch (error) {\n      const message = String(error?.message || error);\n      const statusCode = /^404:/.test(message) ? 404 : /^4\\d\\d:/.test(message) ? 400 : 502;\n      return sendJson(res, statusCode, { ok: false, error: message });\n    }\n  }\n\n`;
server = server.replace(serverRouteAnchor, route + serverRouteAnchor);

if (checkOnly) {
  console.log('OK: guarded TIDAL favourite mutation patch can be applied cleanly');
  process.exit(0);
}

fs.writeFileSync(authPath, auth);
fs.writeFileSync(serverPath, server);
console.log('Updated TIDAL auth and server with guarded favourite track mutation API');

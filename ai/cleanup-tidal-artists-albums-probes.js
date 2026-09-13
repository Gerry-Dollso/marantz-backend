'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const reconPath = path.join(root, 'tidal-user-auth-recon.js');
const serverPath = path.join(root, 'server.js');

const EXPECTED_RECON_BLOB = 'e82df01cd521a0d8cdc6bf393185bea8dd335329';
const EXPECTED_SERVER_BLOB = '715323f041c91a1341c1a6f0045f26fbaf343d41';

function blob(file) {
  return execFileSync('git', ['hash-object', file], { cwd: root, encoding: 'utf8' }).trim();
}

function guard(file, expected, label) {
  const actual = blob(file);
  if (actual !== expected) {
    throw new Error(`${label}: guard failed; expected ${expected}, got ${actual}`);
  }
}

function removeOnce(source, block, label) {
  const first = source.indexOf(block);
  if (first < 0) throw new Error(`${label}: exact block not found`);
  if (source.indexOf(block, first + block.length) >= 0) {
    throw new Error(`${label}: exact block is not unique`);
  }
  return source.slice(0, first) + source.slice(first + block.length);
}

guard(reconPath, EXPECTED_RECON_BLOB, 'tidal-user-auth-recon.js');
guard(serverPath, EXPECTED_SERVER_BLOB, 'server.js');

let recon = fs.readFileSync(reconPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

const singleAlbumFunction = `  async function probeAlbumSingleMetadata(albumId) {\n    const id = String(albumId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('album id must be numeric');\n\n    const payload = await apiGetRawWithRateLimitRetry(\n      '/albums/' + encodeURIComponent(id) + '?include=' + encodeURIComponent('artists,coverArt') +\n        '&countryCode=' + encodeURIComponent(countryCode),\n      'album single metadata probe ' + id\n    );\n    const data = payload?.data || null;\n    const included = Array.isArray(payload?.included) ? payload.included : [];\n    return {\n      ok: true,\n      readOnly: true,\n      requestedId: id,\n      returnedId: data?.id ? String(data.id) : null,\n      type: data?.type ? String(data.type) : null,\n      attributes: data?.attributes || {},\n      relationships: data?.relationships || {},\n      includedCount: included.length,\n      includedTypes: Object.fromEntries(Object.entries(included.reduce((counts, item) => {\n        const type = String(item?.type || 'unknown');\n        counts[type] = (counts[type] || 0) + 1;\n        return counts;\n      }, {})).sort(([a], [b]) => a.localeCompare(b)))\n    };\n  }\n\n`;

const bulkFunction = `  async function probeLibraryBulkMetadata(kind) {\n    const cleanKind = String(kind || '').trim().toLowerCase();\n    const config = cleanKind === 'artists'\n      ? { type: 'artists', include: 'profileArt' }\n      : cleanKind === 'albums'\n        ? { type: 'albums', include: 'artists,coverArt' }\n        : null;\n    if (!config) throw new Error('kind must be artists or albums');\n\n    const relationship = await getCollectionReferenceIds(cleanKind);\n    const ids = relationship.ids.slice(0, 20);\n    if (!ids.length) throw new Error('TIDAL ' + cleanKind + ' collection is empty');\n\n    const payload = await apiGetRawWithRateLimitRetry(\n      '/' + config.type + '?filter%5Bid%5D=' + encodeURIComponent(ids.join(',')) +\n        '&include=' + encodeURIComponent(config.include) +\n        '&countryCode=' + encodeURIComponent(countryCode),\n      cleanKind + ' bulk metadata probe'\n    );\n\n    const data = Array.isArray(payload?.data) ? payload.data : [];\n    const included = Array.isArray(payload?.included) ? payload.included : [];\n    const returnedIds = data\n      .filter(item => item?.type === config.type)\n      .map(item => String(item.id || ''));\n    const returnedSet = new Set(returnedIds);\n\n    return {\n      ok: true,\n      readOnly: true,\n      kind: cleanKind,\n      requestedCount: ids.length,\n      requestedIds: ids,\n      returnedCount: returnedIds.length,\n      returnedIds,\n      missingIds: ids.filter(id => !returnedSet.has(id)),\n      data: data.slice(0, 3).map(item => ({\n        id: String(item?.id || ''),\n        type: String(item?.type || ''),\n        attributes: item?.attributes || {},\n        relationships: item?.relationships || {}\n      })),\n      includedCount: included.length,\n      includedTypes: Object.fromEntries(\n        Object.entries(included.reduce((counts, item) => {\n          const type = String(item?.type || 'unknown');\n          counts[type] = (counts[type] || 0) + 1;\n          return counts;\n        }, {})).sort(([a], [b]) => a.localeCompare(b))\n      ),\n      included: included.slice(0, 8).map(item => ({\n        id: String(item?.id || ''),\n        type: String(item?.type || ''),\n        attributes: item?.attributes || {}\n      }))\n    };\n  }\n\n`;

const singleAlbumRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-album-single-metadata') {\n      try {\n        const result = await probeAlbumSingleMetadata(requestUrl.searchParams.get('id'));\n        return sendJson(res, 200, result);\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;

const bulkRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-library-bulk-metadata') {\n      try {\n        const result = await probeLibraryBulkMetadata(requestUrl.searchParams.get('kind'));\n        return sendJson(res, 200, result);\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;

const reconciliationRoute = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/oauth/probe-library-id-reconciliation?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const kind = String(url.searchParams.get('kind') || '').trim();\n      const config = kind === 'artists'\n        ? { cid: 'My Music-Artists', prefix: 'LIBARTIST-' }\n        : kind === 'albums'\n          ? { cid: 'My Music-Albums', prefix: 'LIBALBUM-' }\n          : null;\n\n      if (!config) return sendJson(res, 400, { ok: false, error: 'kind must be artists or albums' });\n\n      const official = await tidalUserAuthRecon.getCollectionReferenceIds(kind);\n      const heosIds = [];\n      const heosSeen = new Set();\n      const duplicateHeosIds = [];\n      const invalidHeosCids = [];\n      let start = 0;\n      let total = null;\n      let pages = 0;\n\n      while (total === null || start < total) {\n        if (pages >= 100) throw new Error('HEOS ' + kind + ' pagination safety limit reached');\n        const response = await heosBrowse(\n          'heos://browse/browse?sid=10&cid=' + encodeURIComponent(config.cid).replace(/%20/g, ' ') +\n          '&range=' + start + ',' + (start + 49)\n        );\n        const payload = Array.isArray(response.payload) ? response.payload : [];\n        const message = String(response.heos?.message || '');\n        const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n        if (countMatch) total = Number(countMatch[1]);\n\n        for (const item of payload) {\n          const cid = String(item?.cid || '');\n          if (!cid.startsWith(config.prefix)) {\n            invalidHeosCids.push(cid);\n            continue;\n          }\n          const id = cid.slice(config.prefix.length);\n          if (!/^\\d+$/.test(id)) {\n            invalidHeosCids.push(cid);\n            continue;\n          }\n          if (heosSeen.has(id)) duplicateHeosIds.push(id);\n          else {\n            heosSeen.add(id);\n            heosIds.push(id);\n          }\n        }\n\n        pages += 1;\n        if (!payload.length) break;\n        start += payload.length;\n        if (total === null && payload.length < 50) break;\n      }\n\n      const officialSet = new Set(official.ids);\n      const heosSet = new Set(heosIds);\n      const missingFromHeos = official.ids.filter(id => !heosSet.has(id));\n      const extraInHeos = heosIds.filter(id => !officialSet.has(id));\n\n      return sendJson(res, 200, {\n        ok: true,\n        readOnly: true,\n        kind,\n        officialCount: official.ids.length,\n        officialPages: official.pages,\n        heosCount: heosIds.length,\n        heosPages: pages,\n        sameIdSet: missingFromHeos.length === 0 && extraInHeos.length === 0,\n        missingFromHeosCount: missingFromHeos.length,\n        extraInHeosCount: extraInHeos.length,\n        duplicateHeosIdCount: duplicateHeosIds.length,\n        invalidHeosCidCount: invalidHeosCids.length,\n        missingFromHeos: missingFromHeos.slice(0, 50),\n        extraInHeos: extraInHeos.slice(0, 50),\n        duplicateHeosIds: duplicateHeosIds.slice(0, 50),\n        invalidHeosCids: invalidHeosCids.slice(0, 50)\n      });\n    } catch (error) {\n      return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });\n    }\n  }\n\n`;

recon = removeOnce(recon, singleAlbumFunction, 'single Album metadata function');
recon = removeOnce(recon, bulkFunction, 'bulk metadata function');
recon = removeOnce(recon, singleAlbumRoute, 'single Album metadata route');
recon = removeOnce(recon, bulkRoute, 'bulk metadata route');
server = removeOnce(server, reconciliationRoute, 'Artists/Albums reconciliation route');

if (!recon.includes('async function getCollectionReferenceIds(kind)')) {
  throw new Error('Production dependency getCollectionReferenceIds(kind) is missing; refusing to write');
}
if (!recon.includes('getFavouriteArtists') || !recon.includes('getFavouriteAlbums')) {
  throw new Error('Production Artists/Albums exports are missing; refusing to write');
}
if (!server.includes("'/api/tidal/favourite-artists'")) {
  throw new Error('Production favourite-artists endpoint is missing; refusing to write');
}
if (!server.includes("'/api/tidal/favourite-albums'")) {
  throw new Error('Production favourite-albums endpoint is missing; refusing to write');
}
if (!server.includes('TIDAL Artists prewarm ready:') || !server.includes('TIDAL Albums prewarm ready:')) {
  throw new Error('Production sequential prewarm is missing; refusing to write');
}

fs.writeFileSync(reconPath, recon);
fs.writeFileSync(serverPath, server);

console.log('tidal-user-auth-recon.js:', blob(reconPath));
console.log('server.js:', blob(serverPath));
console.log('Temporary Artists/Albums probes removed; production collection helpers/endpoints/prewarm retained.');
console.log('No service restart performed.');

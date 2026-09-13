'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const reconPath = 'tidal-user-auth-recon.js';
const expectedReconBlob = '4bcf4ecb29ee956fe236467450bd9e922679283f';

function blob(path) {
  return execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim();
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(label + ': anchor not found');
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(label + ': anchor is not unique');
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

if (blob(reconPath) !== expectedReconBlob) throw new Error(reconPath + ': unexpected source blob; refusing to edit');

let recon = fs.readFileSync(reconPath, 'utf8');

const functionAnchor = `  async function probeLibraryBulkMetadata(kind) {\n`;
const functionInsert = `  async function probeAlbumSingleMetadata(albumId) {\n    const id = String(albumId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('album id must be numeric');\n\n    const payload = await apiGetRawWithRateLimitRetry(\n      '/albums/' + encodeURIComponent(id) + '?include=' + encodeURIComponent('artists,coverArt') +\n        '&countryCode=' + encodeURIComponent(countryCode),\n      'album single metadata probe ' + id\n    );\n    const data = payload?.data || null;\n    const included = Array.isArray(payload?.included) ? payload.included : [];\n    return {\n      ok: true,\n      readOnly: true,\n      requestedId: id,\n      returnedId: data?.id ? String(data.id) : null,\n      type: data?.type ? String(data.type) : null,\n      attributes: data?.attributes || {},\n      relationships: data?.relationships || {},\n      includedCount: included.length,\n      includedTypes: Object.fromEntries(Object.entries(included.reduce((counts, item) => {\n        const type = String(item?.type || 'unknown');\n        counts[type] = (counts[type] || 0) + 1;\n        return counts;\n      }, {})).sort(([a], [b]) => a.localeCompare(b)))\n    };\n  }\n\n`;
recon = replaceOnce(recon, functionAnchor, functionInsert + functionAnchor, 'single album metadata function');

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-library-bulk-metadata') {\n`;
const routeInsert = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-album-single-metadata') {\n      try {\n        const result = await probeAlbumSingleMetadata(requestUrl.searchParams.get('id'));\n        return sendJson(res, 200, result);\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
recon = replaceOnce(recon, routeAnchor, routeInsert + routeAnchor, 'single album metadata route');

fs.writeFileSync(reconPath, recon);
console.log(reconPath + ': ' + blob(reconPath));
console.log('Read-only single Album metadata probe applied; no service restart performed.');

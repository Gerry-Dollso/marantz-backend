'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const reconPath = 'tidal-user-auth-recon.js';
const expectedReconBlob = '71ac63911bc253ed3bcea1216ef598c562e3ae41';

function blob(path) {
  return execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim();
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(label + ': anchor not found');
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(label + ': anchor is not unique');
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

if (blob(reconPath) !== expectedReconBlob) {
  throw new Error(reconPath + ': unexpected source blob; refusing to edit');
}

let recon = fs.readFileSync(reconPath, 'utf8');

const functionAnchor = `  async function probeRichMetadata() {\n`;
const functionInsert = `  async function probeLibraryBulkMetadata(kind) {\n    const cleanKind = String(kind || '').trim().toLowerCase();\n    const config = cleanKind === 'artists'\n      ? { type: 'artists', include: 'profileArt' }\n      : cleanKind === 'albums'\n        ? { type: 'albums', include: 'artists,coverArt' }\n        : null;\n    if (!config) throw new Error('kind must be artists or albums');\n\n    const relationship = await getCollectionReferenceIds(cleanKind);\n    const ids = relationship.ids.slice(0, 20);\n    if (!ids.length) throw new Error('TIDAL ' + cleanKind + ' collection is empty');\n\n    const payload = await apiGetRawWithRateLimitRetry(\n      '/' + config.type + '?filter%5Bid%5D=' + encodeURIComponent(ids.join(',')) +\n        '&include=' + encodeURIComponent(config.include) +\n        '&countryCode=' + encodeURIComponent(countryCode),\n      cleanKind + ' bulk metadata probe'\n    );\n\n    const data = Array.isArray(payload?.data) ? payload.data : [];\n    const included = Array.isArray(payload?.included) ? payload.included : [];\n    const returnedIds = data\n      .filter(item => item?.type === config.type)\n      .map(item => String(item.id || ''));\n    const returnedSet = new Set(returnedIds);\n\n    return {\n      ok: true,\n      readOnly: true,\n      kind: cleanKind,\n      requestedCount: ids.length,\n      requestedIds: ids,\n      returnedCount: returnedIds.length,\n      returnedIds,\n      missingIds: ids.filter(id => !returnedSet.has(id)),\n      data: data.slice(0, 3).map(item => ({\n        id: String(item?.id || ''),\n        type: String(item?.type || ''),\n        attributes: item?.attributes || {},\n        relationships: item?.relationships || {}\n      })),\n      includedCount: included.length,\n      includedTypes: Object.fromEntries(\n        Object.entries(included.reduce((counts, item) => {\n          const type = String(item?.type || 'unknown');\n          counts[type] = (counts[type] || 0) + 1;\n          return counts;\n        }, {})).sort(([a], [b]) => a.localeCompare(b))\n      ),\n      included: included.slice(0, 8).map(item => ({\n        id: String(item?.id || ''),\n        type: String(item?.type || ''),\n        attributes: item?.attributes || {}\n      }))\n    };\n  }\n\n`;
recon = replaceOnce(recon, functionAnchor, functionInsert + functionAnchor, 'bulk metadata function');

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {\n`;
const routeInsert = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-library-bulk-metadata') {\n      try {\n        const result = await probeLibraryBulkMetadata(requestUrl.searchParams.get('kind'));\n        return sendJson(res, 200, result);\n      } catch (error) {\n        return sendJson(res, 400, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
recon = replaceOnce(recon, routeAnchor, routeInsert + routeAnchor, 'bulk metadata route');

fs.writeFileSync(reconPath, recon);
console.log(reconPath + ': ' + blob(reconPath));
console.log('Read-only Artists/Albums bulk metadata probe applied.');

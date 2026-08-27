'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

if (server.includes('createTidalBrowseCache')) {
  throw new Error('TIDAL browse cache already appears to be applied');
}

const importAnchor = `const {\n  createTidalMetadataClient\n} = require('./tidal-metadata-client');\n`;
if (!server.includes(importAnchor)) {
  throw new Error('Expected TIDAL metadata import anchor not found');
}
server = server.replace(
  importAnchor,
  importAnchor +
  `const {\n  createTidalBrowseCache\n} = require('./tidal-browse-cache');\n`
);

const instanceAnchor = `const tidalMetadata = createTidalMetadataClient({ countryCode: 'GB' });\n`;
if (!server.includes(instanceAnchor)) {
  throw new Error('Expected TIDAL metadata instance anchor not found');
}
server = server.replace(
  instanceAnchor,
  instanceAnchor +
  `const tidalBrowseCache = createTidalBrowseCache({ maxEntries: 64 });\n`
);

const routeStart = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {\n`;
const nextRoute = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/search?')) {\n`;
const start = server.indexOf(routeStart);
const end = server.indexOf(nextRoute, start);
if (start < 0 || end < 0) {
  throw new Error('Expected TIDAL browse route boundaries not found');
}

const replacement = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {\n` +
`    try {\n` +
`      const url = new URL(req.url, 'http://localhost');\n` +
`      const cid = url.searchParams.get('cid');\n` +
`      if (!cid || !cid.trim()) return sendJson(res, 400, { error: 'Missing cid' });\n\n` +
`      const cleanCid = cid.trim();\n` +
`      const heosCid = encodeURIComponent(cleanCid).replace(/%20/g, ' ');\n` +
`      const hasPage = url.searchParams.has('start') || url.searchParams.has('limit');\n` +
`      const pageStart = hasPage\n` +
`        ? Math.max(0, Number(url.searchParams.get('start')) || 0)\n` +
`        : null;\n` +
`      const pageLimit = hasPage\n` +
`        ? Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))\n` +
`        : null;\n` +
`      const cacheKey = hasPage\n` +
`        ? cleanCid + '|page|' + pageStart + '|' + pageLimit\n` +
`        : cleanCid + '|all';\n\n` +
`      const highValueLibrary = new Set([\n` +
`        'My Music',\n` +
`        'Artists',\n` +
`        'Albums',\n` +
`        'Tracks',\n` +
`        'Playlists'\n` +
`      ]).has(cleanCid);\n` +
`      const policy = highValueLibrary\n` +
`        ? { refreshAfterMs: 15000, maxStaleMs: 12 * 60 * 60 * 1000 }\n` +
`        : { refreshAfterMs: 2 * 60 * 1000, maxStaleMs: 2 * 60 * 60 * 1000 };\n\n` +
`      const loader = async () => {\n` +
`        if (hasPage) {\n` +
`          const pageEnd = pageStart + pageLimit - 1;\n` +
`          const response = await heosBrowse(\n` +
`            'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + pageStart + ',' + pageEnd\n` +
`          );\n` +
`          const message = response.heos?.message || '';\n` +
`          const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n` +
`          const total = countMatch ? Number(countMatch[1]) : null;\n` +
`          return {\n` +
`            items: (response.payload || []).map(mapBrowseItem),\n` +
`            count: total,\n` +
`            start: pageStart,\n` +
`            limit: pageLimit\n` +
`          };\n` +
`        }\n\n` +
`        const pageSize = 50;\n` +
`        const allItems = [];\n` +
`        let browseStart = 0;\n` +
`        let total = null;\n` +
`        while (total === null || browseStart < total) {\n` +
`          const response = await heosBrowse(\n` +
`            'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + browseStart + ',' + (browseStart + pageSize - 1)\n` +
`          );\n` +
`          const payload = Array.isArray(response.payload) ? response.payload : [];\n` +
`          allItems.push(...payload);\n` +
`          const message = response.heos?.message || '';\n` +
`          const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n` +
`          if (countMatch) total = Number(countMatch[1]);\n` +
`          if (!payload.length) break;\n` +
`          browseStart += payload.length;\n` +
`          if (total === null && payload.length < pageSize) break;\n` +
`        }\n\n` +
`        return {\n` +
`          items: allItems.map(mapBrowseItem),\n` +
`          count: allItems.length\n` +
`        };\n` +
`      };\n\n` +
`      const cachedResult = await tidalBrowseCache.get(cacheKey, loader, policy);\n` +
`      return sendJson(res, 200, {\n` +
`        ok: true,\n` +
`        ...cachedResult.value,\n` +
`        cached: cachedResult.cached,\n` +
`        cacheAgeMs: cachedResult.cacheAgeMs,\n` +
`        refreshing: cachedResult.refreshing,\n` +
`        ...(cachedResult.refreshError\n` +
`          ? { cacheRefreshError: cachedResult.refreshError }\n` +
`          : {})\n` +
`      });\n` +
`    } catch (error) {\n` +
`      return sendJson(res, 500, { error: error.message });\n` +
`    }\n` +
`  }\n\n`;

server = server.slice(0, start) + replacement + server.slice(end);

const backup = serverPath + '.before-tidal-browse-cache';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Applied guarded TIDAL browse memory cache migration');
console.log('Backup:', backup);

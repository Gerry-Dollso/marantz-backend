'use strict';

const crypto = require('crypto');
const fs = require('fs');

const file = 'server.js';
const expectedBlobSha = '53fa8a971f8c9027c23dbe14ad8899d9522895cd';

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

let source = fs.readFileSync(file, 'utf8');
const actualBlobSha = gitBlobSha(source);
if (actualBlobSha !== expectedBlobSha) {
  throw new Error(`Refusing to edit ${file}: expected blob ${expectedBlobSha}, found ${actualBlobSha}`);
}

function replaceExactly(oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Could not locate guarded ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Guarded ${label} occurred more than once`);
  }
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

const stateAnchor = `let heosEventReconnectTimer = null;\n`;
const stateInsert = `let heosEventReconnectTimer = null;\nlet ordinaryPlaylistsCache = null;\nlet ordinaryPlaylistsRefreshInFlight = null;\nconst ORDINARY_PLAYLISTS_TTL_MS = 5 * 60 * 1000;\n`;
replaceExactly(stateAnchor, stateInsert, 'ordinary Playlists state anchor');

const functionAnchor = `const server = http.createServer(async (req, res) => {\n`;
const functions = `async function browseAllHeosPlaylistBranch(cid, label) {\n  const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');\n  const pageSize = 50;\n  const rows = [];\n  let start = 0;\n  let total = null;\n\n  while (total === null || start < total) {\n    const response = await heosBrowse(\n      'heos://browse/browse?sid=10&cid=' + heosCid +\n      '&range=' + start + ',' + (start + pageSize - 1)\n    );\n    const payload = Array.isArray(response.payload) ? response.payload : [];\n    rows.push(...payload);\n    const message = String(response.heos?.message || '');\n    const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n    if (countMatch) total = Number(countMatch[1]);\n    if (!payload.length) break;\n    start += payload.length;\n    if (total === null && payload.length < pageSize) break;\n  }\n\n  const items = rows.map((row, index) => {\n    const fullCid = String(row?.cid || '');\n    if (row?.type !== 'playlist' || row?.container !== 'yes' || row?.playable !== 'yes' || !fullCid.startsWith('LIBPLAYLIST-')) {\n      throw new Error('HEOS ' + label + ' returned an invalid playlist row at index ' + index);\n    }\n    const id = fullCid.slice('LIBPLAYLIST-'.length);\n    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {\n      throw new Error('HEOS ' + label + ' returned an invalid playlist id at index ' + index);\n    }\n    return {\n      id,\n      cid: fullCid,\n      name: String(row?.name || ''),\n      artwork: String(row?.image_url || ''),\n      type: 'playlist',\n      container: true,\n      playable: true\n    };\n  });\n\n  return { cid, label, reportedCount: total, items };\n}\n\nasync function refreshOrdinaryPlaylists() {\n  if (ordinaryPlaylistsRefreshInFlight) return ordinaryPlaylistsRefreshInFlight;\n\n  const refresh = (async () => {\n    const startedAt = Date.now();\n    const official = await tidalUserAuthRecon.getFavouritePlaylistReferenceIds();\n    const officialIds = Array.isArray(official.ids) ? official.ids.map(String) : [];\n    const officialSet = new Set(officialIds);\n\n    const created = await browseAllHeosPlaylistBranch(\n      'My Music-Playlists-Created by me',\n      'Created by me'\n    );\n    const favorited = await browseAllHeosPlaylistBranch(\n      'My Music-Playlists-Favorited',\n      'Favorited'\n    );\n\n    const heosRows = [...created.items, ...favorited.items];\n    const heosIds = heosRows.map(item => item.id);\n    const heosSet = new Set(heosIds);\n    if (heosSet.size !== heosIds.length) {\n      throw new Error('HEOS ordinary Playlists returned duplicate playlist ids across branches');\n    }\n\n    const intersectionIds = heosIds.filter(id => officialSet.has(id));\n    const metadata = await tidalUserAuthRecon.getPlaylistMetadata(intersectionIds);\n    const metadataById = new Map((metadata.items || []).map(item => [String(item.id), item]));\n\n    function buildBranch(branch) {\n      return branch.items\n        .filter(item => officialSet.has(item.id))\n        .map(item => {\n          const rich = metadataById.get(item.id) || null;\n          return {\n            ...(rich || { id: item.id, name: item.name || '' }),\n            cid: item.cid,\n            name: rich?.name || item.name || '',\n            artwork: rich?.artwork || item.artwork || null,\n            type: 'playlist',\n            container: true,\n            playable: true,\n            metadataSource: rich ? 'tidal' : 'heos-fallback'\n          };\n        });\n    }\n\n    const createdByMe = buildBranch(created);\n    const favoritedItems = buildBranch(favorited);\n    const refreshedAt = Date.now();\n    const value = {\n      createdByMe,\n      favorited: favoritedItems,\n      count: createdByMe.length + favoritedItems.length,\n      officialReferenceCount: officialIds.length,\n      officialRelationshipPages: Number(official.pages || 0),\n      heosCreatedReportedCount: created.reportedCount,\n      heosFavoritedReportedCount: favorited.reportedCount,\n      heosOrdinaryCount: heosRows.length,\n      officialOnlyCount: officialIds.filter(id => !heosSet.has(id)).length,\n      heosOnlyCount: heosIds.filter(id => !officialSet.has(id)).length,\n      unresolvedMetadataIds: Array.isArray(metadata.unresolvedIds) ? metadata.unresolvedIds : [],\n      metadataBatches: Number(metadata.metadataBatches || 0),\n      buildMs: refreshedAt - startedAt,\n      refreshedAt: new Date(refreshedAt).toISOString()\n    };\n    ordinaryPlaylistsCache = { value, expiresAt: refreshedAt + ORDINARY_PLAYLISTS_TTL_MS };\n    return value;\n  })();\n\n  ordinaryPlaylistsRefreshInFlight = refresh;\n  try {\n    return await refresh;\n  } finally {\n    if (ordinaryPlaylistsRefreshInFlight === refresh) ordinaryPlaylistsRefreshInFlight = null;\n  }\n}\n\nasync function getOrdinaryPlaylists() {\n  const now = Date.now();\n  if (ordinaryPlaylistsCache?.value) {\n    if (now < ordinaryPlaylistsCache.expiresAt) {\n      return { ...ordinaryPlaylistsCache.value, cached: true, stale: false, refreshing: Boolean(ordinaryPlaylistsRefreshInFlight) };\n    }\n    if (!ordinaryPlaylistsRefreshInFlight) {\n      refreshOrdinaryPlaylists().catch(error => {\n        console.error('TIDAL ordinary Playlists background refresh failed:', error.message);\n      });\n    }\n    return { ...ordinaryPlaylistsCache.value, cached: true, stale: true, refreshing: true };\n  }\n\n  try {\n    const value = await refreshOrdinaryPlaylists();\n    return { ...value, cached: false, stale: false, refreshing: false };\n  } catch (error) {\n    if (ordinaryPlaylistsCache?.value) {\n      return { ...ordinaryPlaylistsCache.value, cached: true, stale: true, refreshing: false, refreshError: error.message };\n    }\n    throw error;\n  }\n}\n\n`;
if (!source.includes(functionAnchor)) throw new Error('Could not locate guarded server creation anchor');
source = source.replace(functionAnchor, functions + functionAnchor);

const routeAnchor = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-tracks')) {\n`;
const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/favourite-playlists')) {\n    try {\n      const playlists = await getOrdinaryPlaylists();\n      return sendJson(res, 200, {\n        ok: true,\n        readOnly: true,\n        cid: 'My Music-Playlists',\n        ...playlists\n      });\n    } catch (error) {\n      return sendJson(res, 502, { ok: false, readOnly: true, error: error.message });\n    }\n  }\n\n`;
if (!source.includes(routeAnchor)) throw new Error('Could not locate guarded Favourite Tracks route anchor');
source = source.replace(routeAnchor, route + routeAnchor);

fs.writeFileSync(file, source);
console.log('Added production ordinary TIDAL Playlists catalogue endpoint with live HEOS/official intersection.');
console.log(`${file}: ${gitBlobSha(source)}`);
console.log('Preserves Created by me/Favorited grouping, HEOS LIBPLAYLIST CIDs, 5-minute stale-while-revalidate cache, and HEOS fallback metadata.');
console.log('No HEOS playback actions, queues, favourites, tidal-user-auth-recon.js, or Pi files were modified.');

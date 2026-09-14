'use strict';

const crypto = require('crypto');
const fs = require('fs');

const file = 'tidal-user-auth-recon.js';
const expectedBlobSha = '9572d3dd769858d7c699dae008e46c12359e2f71';

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

const tempCollectionFn = `  async function probeFavouritePlaylistCollection() {\n    const ids = [];\n    const seenIds = new Set();\n    const seenPages = new Set();\n    let next = '/userCollectionPlaylists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode);\n    let pages = 0;\n\n    while (next) {\n      if (pages >= FAVOURITE_TRACKS_MAX_PAGES) {\n        throw new Error('TIDAL Favourite Playlists pagination safety limit reached');\n      }\n\n      const path = normaliseApiPath(next);\n      if (seenPages.has(path)) {\n        throw new Error('TIDAL Favourite Playlists pagination repeated a page');\n      }\n      seenPages.add(path);\n\n      const payload = await apiGetRawWithRateLimitRetry(\n        path,\n        'Favourite Playlists relationship page ' + (pages + 1)\n      );\n      const data = Array.isArray(payload?.data) ? payload.data : [];\n      for (const linkage of data) {\n        const id = String(linkage?.id || '').trim();\n        if (linkage?.type !== 'playlists' || !/^[a-zA-Z0-9-]+$/.test(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained an invalid playlist linkage');\n        }\n        if (seenIds.has(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained duplicate id ' + id);\n        }\n        seenIds.add(id);\n        ids.push(id);\n      }\n\n      next = payload?.links?.next || null;\n      pages += 1;\n      if (next) {\n        await new Promise(resolve => setTimeout(resolve, FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS));\n      }\n    }\n\n    return { count: ids.length, pages, ids };\n  }\n\n`;
replaceExactly(tempCollectionFn, '', 'temporary Favourite Playlist collection function');

const tempBatchFn = `  async function probePlaylistBatchMetadata(ids) {\n    const values = String(ids || '').split(',').map(value => value.trim()).filter(Boolean);\n    if (!values.length || values.length > 20) {\n      throw new Error('Playlist batch probe requires 1 to 20 IDs');\n    }\n    if (values.some(id => !/^[a-zA-Z0-9-]+$/.test(id))) {\n      throw new Error('Playlist IDs must contain only letters, numbers, or hyphens');\n    }\n    return apiGetRaw(\n      '/playlists?filter%5Bid%5D=' + encodeURIComponent(values.join(',')) +\n      '&include=' + encodeURIComponent('coverArt') +\n      '&countryCode=' + encodeURIComponent(countryCode)\n    );\n  }\n\n`;
replaceExactly(tempBatchFn, '', 'temporary Playlist batch function');

replaceExactly(
  "if (!/^[a-zA-Z0-9-]+$/.test(id)) {\n      throw new Error('Playlist id must contain only letters, numbers, or hyphens');\n    }",
  "if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }",
  'temporary raw Playlist UUID validation'
);

replaceExactly(
  "'?include=' + encodeURIComponent('items,coverArt') +\n      '&countryCode=' + encodeURIComponent(countryCode)",
  "'?include=items&countryCode=' + encodeURIComponent(countryCode)",
  'temporary raw Playlist coverArt include'
);

const tempCollectionRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-favourite-playlist-collection') {\n      try {\n        const collection = await probeFavouritePlaylistCollection();\n        return sendJson(res, 200, { ok: true, readOnly: true, collection });\n      } catch (error) {\n        return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
replaceExactly(tempCollectionRoute, '', 'temporary Favourite Playlist collection route');

const tempBatchRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-batch') {\n      try {\n        const batch = await probePlaylistBatchMetadata(requestUrl.searchParams.get('ids'));\n        return sendJson(res, 200, { ok: true, readOnly: true, batch });\n      } catch (error) {\n        return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });\n      }\n    }\n\n`;
replaceExactly(tempBatchRoute, '', 'temporary Playlist batch route');

const insertionAnchor = '  async function probeRecommendations() {\n';
if (!source.includes(insertionAnchor)) throw new Error('Could not locate production Playlist insertion anchor');

const productionFns = `  async function getFavouritePlaylistReferenceIds() {\n    const ids = [];\n    const seenIds = new Set();\n    const seenPages = new Set();\n    let next = '/userCollectionPlaylists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode);\n    let pages = 0;\n\n    while (next) {\n      if (pages >= FAVOURITE_TRACKS_MAX_PAGES) {\n        throw new Error('TIDAL Favourite Playlists pagination safety limit reached');\n      }\n      const path = normaliseApiPath(next);\n      if (seenPages.has(path)) {\n        throw new Error('TIDAL Favourite Playlists pagination repeated a page');\n      }\n      seenPages.add(path);\n\n      const payload = await apiGetRawWithRateLimitRetry(\n        path,\n        'Favourite Playlists relationship page ' + (pages + 1)\n      );\n      const data = Array.isArray(payload?.data) ? payload.data : [];\n      for (const linkage of data) {\n        const id = String(linkage?.id || '').trim();\n        if (linkage?.type !== 'playlists' || !/^[a-zA-Z0-9-]+$/.test(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained an invalid playlist linkage');\n        }\n        if (seenIds.has(id)) {\n          throw new Error('TIDAL Favourite Playlists relationship contained duplicate id ' + id);\n        }\n        seenIds.add(id);\n        ids.push(id);\n      }\n\n      next = payload?.links?.next || null;\n      pages += 1;\n      if (next) {\n        await new Promise(resolve => setTimeout(resolve, FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS));\n      }\n    }\n\n    return { ids, pages };\n  }\n\n  async function getPlaylistMetadata(ids) {\n    const requested = Array.isArray(ids)\n      ? ids.map(id => String(id || '').trim()).filter(Boolean)\n      : [];\n    if (!requested.length) return { items: [], unresolvedIds: [], metadataBatches: 0 };\n    if (requested.some(id => !/^[a-zA-Z0-9-]+$/.test(id))) {\n      throw new Error('TIDAL Playlist metadata request contained an invalid playlist id');\n    }\n    if (new Set(requested).size !== requested.length) {\n      throw new Error('TIDAL Playlist metadata request contained duplicate ids');\n    }\n\n    const batches = [];\n    for (let i = 0; i < requested.length; i += FAVOURITE_TRACKS_BATCH_SIZE) {\n      batches.push(requested.slice(i, i + FAVOURITE_TRACKS_BATCH_SIZE));\n    }\n\n    const batchValues = await mapWithConcurrency(\n      batches,\n      FAVOURITE_TRACKS_METADATA_CONCURRENCY,\n      async (batch, index) => {\n        const payload = await apiGetRawWithRateLimitRetry(\n          '/playlists?filter%5Bid%5D=' + encodeURIComponent(batch.join(',')) +\n            '&include=' + encodeURIComponent('coverArt') +\n            '&countryCode=' + encodeURIComponent(countryCode),\n          'Playlist metadata batch ' + (index + 1)\n        );\n        const data = Array.isArray(payload?.data) ? payload.data : [];\n        const included = Array.isArray(payload?.included) ? payload.included : [];\n        const requestedSet = new Set(batch);\n        const resources = buildResourceMap([...data, ...included]);\n        const values = [];\n\n        for (const resource of data) {\n          const id = String(resource?.id || '');\n          if (resource?.type !== 'playlists' || !requestedSet.has(id)) {\n            throw new Error('TIDAL Playlist bulk metadata returned an unexpected resource');\n          }\n          const artworkLink = relationshipItems(resource.relationships?.coverArt)[0] || null;\n          const artwork = artworkLink ? resources.get(resourceKey(artworkLink)) : null;\n          const name = String(resource.attributes?.name || '');\n          if (!name) throw new Error('TIDAL Playlist metadata is incomplete for playlist ' + id);\n          values.push({\n            id,\n            name,\n            playlistType: resource.attributes?.playlistType ? String(resource.attributes.playlistType) : null,\n            numberOfItems: Number.isFinite(Number(resource.attributes?.numberOfItems)) ? Number(resource.attributes.numberOfItems) : null,\n            numberOfTrackItems: Number.isFinite(Number(resource.attributes?.numberOfTrackItems)) ? Number(resource.attributes.numberOfTrackItems) : null,\n            numberOfVideoItems: Number.isFinite(Number(resource.attributes?.numberOfVideoItems)) ? Number(resource.attributes.numberOfVideoItems) : null,\n            duration: resource.attributes?.duration ? String(resource.attributes.duration) : null,\n            lastModifiedAt: resource.attributes?.lastModifiedAt ? String(resource.attributes.lastModifiedAt) : null,\n            artwork: pickArtworkHref(artwork)\n          });\n        }\n        return values;\n      }\n    );\n\n    const byId = new Map();\n    for (const values of batchValues) {\n      for (const value of values) {\n        if (byId.has(value.id)) throw new Error('TIDAL Playlist metadata returned duplicate id ' + value.id);\n        byId.set(value.id, value);\n      }\n    }\n\n    const items = [];\n    const unresolvedIds = [];\n    for (const id of requested) {\n      const value = byId.get(id);\n      if (value) items.push(value);\n      else unresolvedIds.push(id);\n    }\n    return { items, unresolvedIds, metadataBatches: batches.length };\n  }\n\n`;
source = source.replace(insertionAnchor, productionFns + insertionAnchor);

const exportAnchor = '    getFavouriteAlbums,\n    getCollectionReferenceIds\n';
if (!source.includes(exportAnchor)) throw new Error('Could not locate production Playlist export anchor');
source = source.replace(
  exportAnchor,
  '    getFavouriteAlbums,\n    getFavouritePlaylistReferenceIds,\n    getPlaylistMetadata,\n    getCollectionReferenceIds\n'
);

fs.writeFileSync(file, source);
console.log('Promoted proven Playlist collection and batch metadata access to production API methods.');
console.log(`${file}: ${gitBlobSha(source)}`);
console.log('Temporary Playlist collection/batch routes and temporary raw Playlist probe changes were removed.');
console.log('No HEOS playback, queue, favourites, server.js, or Pi files were modified.');

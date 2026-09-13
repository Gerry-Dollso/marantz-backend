'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const reconPath = path.join(root, 'tidal-user-auth-recon.js');
const serverPath = path.join(root, 'server.js');

const EXPECTED_RECON_BLOB = 'ca94f09d585aae884d8f410af7be287dc399ae53';
const EXPECTED_SERVER_BLOB = '8c1bd1da329715b627f18d6f3836b27ec8c4448d';

function gitBlob(file) {
  return execFileSync('git', ['hash-object', file], { cwd: root, encoding: 'utf8' }).trim();
}

function guardBlob(file, expected, label) {
  const actual = gitBlob(file);
  if (actual !== expected) {
    throw new Error(`Guard failed: ${label} blob is ${actual}, expected ${expected}`);
  }
}

guardBlob(reconPath, EXPECTED_RECON_BLOB, 'tidal-user-auth-recon.js');
guardBlob(serverPath, EXPECTED_SERVER_BLOB, 'server.js');

let recon = fs.readFileSync(reconPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

const reconAnchor = '  async function getFavouriteTrackReferenceIds() {';
const reconAddition = `  async function getCollectionReferenceIds(kind) {
    const config = kind === 'artists'
      ? { type: 'artists', label: 'Saved Artists', path: '/userCollectionArtists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode) }
      : kind === 'albums'
        ? { type: 'albums', label: 'Saved Albums', path: '/userCollectionAlbums/me/relationships/items?countryCode=' + encodeURIComponent(countryCode) }
        : null;

    if (!config) throw new Error('Unsupported TIDAL collection kind');

    const ids = [];
    const seenIds = new Set();
    const seenPages = new Set();
    let next = config.path;
    let pages = 0;

    while (next) {
      if (pages >= FAVOURITE_TRACKS_MAX_PAGES) {
        throw new Error('TIDAL ' + config.label + ' pagination safety limit reached');
      }

      const path = normaliseApiPath(next);
      if (seenPages.has(path)) {
        throw new Error('TIDAL ' + config.label + ' pagination repeated a page');
      }
      seenPages.add(path);

      const payload = await apiGetRawWithRateLimitRetry(path, config.label + ' relationship page ' + (pages + 1));
      const data = Array.isArray(payload?.data) ? payload.data : [];
      for (const linkage of data) {
        const id = String(linkage?.id || '').trim();
        if (linkage?.type !== config.type || !/^\\d+$/.test(id)) {
          throw new Error('TIDAL ' + config.label + ' relationship contained an invalid linkage');
        }
        if (seenIds.has(id)) {
          throw new Error('TIDAL ' + config.label + ' relationship contained duplicate id ' + id);
        }
        seenIds.add(id);
        ids.push(id);
      }

      next = payload?.links?.next || null;
      pages += 1;
      if (next) {
        await new Promise(resolve => setTimeout(resolve, FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS));
      }
    }

    return { kind, ids, pages };
  }

`;

if (!recon.includes(reconAnchor)) {
  throw new Error('Guard failed: Favourite Tracks relationship function anchor not found');
}
if (recon.includes('async function getCollectionReferenceIds(kind)')) {
  throw new Error('Guard failed: collection reference helper already exists unexpectedly');
}
recon = recon.replace(reconAnchor, reconAddition + reconAnchor);

const exportAnchor = '    getPersonalisedPlaylist,\n    getFavouriteTracks\n';
const exportReplacement = '    getPersonalisedPlaylist,\n    getFavouriteTracks,\n    getCollectionReferenceIds\n';
if (!recon.includes(exportAnchor)) {
  throw new Error('Guard failed: recon export anchor not found');
}
recon = recon.replace(exportAnchor, exportReplacement);

const serverAnchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {";
const serverAddition = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/oauth/probe-library-id-reconciliation?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const kind = String(url.searchParams.get('kind') || '').trim();
      const config = kind === 'artists'
        ? { cid: 'My Music-Artists', prefix: 'LIBARTIST-' }
        : kind === 'albums'
          ? { cid: 'My Music-Albums', prefix: 'LIBALBUM-' }
          : null;

      if (!config) return sendJson(res, 400, { ok: false, error: 'kind must be artists or albums' });

      const official = await tidalUserAuthRecon.getCollectionReferenceIds(kind);
      const heosIds = [];
      const heosSeen = new Set();
      const duplicateHeosIds = [];
      const invalidHeosCids = [];
      let start = 0;
      let total = null;
      let pages = 0;

      while (total === null || start < total) {
        if (pages >= 100) throw new Error('HEOS ' + kind + ' pagination safety limit reached');
        const response = await heosBrowse(
          'heos://browse/browse?sid=10&cid=' + encodeURIComponent(config.cid).replace(/%20/g, ' ') +
          '&range=' + start + ',' + (start + 49)
        );
        const payload = Array.isArray(response.payload) ? response.payload : [];
        const message = String(response.heos?.message || '');
        const countMatch = message.match(/(?:^|&)count=(\\d+)/);
        if (countMatch) total = Number(countMatch[1]);

        for (const item of payload) {
          const cid = String(item?.cid || '');
          if (!cid.startsWith(config.prefix)) {
            invalidHeosCids.push(cid);
            continue;
          }
          const id = cid.slice(config.prefix.length);
          if (!/^\\d+$/.test(id)) {
            invalidHeosCids.push(cid);
            continue;
          }
          if (heosSeen.has(id)) duplicateHeosIds.push(id);
          else {
            heosSeen.add(id);
            heosIds.push(id);
          }
        }

        pages += 1;
        if (!payload.length) break;
        start += payload.length;
        if (total === null && payload.length < 50) break;
      }

      const officialSet = new Set(official.ids);
      const heosSet = new Set(heosIds);
      const missingFromHeos = official.ids.filter(id => !heosSet.has(id));
      const extraInHeos = heosIds.filter(id => !officialSet.has(id));

      return sendJson(res, 200, {
        ok: true,
        readOnly: true,
        kind,
        officialCount: official.ids.length,
        officialPages: official.pages,
        heosCount: heosIds.length,
        heosPages: pages,
        sameIdSet: missingFromHeos.length === 0 && extraInHeos.length === 0,
        missingFromHeosCount: missingFromHeos.length,
        extraInHeosCount: extraInHeos.length,
        duplicateHeosIdCount: duplicateHeosIds.length,
        invalidHeosCidCount: invalidHeosCids.length,
        missingFromHeos: missingFromHeos.slice(0, 50),
        extraInHeos: extraInHeos.slice(0, 50),
        duplicateHeosIds: duplicateHeosIds.slice(0, 50),
        invalidHeosCids: invalidHeosCids.slice(0, 50)
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, readOnly: true, error: error.message });
    }
  }

`;

if (!server.includes(serverAnchor)) {
  throw new Error('Guard failed: TIDAL browse route anchor not found');
}
if (server.includes('/api/tidal/oauth/probe-library-id-reconciliation?')) {
  throw new Error('Guard failed: reconciliation probe route already exists unexpectedly');
}
server = server.replace(serverAnchor, serverAddition + serverAnchor);

fs.writeFileSync(reconPath, recon);
fs.writeFileSync(serverPath, server);

console.log('tidal-user-auth-recon.js:', gitBlob(reconPath));
console.log('server.js:', gitBlob(serverPath));
console.log('Read-only Artists/Albums ID reconciliation probe applied.');

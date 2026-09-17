'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'tidal-artist-details.js');
let source = fs.readFileSync(file, 'utf8');

if (source.includes('APPEARS_ON_PREVIEW_LIMIT')) {
  throw new Error('Lazy Appears On support already appears to be installed');
}

const oldConstant = "const TOP_TRACK_LIMIT = 10;";
const newConstant = "const TOP_TRACK_LIMIT = 10;\nconst APPEARS_ON_PREVIEW_LIMIT = 4;";
if (!source.includes(oldConstant)) throw new Error('Expected TOP_TRACK_LIMIT anchor not found');
source = source.replace(oldConstant, newConstant);

const oldFunction = `  async function heosArtistCategory(artistId, category) {
    const cid = \`LIBARTIST-\${category}-\${artistId}\`;
    const rows = [];
    let start = 0;
    let total = null;
    while (total === null || start < total) {
      const encodedCid = encodeURIComponent(cid).replace(/%20/g, ' ');
      const response = await heosBrowse(\`heos://browse/browse?sid=10&cid=\${encodedCid}&range=\${start},\${start + 49}\`);
      const payload = Array.isArray(response.payload) ? response.payload : [];
      rows.push(...payload);
      const match = String(response.heos?.message || '').match(/(?:^|&)count=(\\d+)/);
      if (match) total = Number(match[1]);
      if (payload.length === 0) break;
      start += payload.length;
      if (total === null && payload.length < 50) break;
    }
    return { cid, total, rows };
  }`;

const newFunction = `  async function heosArtistCategory(artistId, category, limit = null) {
    const cid = \`LIBARTIST-\${category}-\${artistId}\`;
    const rows = [];
    let start = 0;
    let total = null;
    const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : null;
    while ((total === null || start < total) && (requestedLimit === null || rows.length < requestedLimit)) {
      const encodedCid = encodeURIComponent(cid).replace(/%20/g, ' ');
      const pageSize = requestedLimit === null ? 50 : Math.min(50, requestedLimit - rows.length);
      const response = await heosBrowse(\`heos://browse/browse?sid=10&cid=\${encodedCid}&range=\${start},\${start + pageSize - 1}\`);
      const payload = Array.isArray(response.payload) ? response.payload : [];
      rows.push(...payload.slice(0, pageSize));
      const match = String(response.heos?.message || '').match(/(?:^|&)count=(\\d+)/);
      if (match) total = Number(match[1]);
      if (payload.length === 0) break;
      start += payload.length;
      if (total === null && payload.length < pageSize) break;
    }
    return { cid, total, rows };
  }`;

if (!source.includes(oldFunction)) throw new Error('Expected heosArtistCategory implementation not found; refusing to guess');
source = source.replace(oldFunction, newFunction);

const oldCall = "    const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums');";
const newCall = "    const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums', APPEARS_ON_PREVIEW_LIMIT);";
if (!source.includes(oldCall)) throw new Error('Expected Other Albums call not found');
source = source.replace(oldCall, newCall);

fs.writeFileSync(file, source);
console.log('Installed guarded lazy Appears On preview in tidal-artist-details.js');

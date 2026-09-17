'use strict';

const fs = require('fs');

function replaceExact(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`Guard failed in ${path}`);
  if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Guard matched more than once in ${path}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceExact(
  'tidal-artist-details.js',
  `  async function getArtistBiography(artistId, options = {}) {\n`,
  `  async function getArtistReleases(artistId, category) {\n    const id = String(artistId || '').trim();\n    if (!/^\\d+$/.test(id)) throw new Error('Artist id must contain digits only');\n    const categories = { albums: 'Albums', singles: 'EP n Singles', appears: 'Other Albums' };\n    const heosCategory = categories[String(category || '').trim()];\n    if (!heosCategory) throw new Error('Invalid Artist release category');\n    const result = await heosArtistCategory(id, heosCategory);\n    const [releases] = await enrichHeosAlbums([result.rows]);\n    return { category: String(category), total: Number.isFinite(result.total) ? result.total : releases.length, releases };\n  }\n\n  async function getArtistBiography(artistId, options = {}) {\n`
);

replaceExact(
  'tidal-artist-details.js',
  `  return { getArtistDetails, getArtistTopTracks, getArtistBiography };\n`,
  `  return { getArtistDetails, getArtistTopTracks, getArtistReleases, getArtistBiography };\n`
);

replaceExact(
  'server.js',
  `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-biography?')) {\n`,
  `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-releases?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const artistId = url.searchParams.get('id') || '';\n      const category = url.searchParams.get('category') || '';\n      const result = await tidalArtistDetails.getArtistReleases(artistId, category);\n      return sendJson(res, 200, { ok: true, artistId: String(artistId), ...result });\n    } catch (error) {\n      return sendJson(res, 500, { ok: false, error: error.message });\n    }\n  }\n\n  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist-biography?')) {\n`
);

console.log('Added guarded full Artist release loading');

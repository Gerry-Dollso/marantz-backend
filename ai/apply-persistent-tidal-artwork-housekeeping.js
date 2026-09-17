'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'server.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected anchor not found');
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(label + ': anchor was not unique');
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'artist housekeeping',
  "      const artists = tidalArtworkHttp.decorateItems('artist', Array.isArray(official.items) ? official.items.map(artist => ({\n        ...artist,\n        cid: 'LIBARTIST-' + artist.id\n      })) : []);\n      return sendJson(res, 200, {\n",
  "      const artists = tidalArtworkHttp.decorateItems('artist', Array.isArray(official.items) ? official.items.map(artist => ({\n        ...artist,\n        cid: 'LIBARTIST-' + artist.id\n      })) : []);\n      if (!official.stale && !official.refreshing && Number(official.staleReferenceCount || 0) === 0) {\n        tidalArtworkHttp.noteCompleteLibrary('artist', artists);\n      }\n      return sendJson(res, 200, {\n"
);

replaceOnce(
  'album housekeeping',
  "      const albums = tidalArtworkHttp.decorateItems('album', Array.isArray(official.items) ? official.items.map(album => ({\n        ...album,\n        cid: 'LIBALBUM-' + album.id\n      })) : []);\n      return sendJson(res, 200, {\n",
  "      const albums = tidalArtworkHttp.decorateItems('album', Array.isArray(official.items) ? official.items.map(album => ({\n        ...album,\n        cid: 'LIBALBUM-' + album.id\n      })) : []);\n      if (!official.stale && !official.refreshing && Number(official.staleReferenceCount || 0) === 0) {\n        tidalArtworkHttp.noteCompleteLibrary('album', albums);\n      }\n      return sendJson(res, 200, {\n"
);

fs.writeFileSync(target, source, 'utf8');
console.log('Applied guarded persistent TIDAL artwork housekeeping integration to server.js');

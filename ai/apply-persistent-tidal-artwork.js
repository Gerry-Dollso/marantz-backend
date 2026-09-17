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
  'artwork import',
  "const {\n  createTidalBrowseCache\n} = require('./tidal-browse-cache');\n",
  "const {\n  createTidalBrowseCache\n} = require('./tidal-browse-cache');\nconst { createTidalArtworkHttp } = require('./tidal-artwork-http');\n"
);

replaceOnce(
  'artwork instance',
  "const tidalBrowseCache = createTidalBrowseCache({ maxEntries: 64 });\n",
  "const tidalBrowseCache = createTidalBrowseCache({ maxEntries: 64 });\nconst tidalArtworkHttp = createTidalArtworkHttp({ concurrency: 2 });\n"
);

replaceOnce(
  'artist decoration',
  "      const artists = Array.isArray(official.items) ? official.items.map(artist => ({\n        ...artist,\n        cid: 'LIBARTIST-' + artist.id\n      })) : [];\n",
  "      const artists = tidalArtworkHttp.decorateItems('artist', Array.isArray(official.items) ? official.items.map(artist => ({\n        ...artist,\n        cid: 'LIBARTIST-' + artist.id\n      })) : []);\n"
);

replaceOnce(
  'album decoration',
  "      const albums = Array.isArray(official.items) ? official.items.map(album => ({\n        ...album,\n        cid: 'LIBALBUM-' + album.id\n      })) : [];\n",
  "      const albums = tidalArtworkHttp.decorateItems('album', Array.isArray(official.items) ? official.items.map(album => ({\n        ...album,\n        cid: 'LIBALBUM-' + album.id\n      })) : []);\n"
);

const handlerAnchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/probe-favourite-tracks-heos-validation')) {\n";
replaceOnce(
  'artwork HTTP route',
  handlerAnchor,
  "  {\n    const artworkUrl = new URL(req.url, 'http://localhost');\n    if (tidalArtworkHttp.serve(req, res, artworkUrl.pathname)) return;\n  }\n\n" + handlerAnchor
);

fs.writeFileSync(target, source, 'utf8');
console.log('Applied guarded persistent TIDAL artwork integration to server.js');

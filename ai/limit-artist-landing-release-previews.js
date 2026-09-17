'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-artist-details.js');
let source = fs.readFileSync(target, 'utf8');

const required = [
  "const APPEARS_ON_PREVIEW_LIMIT = 4;",
  "const albumsHeos = await heosArtistCategory(artistId, 'Albums');",
  "const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles');",
  "const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums', APPEARS_ON_PREVIEW_LIMIT);",
  "biography: null"
];
for (const marker of required) {
  if (!source.includes(marker)) throw new Error('Guard failed; expected marker missing: ' + marker);
}
if (source.includes('const RELEASE_PREVIEW_LIMIT = 3;')) {
  throw new Error('Artist landing release preview limiter already installed');
}

source = source.replace(
  "const APPEARS_ON_PREVIEW_LIMIT = 4;",
  "const RELEASE_PREVIEW_LIMIT = 3;"
);
source = source.replace(
  "const albumsHeos = await heosArtistCategory(artistId, 'Albums');",
  "const albumsHeos = await heosArtistCategory(artistId, 'Albums', RELEASE_PREVIEW_LIMIT);"
);
source = source.replace(
  "const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles');",
  "const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles', RELEASE_PREVIEW_LIMIT);"
);
source = source.replace(
  "const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums', APPEARS_ON_PREVIEW_LIMIT);",
  "const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums', RELEASE_PREVIEW_LIMIT);"
);

fs.writeFileSync(target, source);
console.log('Installed guarded 3-item Artist landing release previews');

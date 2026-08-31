'use strict';

const fs = require('fs');

const path = 'tidal-user-auth-recon.js';
let source = fs.readFileSync(path, 'utf8');

const oldText = "      playlists.push({ id, name: playlistName(resource), kind });";
const newText = [
  "      playlists.push({",
  "        id,",
  "        name: playlistName(resource),",
  "        kind,",
  "        description: String(resource.attributes?.description || '').trim()",
  "      });"
].join('\n');

const matches = source.split(oldText).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one personalised recommendation anchor, found ${matches}`);
}

source = source.replace(oldText, newText);
fs.writeFileSync(path, source);
console.log('Applied guarded personalised TIDAL descriptions migration');

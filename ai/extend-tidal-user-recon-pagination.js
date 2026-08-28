'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldPaths = [
  "['artists', '/userCollectionArtists/me?include=items&countryCode=' + encodeURIComponent(countryCode)]",
  "['albums', '/userCollectionAlbums/me?include=items&countryCode=' + encodeURIComponent(countryCode)]",
  "['tracks', '/userCollectionTracks/me?include=items&countryCode=' + encodeURIComponent(countryCode)]"
];
const newPaths = [
  "['artists', '/userCollectionArtists/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)]",
  "['albums', '/userCollectionAlbums/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)]",
  "['tracks', '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(countryCode)]"
];

if (!source.includes('async function probeCollectionPagination()')) {
  throw new Error('Guard failed: pagination benchmark is not present');
}

let changed = 0;
for (let i = 0; i < oldPaths.length; i += 1) {
  if (source.includes(newPaths[i])) continue;
  if (!source.includes(oldPaths[i])) {
    throw new Error('Guard failed: expected old collection path not found for index ' + i);
  }
  source = source.replace(oldPaths[i], newPaths[i]);
  changed += 1;
}

const oldCount = "        const included = Array.isArray(payload?.included) ? payload.included : [];\n        totalItems += included.filter(item => item && item.type !== 'userCollectionArtists' && item.type !== 'userCollectionAlbums' && item.type !== 'userCollectionTracks').length;";
const newCount = "        const data = Array.isArray(payload?.data) ? payload.data : [];\n        totalItems += data.length;";
if (!source.includes(newCount)) {
  if (!source.includes(oldCount)) {
    throw new Error('Guard failed: expected included-item counter not found');
  }
  source = source.replace(oldCount, newCount);
  changed += 1;
}

if (!changed) {
  console.log('Already corrected: relationship pagination benchmark present');
  process.exit(0);
}

fs.writeFileSync(target, source);
console.log('Corrected: pagination now follows collection relationship items and counts relationship data');

'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldText = "      '&include=' + encodeURIComponent('items')\n";
const newText = "      '&include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums.coverArt')\n";

const matches = source.split(oldText).length - 1;
if (matches !== 1) {
  throw new Error(`Guard failed: expected exactly one playlist relationship include=items anchor, found ${matches}; no changes written.`);
}

source = source.replace(oldText, newText);
fs.writeFileSync(target, source);

console.log('Expanded read-only TIDAL playlist relationship-page probe to nested track metadata/artwork includes.');
console.log('This migration does not contact HEOS or alter playback.');

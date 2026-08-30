'use strict';

const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'tidal-heos-resolver.js');
const source = fs.readFileSync(targetPath, 'utf8');

const anchor = "    if (unique.length > 1 || deterministicUnique.length > 1) return { status: 'ambiguous', reason: 'multiple HEOS album/track matches' };\n";

const replacement = `    if (unique.length > 1 || deterministicUnique.length > 1) {\n      const ambiguous = unique.length > 1 ? unique : deterministicUnique;\n      return {\n        status: 'ambiguous',\n        reason: 'multiple HEOS album/track matches',\n        candidates: ambiguous.map(x => ({\n          cid: String(x.album.cid),\n          albumId: String(x.album.cid).replace(/^LIBALBUM-/, ''),\n          mid: String(x.track.mid),\n          title: String(x.track.name || target.title || ''),\n          artist: String(x.track.artist || target.artist || '')\n        }))\n      };\n    }\n`;

const count = source.split(anchor).length - 1;
if (count !== 1) {
  throw new Error(`Expected exactly one ambiguous resolver anchor; found ${count}`);
}

const updated = source.replace(anchor, replacement);
fs.writeFileSync(targetPath, updated);
console.log('Updated tidal-heos-resolver.js to expose qualified ambiguous candidates');

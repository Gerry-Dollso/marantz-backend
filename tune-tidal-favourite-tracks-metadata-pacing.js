'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(label + ': expected anchor not found');
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(label + ': expected anchor is not unique');
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'metadata pacing constants',
  '  const FAVOURITE_TRACKS_METADATA_CONCURRENCY = 2;\n  const FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS = 500;\n',
  '  const FAVOURITE_TRACKS_METADATA_CONCURRENCY = 1;\n  const FAVOURITE_TRACKS_METADATA_BATCH_DELAY_MS = 250;\n  const FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS = 500;\n'
);

replaceOnce(
  'metadata batch pacing',
  '        results[index] = await mapper(items[index], index);\n',
  '        results[index] = await mapper(items[index], index);\n        if (index + 1 < items.length && concurrency === FAVOURITE_TRACKS_METADATA_CONCURRENCY) {\n          await new Promise(resolve => setTimeout(resolve, FAVOURITE_TRACKS_METADATA_BATCH_DELAY_MS));\n        }\n'
);

fs.writeFileSync(target, source);
console.log('Updated tidal-user-auth-recon.js with serial Favourite Tracks metadata pacing.');

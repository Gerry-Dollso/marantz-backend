'use strict';

const fs = require('fs');

const path = 'tidal-user-auth-recon.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error('Missing expected anchor: ' + label);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error('Expected exactly one anchor: ' + label);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "  const FAVOURITE_TRACKS_BATCH_SIZE = 20;\n  const FAVOURITE_TRACKS_METADATA_CONCURRENCY = 4;\n",
  "  const FAVOURITE_TRACKS_BATCH_SIZE = 20;\n  const FAVOURITE_TRACKS_METADATA_CONCURRENCY = 2;\n  const FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS = 350;\n",
  'Favourite Tracks rate-limit constants'
);

replaceOnce(
  "      next = payload?.links?.next || null;\n      pages += 1;\n",
  "      next = payload?.links?.next || null;\n      pages += 1;\n      if (next) {\n        await new Promise(resolve =>\n          setTimeout(resolve, FAVOURITE_TRACKS_RELATIONSHIP_PAGE_DELAY_MS)\n        );\n      }\n",
  'Favourite Tracks relationship pagination advance'
);

fs.writeFileSync(path, source);
console.log('Updated tidal-user-auth-recon.js with conservative Favourite Tracks request pacing.');

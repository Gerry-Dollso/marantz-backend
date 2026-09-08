'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'server.js');
let source = fs.readFileSync(target, 'utf8');

const before = `  if (!cancelled && tidalQueueBuildIsCurrent(queueGeneration) && !queuedCount) {\n    throw new Error('No Favourite Tracks could be queued');\n  }\n\n  if (!cancelled && tidalQueueBuildIsCurrent(queueGeneration)) {`;

const after = `  if (cancelled || !tidalQueueBuildIsCurrent(queueGeneration)) {\n    console.log(\n      'TIDAL FAVOURITE TRACK BUILD CANCELLED:',\n      JSON.stringify({\n        queued: queuedCount,\n        skipped: skippedCount,\n        attempted: queueTracks.length,\n        shuffle\n      })\n    );\n  }\n\n  if (!cancelled && tidalQueueBuildIsCurrent(queueGeneration) && !queuedCount) {\n    throw new Error('No Favourite Tracks could be queued');\n  }\n\n  if (!cancelled && tidalQueueBuildIsCurrent(queueGeneration)) {`;

const first = source.indexOf(before);
if (first < 0) throw new Error('queue cancellation anchor not found');
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error('queue cancellation anchor is not unique');
}

source = source.slice(0, first) + after + source.slice(first + before.length);
fs.writeFileSync(target, source);
console.log('Restored Favourite Tracks queue cancellation logging.');

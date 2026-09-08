'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'server.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: anchor is not unique`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'queue-state function formatting',
  "async function getFavouriteTracksRollingQueueState(session) {  const nowPlaying = await heosBrowse(",
  "async function getFavouriteTracksRollingQueueState(session) {\n  const nowPlaying = await heosBrowse("
);

replaceOnce(
  'queue-state closing formatting',
  "  return { qid, mid, count, rows, tailStartQid, tailEndQid };}\nasync function reconcileFavouriteTracksRollingSession() {",
  "  return { qid, mid, count, rows, tailStartQid, tailEndQid };\n}\n\nasync function reconcileFavouriteTracksRollingSession() {"
);

fs.writeFileSync(target, source);
console.log('Applied guarded Favourite Tracks rolling formatting fix to server.js');

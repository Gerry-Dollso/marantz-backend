'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server.js');
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  }
  text = text.replace(before, after);
}

replaceOnce(
`let pendingTidalVoiceSearch = null;
let tidalVoiceSearchSequence = 0;
const voiceAliases = createVoiceAliasStore();`,
`let pendingTidalVoiceSearch = null;
let tidalVoiceSearchSequence = 0;
let tidalQueueGeneration = 0;
const voiceAliases = createVoiceAliasStore();

function supersedeTidalQueueBuild() {
  tidalQueueGeneration += 1;
  return tidalQueueGeneration;
}

function tidalQueueBuildIsCurrent(generation) {
  return generation === tidalQueueGeneration;
}`,
'queue generation state'
);

replaceOnce(
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play?')) {
    try {
      const url = new URL(req.url, 'http://localhost');`,
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play?')) {
    try {
      supersedeTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');`,
'album/track play cancellation'
);

replaceOnce(
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/track/action?')) {
    try {
      const url = new URL(req.url, 'http://localhost');`,
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/track/action?')) {
    try {
      supersedeTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');`,
'track action cancellation'
);

replaceOnce(
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/tracks/play-all?')) {
    try {
      const url = new URL(req.url, 'http://localhost');`,
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/tracks/play-all?')) {
    try {
      const queueGeneration = supersedeTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');`,
'favourite build generation'
);

replaceOnce(
`      for (const track of queueTracks) {
        const aid = queuedCount === 0 ? 4 : 3;
        try {`,
`      let cancelled = false;

      for (const track of queueTracks) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) {
          cancelled = true;
          break;
        }

        const aid = queuedCount === 0 ? 4 : 3;
        try {`,
'favourite loop cancellation check'
);

replaceOnce(
`        } catch (error) {
          skippedCount += 1;
          console.warn(`,
`        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) {
            cancelled = true;
            break;
          }

          skippedCount += 1;
          console.warn(`,
'favourite catch cancellation check'
);

replaceOnce(
`      if (!queuedCount) {
        throw new Error('No Favourite Tracks could be queued');
      }

      await heosBrowse(
        'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
        '&shuffle=off'
      );

      return sendJson(res, 200, {
        ok: true,
        queued: queuedCount,
        skipped: skippedCount,
        attempted: queueTracks.length,
        shuffle,
        firstMid,
        sourceCached: cachedResult.cached
      });`,
`      if (cancelled || !tidalQueueBuildIsCurrent(queueGeneration)) {
        console.log(
          'TIDAL FAVOURITE TRACK BUILD CANCELLED:',
          JSON.stringify({
            queued: queuedCount,
            skipped: skippedCount,
            attempted: queueTracks.length,
            shuffle
          })
        );

        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: queuedCount,
          skipped: skippedCount,
          attempted: queueTracks.length,
          shuffle,
          firstMid,
          sourceCached: cachedResult.cached
        });
      }

      if (!queuedCount) {
        throw new Error('No Favourite Tracks could be queued');
      }

      await heosBrowse(
        'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
        '&shuffle=off'
      );

      return sendJson(res, 200, {
        ok: true,
        cancelled: false,
        queued: queuedCount,
        skipped: skippedCount,
        attempted: queueTracks.length,
        shuffle,
        firstMid,
        sourceCached: cachedResult.cached
      });`,
'favourite cancelled response'
);

replaceOnce(
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {
    try {
      const url = new URL(req.url, 'http://localhost');`,
`  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {
    try {
      supersedeTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');`,
'playlist cancellation'
);

fs.writeFileSync(file, text);
console.log('Updated server.js with Favourite Tracks cancellation');

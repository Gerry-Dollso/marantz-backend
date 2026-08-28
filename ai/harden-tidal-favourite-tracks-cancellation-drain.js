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
`let tidalQueueGeneration = 0;
const voiceAliases = createVoiceAliasStore();
function supersedeTidalQueueBuild() {
  tidalQueueGeneration += 1;
  return tidalQueueGeneration;
}

function tidalQueueBuildIsCurrent(generation) {
  return generation === tidalQueueGeneration;
}`,
`let tidalQueueGeneration = 0;
let tidalFavouriteQueueCommand = null;
const voiceAliases = createVoiceAliasStore();
function supersedeTidalQueueBuild() {
  tidalQueueGeneration += 1;
  return tidalQueueGeneration;
}

function tidalQueueBuildIsCurrent(generation) {
  return generation === tidalQueueGeneration;
}

async function supersedeAndDrainTidalQueueBuild() {
  supersedeTidalQueueBuild();
  const pending = tidalFavouriteQueueCommand;
  if (!pending) return;
  try {
    await pending;
  } catch {
    // The cancelled Favourite Tracks loop owns/logs its HEOS failure.
  }
}`,
'queue command drain state'
);

for (const [label, route] of [
  ['album/track play drain', '/api/tidal/play?'],
  ['track action drain', '/api/tidal/track/action?'],
  ['playlist drain', '/api/tidal/playlist/play?']
]) {
  replaceOnce(
`  if (req.method === 'GET' && req.url.startsWith('${route}')) {
    try {
      supersedeTidalQueueBuild();`,
`  if (req.method === 'GET' && req.url.startsWith('${route}')) {
    try {
      await supersedeAndDrainTidalQueueBuild();`,
label
  );
}

replaceOnce(
`        try {
          await heosBrowse(
            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
            '&sid=10&cid=' + heosCid +
            '&mid=' + encodeURIComponent(track.mid) +
            '&aid=' + aid,
            15000
          );
          if (queuedCount === 0) firstMid = String(track.mid);
          queuedCount += 1;
        } catch (error) {`,
`        try {
          const queueCommand = heosBrowse(
            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
            '&sid=10&cid=' + heosCid +
            '&mid=' + encodeURIComponent(track.mid) +
            '&aid=' + aid,
            15000
          );
          tidalFavouriteQueueCommand = queueCommand;
          try {
            await queueCommand;
          } finally {
            if (tidalFavouriteQueueCommand === queueCommand) {
              tidalFavouriteQueueCommand = null;
            }
          }
          if (!tidalQueueBuildIsCurrent(queueGeneration)) {
            cancelled = true;
            break;
          }
          if (queuedCount === 0) firstMid = String(track.mid);
          queuedCount += 1;
        } catch (error) {`,
'favourite in-flight command tracking'
);

fs.writeFileSync(file, text);
console.log('Updated server.js with Favourite Tracks cancellation drain');

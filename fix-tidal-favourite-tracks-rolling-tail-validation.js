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
  'bounded queue state reader',
  `async function getFavouriteTracksRollingQueueState() {
  const nowPlaying = await heosBrowse(
    'heos://player/get_now_playing_media?pid=' + encodeURIComponent(PLAYER_ID),
    3000
  );
  const qid = Number(nowPlaying?.payload?.qid);
  const mid = String(nowPlaying?.payload?.mid || '');
  if (!Number.isInteger(qid) || qid < 1 || !mid) {
    throw new Error('HEOS did not return a usable Favourite Tracks now-playing qid/mid');
  }

  const queue = await heosBrowse(
    'heos://player/get_queue?pid=' + encodeURIComponent(PLAYER_ID) + '&range=0,999',
    5000
  );
  const rows = Array.isArray(queue.payload) ? queue.payload : [];
  const message = String(queue?.heos?.message || '');
  const countMatch = message.match(/(?:^|&)count=(\\d+)/);
  const count = countMatch ? Number(countMatch[1]) : rows.length;
  return { qid, mid, count, rows };
}`,
  `async function getFavouriteTracksRollingQueueState(session) {
  const nowPlaying = await heosBrowse(
    'heos://player/get_now_playing_media?pid=' + encodeURIComponent(PLAYER_ID),
    3000
  );
  const qid = Number(nowPlaying?.payload?.qid);
  const mid = String(nowPlaying?.payload?.mid || '');
  if (!Number.isInteger(qid) || qid < 1 || !mid) {
    throw new Error('HEOS did not return a usable Favourite Tracks now-playing qid/mid');
  }

  const queueCountResponse = await heosBrowse(
    'heos://player/get_queue?pid=' + encodeURIComponent(PLAYER_ID) + '&range=0,0',
    5000
  );
  const countMessage = String(queueCountResponse?.heos?.message || '');
  const countMatch = countMessage.match(/(?:^|&)count=(\\d+)/);
  if (!countMatch) throw new Error('HEOS did not return Favourite Tracks queue count');
  const count = Number(countMatch[1]);
  if (!Number.isInteger(count) || count < 1) throw new Error('HEOS returned invalid Favourite Tracks queue count');

  const tailSize = Math.min(FAVOURITE_TRACKS_ROLLING_BATCH, count);
  const tailStart = count - tailSize;
  const tailResponse = await heosBrowse(
    'heos://player/get_queue?pid=' + encodeURIComponent(PLAYER_ID) +
    '&range=' + tailStart + ',' + (count - 1),
    5000
  );
  const tailRows = Array.isArray(tailResponse.payload) ? tailResponse.payload : [];
  const expectedTail = session.tracks
    .slice(count - tailSize, count)
    .map(track => String(track.id || ''));
  const actualTail = tailRows.map(row => String(row.mid || ''));
  if (tailRows.length !== tailSize || expectedTail.length !== tailSize ||
      actualTail.some((tailMid, index) => tailMid !== expectedTail[index])) {
    throw new Error('Favourite Tracks queue tail does not match canonical rolling session');
  }

  return { qid, mid, count };
}`
);

replaceOnce(
  'bounded reconciliation',
  `    const state = await getFavouriteTracksRollingQueueState();
    if (!favouriteTracksRollingSession || favouriteTracksRollingSession !== session) return;

    const currentIndex = session.tracks.findIndex(track => String(track.id || '') === state.mid);
    if (currentIndex < 0) {
      stopFavouriteTracksRollingSession('now-playing-left-canonical-session');
      return;
    }

    const expectedQueued = session.tracks.slice(0, session.nextIndex).map(track => String(track.id || ''));
    const actualQueued = state.rows.slice(0, expectedQueued.length).map(row => String(row.mid || ''));
    if (state.count !== session.nextIndex || actualQueued.length !== expectedQueued.length ||
        actualQueued.some((mid, index) => mid !== expectedQueued[index])) {
      stopFavouriteTracksRollingSession('queue-changed-externally');
      return;
    }`,
  `    let state;
    try {
      state = await getFavouriteTracksRollingQueueState(session);
    } catch (error) {
      stopFavouriteTracksRollingSession('queue-changed-externally');
      console.warn('TIDAL FAVOURITE ROLLING QUEUE CHECK FAILED:', error.message);
      return;
    }
    if (!favouriteTracksRollingSession || favouriteTracksRollingSession !== session) return;

    const currentIndex = session.tracks.findIndex(track => String(track.id || '') === state.mid);
    if (currentIndex < 0) {
      stopFavouriteTracksRollingSession('now-playing-left-canonical-session');
      return;
    }
    if (state.count !== session.nextIndex) {
      stopFavouriteTracksRollingSession('queue-changed-externally');
      return;
    }`
);

fs.writeFileSync(target, source);
console.log('Applied guarded Favourite Tracks rolling tail validation fix to server.js');

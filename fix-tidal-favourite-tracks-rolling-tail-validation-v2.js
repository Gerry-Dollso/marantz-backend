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
  'rolling queue state reader',
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

  const tailSize = Math.min(
    FAVOURITE_TRACKS_ROLLING_INITIAL + FAVOURITE_TRACKS_ROLLING_BATCH,
    session.nextIndex
  );
  const tailStartQid = Math.max(1, session.nextIndex - tailSize + 1);
  const tailEndQid = session.nextIndex;
  const queue = await heosBrowse(
    'heos://player/get_queue?pid=' + encodeURIComponent(PLAYER_ID) +
    '&range=' + (tailStartQid - 1) + ',' + (tailEndQid - 1),
    5000
  );
  const rows = Array.isArray(queue.payload) ? queue.payload : [];
  const message = String(queue?.heos?.message || '');
  const countMatch = message.match(/(?:^|&)count=(\\d+)/);
  const count = countMatch ? Number(countMatch[1]) : null;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('HEOS did not return a usable Favourite Tracks queue count');
  }
  return { qid, mid, count, rows, tailStartQid, tailEndQid };
}`
);

replaceOnce(
  'rolling reconcile queue verification',
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
  `    const state = await getFavouriteTracksRollingQueueState(session);
    if (!favouriteTracksRollingSession || favouriteTracksRollingSession !== session) return;

    const currentIndex = session.tracks.findIndex(track => String(track.id || '') === state.mid);
    if (currentIndex < 0) {
      stopFavouriteTracksRollingSession('now-playing-left-canonical-session');
      return;
    }

    const expectedTailStartIndex = state.tailStartQid - 1;
    const expectedTail = session.tracks
      .slice(expectedTailStartIndex, session.nextIndex)
      .map(track => String(track.id || ''));
    const actualTail = state.rows.map(row => String(row.mid || ''));
    const actualQids = state.rows.map(row => Number(row.qid));
    const expectedQids = expectedTail.map((_, index) => state.tailStartQid + index);
    if (state.count !== session.nextIndex ||
        actualTail.length !== expectedTail.length ||
        actualTail.some((mid, index) => mid !== expectedTail[index]) ||
        actualQids.some((qid, index) => qid !== expectedQids[index])) {
      stopFavouriteTracksRollingSession('queue-changed-externally');
      return;
    }`
);

fs.writeFileSync(target, source);
console.log('Applied guarded Favourite Tracks rolling tail validation fix to server.js');

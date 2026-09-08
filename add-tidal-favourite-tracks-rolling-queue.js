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
  'rolling queue state',
  "let favouriteTracksValidationRefresh = null;\nconst FAVOURITE_TRACKS_VALIDATION_TTL_MS = 5 * 60 * 1000;",
  "let favouriteTracksValidationRefresh = null;\nlet favouriteTracksRollingSession = null;\nlet favouriteTracksRollingReconcileTimer = null;\nlet favouriteTracksRollingReconcilePromise = null;\nlet heosEventSocket = null;\nlet heosEventReconnectTimer = null;\nconst FAVOURITE_TRACKS_ROLLING_INITIAL = 10;\nconst FAVOURITE_TRACKS_ROLLING_LOW_WATER = 5;\nconst FAVOURITE_TRACKS_ROLLING_BATCH = 5;\nconst FAVOURITE_TRACKS_ROLLING_DEBOUNCE_MS = 750;\nconst FAVOURITE_TRACKS_VALIDATION_TTL_MS = 5 * 60 * 1000;"
);

const oldBuilderStart = "async function queueCanonicalFavouriteTracks({ tracks, shuffle = false, startIndex = 0 }) {";
const oldBuilderEnd = "\nfunction getHeosNowPlaying() {";
const start = source.indexOf(oldBuilderStart);
const end = source.indexOf(oldBuilderEnd, start);
if (start < 0 || end < 0) throw new Error('canonical builder anchors not found');
if (source.indexOf(oldBuilderStart, start + 1) >= 0) throw new Error('canonical builder anchor is not unique');

const rollingBuilder = String.raw`function stopFavouriteTracksRollingSession(reason = 'superseded') {
  const session = favouriteTracksRollingSession;
  favouriteTracksRollingSession = null;
  if (favouriteTracksRollingReconcileTimer) {
    clearTimeout(favouriteTracksRollingReconcileTimer);
    favouriteTracksRollingReconcileTimer = null;
  }
  if (session) {
    console.log('TIDAL FAVOURITE ROLLING SESSION STOPPED:', JSON.stringify({
      generation: session.generation,
      reason,
      queued: session.nextIndex,
      total: session.tracks.length
    }));
  }
}

async function addFavouriteTrackToQueue(track, aid, generation) {
  if (!tidalQueueBuildIsCurrent(generation)) return false;
  const mid = String(track?.id || '');
  if (!mid) throw new Error('Favourite Tracks contains a track without an id');
  const heosCid = encodeURIComponent('My Music-Tracks').replace(/%20/g, ' ');
  const queueCommand = heosBrowse(
    'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
    '&sid=10&cid=' + heosCid +
    '&mid=' + encodeURIComponent(mid) +
    '&aid=' + aid,
    15000
  );
  tidalFavouriteQueueCommand = queueCommand;
  try {
    await queueCommand;
  } finally {
    if (tidalFavouriteQueueCommand === queueCommand) tidalFavouriteQueueCommand = null;
  }
  return tidalQueueBuildIsCurrent(generation);
}

async function getFavouriteTracksRollingQueueState() {
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
  const countMatch = message.match(/(?:^|&)count=(\d+)/);
  const count = countMatch ? Number(countMatch[1]) : rows.length;
  return { qid, mid, count, rows };
}

async function reconcileFavouriteTracksRollingSession() {
  const session = favouriteTracksRollingSession;
  if (!session || !tidalQueueBuildIsCurrent(session.generation)) return;
  if (favouriteTracksRollingReconcilePromise) return favouriteTracksRollingReconcilePromise;

  const work = (async () => {
    const state = await getFavouriteTracksRollingQueueState();
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
    }

    const tracksAhead = state.count - state.qid;
    if (tracksAhead >= FAVOURITE_TRACKS_ROLLING_LOW_WATER || session.nextIndex >= session.tracks.length) return;

    const endIndex = Math.min(session.nextIndex + FAVOURITE_TRACKS_ROLLING_BATCH, session.tracks.length);
    while (session.nextIndex < endIndex) {
      const track = session.tracks[session.nextIndex];
      const ok = await addFavouriteTrackToQueue(track, 3, session.generation);
      if (!ok || favouriteTracksRollingSession !== session) return;
      session.nextIndex += 1;
    }

    console.log('TIDAL FAVOURITE ROLLING REPLENISHED:', JSON.stringify({
      generation: session.generation,
      qid: state.qid,
      previousCount: state.count,
      count: session.nextIndex,
      total: session.tracks.length
    }));
  })();

  favouriteTracksRollingReconcilePromise = work;
  try {
    await work;
  } catch (error) {
    stopFavouriteTracksRollingSession('reconcile-failed');
    console.error('TIDAL FAVOURITE ROLLING RECONCILE FAILED:', error.message);
  } finally {
    if (favouriteTracksRollingReconcilePromise === work) favouriteTracksRollingReconcilePromise = null;
  }
}

function scheduleFavouriteTracksRollingReconcile() {
  if (!favouriteTracksRollingSession || favouriteTracksRollingReconcileTimer) return;
  favouriteTracksRollingReconcileTimer = setTimeout(() => {
    favouriteTracksRollingReconcileTimer = null;
    reconcileFavouriteTracksRollingSession();
  }, FAVOURITE_TRACKS_ROLLING_DEBOUNCE_MS);
}

function startHeosEventConnection() {
  if (heosEventSocket || heosEventReconnectTimer) return;
  const socket = net.createConnection({ host: AVR_HOST, port: HEOS_PORT });
  heosEventSocket = socket;
  let buffer = '';

  const reconnect = () => {
    if (heosEventSocket === socket) heosEventSocket = null;
    if (!heosEventReconnectTimer) {
      heosEventReconnectTimer = setTimeout(() => {
        heosEventReconnectTimer = null;
        startHeosEventConnection();
      }, 2000);
    }
  };

  socket.on('connect', () => {
    socket.write('heos://system/register_for_change_events?enable=on\r\n');
  });
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    while (buffer.includes('\n')) {
      const i = buffer.indexOf('\n');
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      try {
        const response = JSON.parse(line);
        const command = String(response?.heos?.command || '');
        const message = String(response?.heos?.message || '');
        if (message.includes('pid=' + PLAYER_ID) &&
            (command === 'event/player_now_playing_changed' || command === 'event/player_queue_changed')) {
          scheduleFavouriteTracksRollingReconcile();
        }
      } catch {
        // Ignore malformed/non-JSON event traffic.
      }
    }
  });
  socket.on('error', () => socket.destroy());
  socket.on('close', reconnect);
}

async function queueCanonicalFavouriteTracks({ tracks, shuffle = false, startIndex = 0 }) {
  stopFavouriteTracksRollingSession('new-session');
  const generation = supersedeTidalQueueBuild();
  let queueTracks = tracks.slice(startIndex);
  if (!queueTracks.length) throw new Error('Favourite Tracks queue selection is empty');

  if (shuffle) {
    queueTracks = queueTracks.slice();
    for (let i = queueTracks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queueTracks[i], queueTracks[j]] = [queueTracks[j], queueTracks[i]];
    }
  }

  const initialCount = Math.min(FAVOURITE_TRACKS_ROLLING_INITIAL, queueTracks.length);
  let queued = 0;
  for (let index = 0; index < initialCount; index += 1) {
    const ok = await addFavouriteTrackToQueue(queueTracks[index], queued === 0 ? 4 : 3, generation);
    if (!ok) return { cancelled: true, queued, skipped: 0, attempted: initialCount, shuffle, firstMid: '' };
    queued += 1;
  }

  await heosBrowse(
    'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) + '&shuffle=off'
  );

  if (!tidalQueueBuildIsCurrent(generation)) {
    return { cancelled: true, queued, skipped: 0, attempted: initialCount, shuffle, firstMid: '' };
  }

  favouriteTracksRollingSession = {
    generation,
    tracks: queueTracks,
    nextIndex: queued,
    shuffle,
    startedAt: Date.now()
  };
  startHeosEventConnection();

  console.log('TIDAL FAVOURITE ROLLING SESSION STARTED:', JSON.stringify({
    generation,
    queued,
    total: queueTracks.length,
    shuffle
  }));

  return {
    cancelled: false,
    queued,
    skipped: 0,
    attempted: initialCount,
    shuffle,
    firstMid: String(queueTracks[0]?.id || ''),
    rolling: queueTracks.length > queued,
    total: queueTracks.length
  };
}
`;
source = source.slice(0, start) + rollingBuilder + source.slice(end);

fs.writeFileSync(target, source);
console.log('Applied guarded Favourite Tracks rolling queue migration to server.js');

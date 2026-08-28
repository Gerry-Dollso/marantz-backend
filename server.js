'use strict';

const http = require('http');
const net = require('net');
const { createTidalVoiceControl } = require('./tidal-voice');
const {
  createTidalArtistVoiceControl
} = require('./tidal-artist-voice');
const {
  createVoiceAliasStore
} = require('./voice-alias-store');
const { classifyIntent } = require('./ai/intent-classifier');
const { executeIntent } = require('./ai/intent-action-router');
const {
  createTidalLiveAdapter
} = require('./ai/tidal-live-adapter');
const {
  createTidalUserAuthRecon
} = require('./tidal-user-auth-recon');
const {
  createTidalMetadataClient
} = require('./tidal-metadata-client');
const {
  createTidalBrowseCache
} = require('./tidal-browse-cache');
const {
  createTidalHeosResolver
} = require('./tidal-heos-resolver');

const AVR_HOST = '192.168.50.220';
const AVR_PORT = 23;
const HEOS_PORT = 1255;
const PLAYER_ID = '48723103';
const HTTP_PORT = 3100;
const AI_FALLBACK_ENABLED = process.env.MARANTZ_AI_FALLBACK === '1';
const tidalMetadata = createTidalMetadataClient({ countryCode: 'GB' });
const tidalBrowseCache = createTidalBrowseCache({ maxEntries: 64 });

const tidalUserAuthRecon = createTidalUserAuthRecon({
  countryCode: 'GB'
});
const tidalHeosResolver = createTidalHeosResolver({
  heosBrowse,
  sid: '10'
});
let pendingTidalVoiceSearch = null;
let tidalVoiceSearchSequence = 0;
let tidalQueueGeneration = 0;
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
}

function sendCommand(port, command, matcher, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: AVR_HOST, port });
    let buffer = '';
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    }

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`${command}${port === AVR_PORT ? '\r' : '\r\n'}`);
    });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      for (const rawLine of buffer.split(/\r\n|\r|\n/)) {
        const line = rawLine.trim();
        if (line && matcher(line)) {
          finish(null, line);
          return;
        }
      }
    });
    socket.on('timeout', () => finish(new Error(`Timeout: ${command}`)));
    socket.on('error', finish);
  });
}

function avr(command, prefix) {
  return sendCommand(
    AVR_PORT,
    command,
    line => prefix === 'MV' ? /^MV\d{2,3}$/.test(line) : line.startsWith(prefix)
  );
}

async function heosStart(command, timeoutMs = 1000) {
  const expectedCommand = command
    .replace(/^heos:\/\//, '')
    .split('?')[0];

  const line = await sendCommand(
    HEOS_PORT,
    command,
    raw => {
      try {
        const response = JSON.parse(raw);
        return (
          response.heos &&
          response.heos.command === expectedCommand
        );
      } catch {
        return false;
      }
    },
    timeoutMs
  );

  const response = JSON.parse(line);

  if (response.heos.result === 'fail') {
    throw new Error(
      response.heos.message || 'HEOS command failed'
    );
  }

  return response;
}

function heosBrowse(command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: AVR_HOST, port: HEOS_PORT });
    let buffer = '';
    let finished = false;

    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write(command + '\r\n'));
    socket.on('data', data => {
      buffer += data.toString('utf8');
      while (buffer.includes('\n')) {
        const i = buffer.indexOf('\n');
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;

        try {
          const response = JSON.parse(line);
          if (!response.heos) continue;
          if (response.heos.result === 'fail') {
            finish(new Error(response.heos.message || 'HEOS browse failed'));
            return;
          }
          if (Array.isArray(response.payload)) {
            finish(null, response);
            return;
          }
          const message = response.heos.message || '';
          if (!message.includes('command under process')) {
            finish(null, response);
            return;
          }
        } catch {
          // Ignore non-JSON HEOS traffic.
        }
      }
    });
    socket.on('timeout', () => finish(new Error(`HEOS browse timeout: ${command}`)));
    socket.on('error', finish);
    socket.on('close', () => {
      if (!finished) finish(new Error('HEOS connection closed'));
    });
  });
}

function getHeosNowPlaying() {
  return heosBrowse(
    `heos://player/get_now_playing_media?pid=${PLAYER_ID}`,
    3000
  );
}

async function getStatus() {
  const [power, input, volume, mute, heos] = await Promise.all([
    avr('ZM?', 'ZM'),
    avr('SI?', 'SI'),
    avr('MV?', 'MV'),
    avr('MU?', 'MU'),
    getHeosNowPlaying()
  ]);

  return { avr: { power, input, volume, mute }, heos };
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function parseReceiverVolume(line) {
  if (!line || !line.startsWith('MV')) return null;

  const value = line.slice(2);
  if (!/^\d{2,3}$/.test(value)) return null;

  const receiverValue =
    value.length === 3 ? Number(value) / 10 : Number(value);

  return receiverValue - 80;
}

function normaliseVolume(value) {
  if (value === null || value === undefined || value === '') {
    throw new Error('Missing receiver volume');
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error('Invalid receiver volume');
  }

  return Math.min(
    18,
    Math.max(-80, Math.round(numeric * 2) / 2)
  );
}

function marantzVolumeCommand(value) {
  const volume = normaliseVolume(value);
  const receiverValue = volume + 80;

  const encoded = Number.isInteger(receiverValue)
    ? String(receiverValue).padStart(2, '0')
    : String(Math.round(receiverValue * 10)).padStart(3, '0');

  return `MV${encoded}`;
}

async function avrSet(command, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: AVR_HOST,
      port: AVR_PORT
    });

    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    }

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(`${command}\r`);
      setTimeout(() => finish(null, { ok: true }), 180);
    });

    socket.on('timeout', () => finish(null, { ok: true }));
    socket.on('error', finish);
  });
}

async function setReceiverVolume(value) {
  const target = normaliseVolume(value);

  await avrSet(marantzVolumeCommand(target));

  const deadline = Date.now() + 1600;

  while (Date.now() < deadline) {
    try {
      const response = await avr('MV?', 'MV', 700);
      const actual = parseReceiverVolume(response);

      if (
        actual !== null &&
        Math.abs(actual - target) < 0.25
      ) {
        return actual;
      }
    } catch {
      // Retry briefly while the receiver applies the command.
    }

    await sleep(80);
  }

  throw new Error(`Receiver did not reach ${target} dB`);
}

async function semanticVolumeControl(action, value = null) {
  if (action === 'set') {
    const volume = await setReceiverVolume(value);
    return { ok: true, volume };
  }

  if (action !== 'up' && action !== 'down') {
    throw new Error('Unknown volume action');
  }

  const response = await avr('MV?', 'MV', 700);
  const current = parseReceiverVolume(response);

  if (current === null) {
    throw new Error('Could not read receiver volume');
  }

  const step = action === 'up' ? 0.5 : -0.5;
  const volume = await setReceiverVolume(current + step);

  return {
    ok: true,
    volume
  };
}

async function semanticSourceControl(source) {
  const commands = {
    phono: 'MSSMART1',
    cd: 'MSSMART2',
    heos: 'MSSMART3',
    tidal: 'MSSMART3',
    tv: 'MSSMART4',
    aux: 'SIAUX1'
  };

  const command = commands[source];

  if (!command) {
    throw new Error('Unknown source');
  }

  await avrSet(command);

  if (source === 'aux') {
    await sleep(300);
    await avrSet('SPPR 1');

    const preset = await avr('SPPR?', 'SPPR');

    if (preset !== 'SPPR 1') {
      throw new Error('Receiver did not confirm Speaker Preset 1');
    }
  }

  return {
    ok: true,
    source
  };
}

async function semanticPowerControl(state) {
  const commands = {
    on: 'ZMON',
    standby: 'ZMOFF'
  };

  const command = commands[state];

  if (!command) {
    throw new Error('Unknown power state');
  }

  await avrSet(command);

  return {
    ok: true,
    state
  };
}

async function semanticMuteControl(state) {
  let targetState = state;

  if (state === 'toggle') {
    const response = await avr('MU?', 'MU');
    targetState = response === 'MUON' ? 'off' : 'on';
  }

  if (targetState !== 'on' && targetState !== 'off') {
    throw new Error('Unknown mute state');
  }

  const targetMuted = targetState === 'on';
  await avrSet(targetMuted ? 'MUON' : 'MUOFF');

  const deadline = Date.now() + 1600;

  while (Date.now() < deadline) {
    try {
      const response = await avr('MU?', 'MU', 700);

      if (
        (targetMuted && response === 'MUON') ||
        (!targetMuted && response === 'MUOFF')
      ) {
        return {
          ok: true,
          muted: targetMuted
        };
      }
    } catch {
      // Retry briefly while the receiver applies the command.
    }

    await sleep(80);
  }

  throw new Error(
    `Receiver did not confirm mute ${targetMuted ? 'on' : 'off'}`
  );
}

async function semanticTransportControl(action) {
  const pid = encodeURIComponent(PLAYER_ID);

  async function getPlayState() {
    const response = await heosBrowse(
      `heos://player/get_play_state?pid=${pid}`
    );

    const message = String(response?.heos?.message || '');
    const match = message.match(/(?:^|&)state=([^&]+)/);

    return match ? decodeURIComponent(match[1]) : '';
  }

  async function getCurrentQid() {
    const response = await heosBrowse(
      `heos://player/get_now_playing_media?pid=${pid}`
    );

    const qid = response?.payload?.qid;
    return qid === undefined || qid === null ? null : Number(qid);
  }

  if (action === 'play' || action === 'pause') {
    const targetState = action;

    await heosBrowse(
      `heos://player/set_play_state?pid=${pid}&state=${targetState}`
    );

    const deadline = Date.now() + 1600;

    while (Date.now() < deadline) {
      try {
        const state = await getPlayState();

        if (state === targetState) {
          return {
            ok: true,
            action,
            state
          };
        }
      } catch {
        // Retry briefly while HEOS applies the command.
      }

      await sleep(80);
    }

    throw new Error(`HEOS did not confirm ${targetState}`);
  }

  if (action === 'next') {
    const beforeQid = await getCurrentQid();

    await heosBrowse(
      `heos://player/play_next?pid=${pid}`
    );

    const deadline = Date.now() + 2000;

    while (Date.now() < deadline) {
      try {
        const afterQid = await getCurrentQid();

        if (
          afterQid !== null &&
          (beforeQid === null || afterQid !== beforeQid)
        ) {
          return {
            ok: true,
            action,
            qid: afterQid
          };
        }
      } catch {
        // Retry briefly while HEOS changes queue position.
      }

      await sleep(100);
    }

    throw new Error('HEOS did not confirm next');
  }

  if (action === 'previous') {
    const response = await heosBrowse(
      `heos://player/play_previous?pid=${pid}`
    );

    if (response?.heos?.result === 'fail') {
      throw new Error(
        response?.heos?.message || 'HEOS previous failed'
      );
    }

    return {
      ok: true,
      action
    };
  }

  throw new Error('Unknown transport action');
}

const playTidalAlbumByArtist = createTidalVoiceControl({
  heosBrowse,
  playerId: PLAYER_ID,
  selectTidalSource: () => semanticSourceControl('tidal'),
  resolveLearnedTitle: (artist, title) =>
    voiceAliases.getTitle(artist, title)
});

const playTidalArtist = createTidalArtistVoiceControl({
  heosBrowse,
  heosStart,
  playerId: PLAYER_ID,
  selectTidalSource: () => semanticSourceControl('tidal'),
  resolveLearnedArtist: artist => voiceAliases.getArtist(artist)
});

function setPendingTidalVoiceSearch(details) {
  pendingTidalVoiceSearch = {
    id: ++tidalVoiceSearchSequence,
    ...details,
    createdAt: Date.now()
  };

  return {
    ok: false,
    action: 'search-required',
    ...pendingTidalVoiceSearch
  };
}

const handleTidalSemanticCommand = createTidalLiveAdapter({
  playArtist: playTidalArtist,
  playTitle: (title, artist, requestedType) =>
    playTidalAlbumByArtist(title, artist, requestedType),
  setPendingSearch: setPendingTidalVoiceSearch
});

async function semanticCommandControl(command) {
  const text = String(command || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+/g, '')
    .replace(/\s+/g, ' ');

  if (!text) {
    throw new Error('Missing command');
  }

  const powerOnPhrases = new Set([
    'power on',
    'turn on',
    'turn it on',
    'turn the marantz on',
    'marantz on'
  ]);

  const powerOffPhrases = new Set([
    'power off',
    'turn off',
    'turn it off',
    'standby',
    'go to standby',
    'turn the marantz off',
    'marantz off'
  ]);

  if (powerOnPhrases.has(text)) {
    return semanticPowerControl('on');
  }

  if (powerOffPhrases.has(text)) {
    return semanticPowerControl('standby');
  }

  if (
    text === 'mute' ||
    text === 'mute it' ||
    text === 'mute the marantz'
  ) {
    return semanticMuteControl('on');
  }

  if (
    text === 'unmute' ||
    text === 'un mute' ||
    text === 'on mute' ||
    text === 'unmute it' ||
    text === 'unmute the marantz'
  ) {
    return semanticMuteControl('off');
  }

  if (text === 'toggle mute') {
    return semanticMuteControl('toggle');
  }

  const volumeUpPhrases = new Set([
    'volume up',
    'turn it up',
    'turn volume up',
    'turn the volume up',
    'turn up the volume',
    'raise volume',
    'raise the volume',
    'increase volume',
    'increase the volume'
  ]);

  const volumeDownPhrases = new Set([
    'volume down',
    'turn it down',
    'turn volume down',
    'turn the volume down',
    'turn down the volume',
    'lower volume',
    'lower the volume',
    'decrease volume',
    'decrease the volume'
  ]);

  if (volumeUpPhrases.has(text)) {
    return semanticVolumeControl('up');
  }

  if (volumeDownPhrases.has(text)) {
    return semanticVolumeControl('down');
  }

  const volumeMatch = text.match(
    /^(?:set )?(?:the )?volume(?: to)? (-?\d+(?:\.5)?)$/
  );

  if (volumeMatch) {
    return semanticVolumeControl('set', volumeMatch[1]);
  }

  const sourceMatch = text.match(
    /^(?:(?:switch|change) to |select |(?:set )?(?:the )?source to |source )?(phono|funnel|fono|phone oh|cd|heos|tidal|tv|aux)$/
  );

  if (sourceMatch) {
    const sourceAliases = {
      funnel: 'phono',
      fono: 'phono',
      'phone oh': 'phono'
    };

    const source = sourceAliases[sourceMatch[1]] || sourceMatch[1];
    return semanticSourceControl(source);
  }

  const tidalSemantic = await handleTidalSemanticCommand(text);

  if (tidalSemantic.handled) {
    return tidalSemantic.result;
  }

  const transportPhrases = {
    play: 'play',
    'play music': 'play',
    resume: 'play',
    'resume music': 'play',
    pause: 'pause',
    'pause music': 'pause',
    next: 'next',
    'next track': 'next',
    'skip track': 'next',
    'skip this track': 'next',
    previous: 'previous',
    'previous track': 'previous'
  };

  if (transportPhrases[text]) {
    return semanticTransportControl(transportPhrases[text]);
  }

  throw new Error('Unknown command');
}

async function semanticCommandControlWithAi(command) {
  try {
    return await semanticCommandControl(command);
  } catch (error) {
    if (String(error.message || '') !== 'Unknown command') {
      throw error;
    }
  }

  if (!AI_FALLBACK_ENABLED) {
    throw new Error('Unknown command');
  }

  let classification;
  try {
    classification = await classifyIntent(command);
  } catch (error) {
    console.error('AI CLASSIFIER FAILED:', error.message);
    throw new Error('Unknown command');
  }

  if (!classification || classification.intent === 'unknown') {
    throw new Error('Unknown command');
  }

  const execution = await executeIntent(classification.intent, {
    power: semanticPowerControl,
    volume: semanticVolumeControl,
    mute: semanticMuteControl,
    source: semanticSourceControl,
    transport: semanticTransportControl
  });

  if (!execution.executed) {
    throw new Error('Unknown command');
  }

  return {
    ...execution.result,
    ai: true,
    intent: classification.intent
  };
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode);
  res.end(JSON.stringify(value));
}

function mapBrowseItem(item) {
  return {
    name: item.name || '',
    cid: item.cid || '',
    mid: item.mid || '',
    type: item.type || '',
    container: item.container === 'yes',
    playable: item.playable === 'yes',
    artist: item.artist || '',
    albumId: item.album_id || '',
    imageUrl: item.image_url || ''
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/api/status') {
    try {
      sendJson(res, 200, await getStatus());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (
    req.method === 'GET' &&
    req.url.startsWith('/api/tidal/voice-search')
  ) {
    const url = new URL(req.url, 'http://localhost');
    const after = Number(url.searchParams.get('after') || 0);

    const request =
      pendingTidalVoiceSearch &&
      pendingTidalVoiceSearch.id > after
        ? pendingTidalVoiceSearch
        : null;

    return sendJson(res, 200, {
      ok: true,
      pending: Boolean(request),
      request
    });
  }

  if (
    req.method === 'POST' &&
    req.url.startsWith('/api/tidal/voice-learn')
  ) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const requestId = Number(url.searchParams.get('id') || 0);
      const selectedName =
        String(url.searchParams.get('name') || '').trim();
      const selectedCid =
        String(url.searchParams.get('cid') || '').trim();
      const selectedType =
        String(url.searchParams.get('type') || '').trim();
      const selectedMid =
        String(url.searchParams.get('mid') || '').trim();

      if (
        !pendingTidalVoiceSearch ||
        requestId !== pendingTidalVoiceSearch.id
      ) {
        return sendJson(res, 409, {
          error: 'Voice search request is no longer pending'
        });
      }

      if (
        Date.now() - pendingTidalVoiceSearch.createdAt >
        10 * 60 * 1000
      ) {
        pendingTidalVoiceSearch = null;
        return sendJson(res, 410, {
          error: 'Voice search request expired'
        });
      }

      let learned;
      let learnedType;

      if (pendingTidalVoiceSearch.type === 'title') {
        if (!['album', 'track'].includes(selectedType)) {
          return sendJson(res, 400, {
            error: 'Title learning requires album or track type'
          });
        }

        if (selectedType === 'track' && !selectedMid) {
          return sendJson(res, 400, {
            error: 'Track learning requires mid'
          });
        }

        learned = voiceAliases.learnTitle(
          pendingTidalVoiceSearch.artist,
          pendingTidalVoiceSearch.requestedTitle,
          selectedType,
          selectedName,
          selectedCid,
          selectedMid
        );
        learnedType = selectedType;
      } else {
        learned = voiceAliases.learnArtist(
          pendingTidalVoiceSearch.query,
          selectedName,
          selectedCid
        );
        learnedType = 'artist';
      }

      pendingTidalVoiceSearch = null;

      console.log(
        'VOICE ALIAS LEARNED:',
        JSON.stringify(learned)
      );

      return sendJson(res, 200, {
        ok: true,
        type: learnedType,
        learned
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (await tidalUserAuthRecon.handle(req, res)) return;

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/personalised/playlist/play?')) {
    const queueGeneration = supersedeTidalQueueBuild();
    try {
      const pending = tidalFavouriteQueueCommand;
      if (pending) {
        try {
          await pending;
        } catch {
          // The superseded queue build owns/logs its HEOS failure.
        }
      }

      if (!tidalQueueBuildIsCurrent(queueGeneration)) {
        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: 0,
          skipped: 0
        });
      }

      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      const shuffleValue = String(url.searchParams.get('shuffle') || '0').trim();

      if (!/^[a-zA-Z0-9]+$/.test(id)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid playlist id' });
      }
      if (shuffleValue !== '0' && shuffleValue !== '1') {
        return sendJson(res, 400, { ok: false, error: 'Invalid shuffle value' });
      }

      const shuffle = shuffleValue === '1';
      const personalised = await tidalUserAuthRecon.getPersonalisedPlaylist(id);
      const sourceTracks = Array.isArray(personalised.tracks)
        ? personalised.tracks
        : [];

      if (!sourceTracks.length) {
        return sendJson(res, 409, {
          ok: false,
          error: 'Personalised playlist contains no tracks'
        });
      }

      const queueTracks = sourceTracks.slice();
      if (shuffle) {
        for (let i = queueTracks.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queueTracks[i], queueTracks[j]] = [queueTracks[j], queueTracks[i]];
        }
      }

      const resolvedTracks = [];
      for (let index = 0; index < queueTracks.length; index += 1) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) {
          return sendJson(res, 200, {
            ok: true,
            cancelled: true,
            queued: 0,
            skipped: 0,
            resolved: resolvedTracks.length,
            attempted: queueTracks.length,
            shuffle
          });
        }

        const track = queueTracks[index];
        const target = {
          officialTrackId: String(track.id || ''),
          title: String(track.title || ''),
          artistId: String(track.artistId || ''),
          artist: String(track.artist || ''),
          albumId: String(track.albumId || ''),
          album: String(track.album || ''),
          isrc: String(track.isrc || ''),
          duration: String(track.duration || '')
        };
        const resolution = await tidalHeosResolver.resolveTrack(target);

        if (
          resolution.status !== 'resolved' ||
          !resolution.cid ||
          !resolution.mid
        ) {
          return sendJson(res, 409, {
            ok: false,
            error: 'Playlist track could not be resolved safely for HEOS playback',
            playlist: personalised.playlist,
            index,
            track: target,
            resolution
          });
        }

        resolvedTracks.push({ track: target, resolution });
      }

      if (!tidalQueueBuildIsCurrent(queueGeneration)) {
        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: 0,
          skipped: 0,
          resolved: resolvedTracks.length,
          attempted: resolvedTracks.length,
          shuffle
        });
      }

      let queuedCount = 0;
      let skippedCount = 0;
      let firstMid = '';

      for (const item of resolvedTracks) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) break;

        const aid = queuedCount === 0 ? 4 : 3;
        try {
          const queueCommand = heosBrowse(
            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
            '&sid=10&cid=' + encodeURIComponent(item.resolution.cid) +
            '&mid=' + encodeURIComponent(item.resolution.mid) +
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

          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          if (queuedCount === 0) firstMid = String(item.resolution.mid);
          queuedCount += 1;
        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          console.warn(
            'TIDAL RESOLVED PLAYLIST TRACK SKIP:',
            JSON.stringify({
              officialTrackId: item.track.officialTrackId,
              title: item.track.title,
              artist: item.track.artist,
              cid: item.resolution.cid,
              mid: item.resolution.mid,
              error: error.message
            })
          );
        }
      }

      const cancelled = !tidalQueueBuildIsCurrent(queueGeneration);
      if (!queuedCount && !cancelled) {
        throw new Error('No resolved playlist tracks could be queued');
      }

      if (!cancelled) {
        await heosBrowse(
          'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
          '&shuffle=off'
        );
      }

      return sendJson(res, 200, {
        ok: true,
        cancelled,
        playlist: personalised.playlist,
        queued: queuedCount,
        skipped: skippedCount,
        resolved: resolvedTracks.length,
        attempted: resolvedTracks.length,
        shuffle,
        firstMid,
        sourceCached: Boolean(personalised.cached)
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/resolve-track?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      if (!/^\d+$/.test(id)) {
        return sendJson(res, 400, { error: 'Track id must contain digits only' });
      }

      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);
      const track = tidalHeosResolver.extractOfficialTrack(metadata);
      const resolution = await tidalHeosResolver.resolveTrack(track);
      return sendJson(res, 200, {
        ok: true,
        track,
        resolution
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play-resolved?')) {
    try {
      await supersedeAndDrainTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      if (!/^\d+$/.test(id)) {
        return sendJson(res, 400, { error: 'Track id must contain digits only' });
      }

      const metadata = await tidalUserAuthRecon.getTrackMetadata(id);
      const track = tidalHeosResolver.extractOfficialTrack(metadata);
      const resolution = await tidalHeosResolver.resolveTrack(track);

      if (resolution.status !== 'resolved' || !resolution.cid || !resolution.mid) {
        return sendJson(res, 409, {
          ok: false,
          track,
          resolution,
          error: 'Track could not be resolved safely for HEOS playback'
        });
      }

      const action = String(
        url.searchParams.get('action') || 'play-only'
      ).trim();
      const aidByAction = {
        'play-now': 1,
        'play-next': 2,
        'add-end': 3,
        'play-only': 4
      };
      const aid = aidByAction[action];
      if (!aid) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Invalid resolved track action'
        });
      }

      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(resolution.cid) +
        '&mid=' + encodeURIComponent(resolution.mid) +
        '&aid=' + aid
      );

      return sendJson(res, 200, {
        ok: true,
        action,
        track,
        resolution
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      if (!cid || !cid.trim()) return sendJson(res, 400, { error: 'Missing cid' });

      const cleanCid = cid.trim();
      const heosCid = encodeURIComponent(cleanCid).replace(/%20/g, ' ');
      const hasPage = url.searchParams.has('start') || url.searchParams.has('limit');
      const pageStart = hasPage
        ? Math.max(0, Number(url.searchParams.get('start')) || 0)
        : null;
      const pageLimit = hasPage
        ? Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
        : null;
      const cacheKey = hasPage
        ? cleanCid + '|page|' + pageStart + '|' + pageLimit
        : cleanCid + '|all';

      const highValueLibrary = new Set([
        'My Music',
        'My Music-Artists',
        'My Music-Albums',
        'My Music-Tracks',
        'My Music-Playlists'
      ]).has(cleanCid);
      const policy = highValueLibrary
        ? { refreshAfterMs: 15000, maxStaleMs: 12 * 60 * 60 * 1000 }
        : { refreshAfterMs: 2 * 60 * 1000, maxStaleMs: 2 * 60 * 60 * 1000 };

      const loader = async () => {
        if (hasPage) {
          const pageEnd = pageStart + pageLimit - 1;
          const response = await heosBrowse(
            'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + pageStart + ',' + pageEnd
          );
          const message = response.heos?.message || '';
          const countMatch = message.match(/(?:^|&)count=(\d+)/);
          const total = countMatch ? Number(countMatch[1]) : null;
          return {
            items: (response.payload || []).map(mapBrowseItem),
            count: total,
            start: pageStart,
            limit: pageLimit
          };
        }

        const pageSize = 50;
        const allItems = [];
        let browseStart = 0;
        let total = null;
        while (total === null || browseStart < total) {
          const response = await heosBrowse(
            'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + browseStart + ',' + (browseStart + pageSize - 1)
          );
          const payload = Array.isArray(response.payload) ? response.payload : [];
          allItems.push(...payload);
          const message = response.heos?.message || '';
          const countMatch = message.match(/(?:^|&)count=(\d+)/);
          if (countMatch) total = Number(countMatch[1]);
          if (!payload.length) break;
          browseStart += payload.length;
          if (total === null && payload.length < pageSize) break;
        }

        return {
          items: allItems.map(mapBrowseItem),
          count: allItems.length
        };
      };

      const cachedResult = await tidalBrowseCache.get(cacheKey, loader, policy);
      return sendJson(res, 200, {
        ok: true,
        ...cachedResult.value,
        cached: cachedResult.cached,
        cacheAgeMs: cachedResult.cacheAgeMs,
        refreshing: cachedResult.refreshing,
        ...(cachedResult.refreshError
          ? { cacheRefreshError: cachedResult.refreshError }
          : {})
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/search?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('q');
      if (!query || !query.trim()) return sendJson(res, 400, { error: 'Missing search query' });
      const response = await heosBrowse(
        'heos://browse/search?sid=10&scid=1&search=' + encodeURIComponent(query.trim())
      );
      return sendJson(res, 200, {
        ok: true,
        artists: (response.payload || []).map(item => ({
          name: item.name,
          cid: item.cid,
          imageUrl: item.image_url || ''
        }))
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist/albums?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      if (!cid || !cid.trim()) return sendJson(res, 400, { error: 'Missing artist cid' });
      const artistId = cid.trim().replace('LIBARTIST-', '');
      const response = await heosBrowse(
        'heos://browse/browse?sid=10&cid=' + encodeURIComponent(`LIBARTIST-Albums-${artistId}`)
      );
      return sendJson(res, 200, {
        ok: true,
        albums: (response.payload || []).map(item => ({
          name: item.name,
          artist: item.artist || '',
          cid: item.cid,
          playable: item.playable === 'yes',
          imageUrl: item.image_url || ''
        }))
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/album/tracks?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      if (!cid || !cid.trim()) return sendJson(res, 400, { error: 'Missing album cid' });
      const response = await heosBrowse(
        'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid.trim())
      );
      return sendJson(res, 200, {
        ok: true,
        tracks: (response.payload || []).map(item => ({
          name: item.name,
          artist: item.artist || '',
          album: item.album || '',
          albumId: item.album_id || '',
          mid: item.mid,
          playable: item.playable === 'yes',
          imageUrl: item.image_url || ''
        }))
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play?')) {
    try {
      await supersedeAndDrainTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      const selectedMid = url.searchParams.get('mid');
      if (!cid || !selectedMid) return sendJson(res, 400, { error: 'Missing cid or mid' });

      const albumResponse = await heosBrowse(
        'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid)
      );
      const tracks = (albumResponse.payload || []).filter(item => item.playable === 'yes' && item.mid);
      if (!tracks.length) throw new Error('Album has no playable tracks');

      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(cid) +
        '&mid=' + encodeURIComponent(tracks[0].mid) + '&aid=4'
      );
      for (const track of tracks.slice(1)) {
        await heosBrowse(
          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
          '&sid=10&cid=' + encodeURIComponent(cid) +
          '&mid=' + encodeURIComponent(track.mid) + '&aid=3'
        );
      }

      if (String(selectedMid) !== String(tracks[0].mid)) {
        const queueResponse = await heosBrowse(
          'heos://player/get_queue?pid=' + encodeURIComponent(PLAYER_ID) + '&range=0,100'
        );
        const selectedItem = (queueResponse.payload || []).find(
          item => String(item.mid) === String(selectedMid)
        );
        if (!selectedItem || selectedItem.qid === undefined) {
          throw new Error('Selected track not found in HEOS queue');
        }
        await heosBrowse(
          'heos://player/play_queue?pid=' + encodeURIComponent(PLAYER_ID) +
          '&qid=' + encodeURIComponent(selectedItem.qid)
        );
      }

      return sendJson(res, 200, {
        ok: true,
        queued: tracks.length,
        selectedMid: String(selectedMid)
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/metadata/track-artists?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const mid = String(url.searchParams.get('mid') || '').trim();
      if (!mid) {
        return sendJson(res, 400, { error: 'Missing track mid' });
      }

      const result = await tidalMetadata.getTrackArtists(mid);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 502, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/track/action?')) {
    try {
      await supersedeAndDrainTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const cid = String(url.searchParams.get('cid') || '').trim();
      const mid = String(url.searchParams.get('mid') || '').trim();
      const action = String(url.searchParams.get('action') || '').trim();

      if (!cid || !mid) {
        return sendJson(res, 400, { error: 'Missing cid or mid' });
      }

      const aidByAction = {
        'play-now': 1,
        'play-next': 2,
        'add-end': 3,
        'play-only': 4
      };

      if (action === 'play-from-here') {
        const pageSize = 50;
        const tracks = [];
        let start = 0;
        let total = null;

        while (total === null || start < total) {
          const response = await heosBrowse(
            'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid) +
            '&range=' + start + ',' + (start + pageSize - 1)
          );
          const payload = Array.isArray(response.payload)
            ? response.payload
            : [];
          tracks.push(...payload.filter(
            item => item.playable === 'yes' && item.mid
          ));

          const message = response.heos?.message || '';
          const countMatch = message.match(/(?:^|&)count=(\d+)/);
          if (countMatch) total = Number(countMatch[1]);
          if (!payload.length) break;
          start += payload.length;
          if (total === null && payload.length < pageSize) break;
        }

        const startIndex = tracks.findIndex(
          item => String(item.mid) === mid
        );

        if (startIndex < 0) {
          return sendJson(res, 404, {
            error: 'Selected track not found in container'
          });
        }

        const remaining = tracks.slice(startIndex);

        await heosBrowse(
          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
          '&sid=10&cid=' + encodeURIComponent(cid) +
          '&mid=' + encodeURIComponent(remaining[0].mid) +
          '&aid=4'
        );

        for (const track of remaining.slice(1)) {
          await heosBrowse(
            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
            '&sid=10&cid=' + encodeURIComponent(cid) +
            '&mid=' + encodeURIComponent(track.mid) +
            '&aid=3'
          );
        }

        return sendJson(res, 200, {
          ok: true,
          action,
          queued: remaining.length,
          selectedMid: mid
        });
      }

      const aid = aidByAction[action];
      if (!aid) {
        return sendJson(res, 400, { error: 'Unknown track action' });
      }

      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(cid) +
        '&mid=' + encodeURIComponent(mid) +
        '&aid=' + aid
      );

      return sendJson(res, 200, {
        ok: true,
        action,
        selectedMid: mid
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/tracks/play-all?')) {
    try {
      const queueGeneration = supersedeTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const shuffle = url.searchParams.get('shuffle') === '1';
      const cid = 'My Music-Tracks';
      const cacheKey = cid + '|all';
      const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');

      const cachedResult = await tidalBrowseCache.get(
        cacheKey,
        async () => {
          const pageSize = 50;
          const allItems = [];
          let start = 0;
          let total = null;

          while (total === null || start < total) {
            const response = await heosBrowse(
              'heos://browse/browse?sid=10&cid=' + heosCid +
              '&range=' + start + ',' + (start + pageSize - 1)
            );
            const payload = Array.isArray(response.payload) ? response.payload : [];
            allItems.push(...payload);
            const message = response.heos?.message || '';
            const countMatch = message.match(/(?:^|&)count=(\d+)/);
            if (countMatch) total = Number(countMatch[1]);
            if (!payload.length) break;
            start += payload.length;
            if (total === null && payload.length < pageSize) break;
          }

          return {
            items: allItems.map(mapBrowseItem),
            count: allItems.length
          };
        },
        { refreshAfterMs: 15000, maxStaleMs: 12 * 60 * 60 * 1000 }
      );

      const tracks = (cachedResult.value.items || []).filter(
        item => item.playable && item.mid
      );
      if (!tracks.length) {
        throw new Error('Favourite Tracks contains no playable tracks');
      }

      const queueTracks = tracks.slice();
      if (shuffle) {
        for (let i = queueTracks.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queueTracks[i], queueTracks[j]] = [queueTracks[j], queueTracks[i]];
        }
      }

      let queuedCount = 0;
      let skippedCount = 0;
      let firstMid = '';

      let cancelled = false;

      for (const track of queueTracks) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) {
          cancelled = true;
          break;
        }

        const aid = queuedCount === 0 ? 4 : 3;
        try {
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
        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) {
            cancelled = true;
            break;
          }

          skippedCount += 1;
          console.warn(
            'TIDAL FAVOURITE TRACK SKIP:',
            JSON.stringify({
              mid: String(track.mid || ''),
              name: String(track.name || ''),
              artist: String(track.artist || ''),
              error: error.message
            })
          );
        }
      }

      if (cancelled || !tidalQueueBuildIsCurrent(queueGeneration)) {
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
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {
    try {
      await supersedeAndDrainTidalQueueBuild();
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      const selectedMid = url.searchParams.get('mid');
      const shuffle = url.searchParams.get('shuffle') === '1';
      if (!cid) return sendJson(res, 400, { error: 'Missing playlist cid' });

      let command =
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(cid);
      if (selectedMid) command += '&mid=' + encodeURIComponent(selectedMid);
      command += '&aid=4';
      await heosBrowse(command);
      await heosBrowse(
        'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
        '&shuffle=' + (shuffle ? 'on' : 'off')
      );

      return sendJson(res, 200, {
        ok: true,
        selectedMid: selectedMid || null,
        shuffle
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url.startsWith('/api/command')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const command = url.searchParams.get('command') || '';

      return sendJson(
        res,
        200,
        await semanticCommandControlWithAi(command)
      );
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url.startsWith('/api/control/')) {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/api/control/power') {
        const state = url.searchParams.get('state') || '';
        return sendJson(res, 200, await semanticPowerControl(state));
      }

      if (url.pathname === '/api/control/source') {
        const source = url.searchParams.get('source') || '';
        return sendJson(res, 200, await semanticSourceControl(source));
      }

      if (url.pathname === '/api/control/volume') {
        const action = url.searchParams.get('action') || '';
        const value = url.searchParams.get('value');

        return sendJson(
          res,
          200,
          await semanticVolumeControl(action, value)
        );
      }

      if (url.pathname === '/api/control/mute') {
        const state = url.searchParams.get('state') || '';
        return sendJson(res, 200, await semanticMuteControl(state));
      }

      if (url.pathname === '/api/control/transport') {
        const action = url.searchParams.get('action') || '';

        return sendJson(
          res,
          200,
          await semanticTransportControl(action)
        );
      }

      return sendJson(res, 404, { error: 'Unknown control endpoint' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Marantz backend listening on port ${HTTP_PORT}; AI fallback ${AI_FALLBACK_ENABLED ? 'enabled' : 'disabled'}`);
});

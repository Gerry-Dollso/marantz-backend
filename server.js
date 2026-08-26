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

const AVR_HOST = '192.168.50.220';
const AVR_PORT = 23;
const HEOS_PORT = 1255;
const PLAYER_ID = '48723103';
const HTTP_PORT = 3100;
const AI_FALLBACK_ENABLED = process.env.MARANTZ_AI_FALLBACK === '1';

let pendingTidalVoiceSearch = null;
let tidalVoiceSearchSequence = 0;
const voiceAliases = createVoiceAliasStore();

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

  const tidalAlbumMatch = text.match(
    /^(?:play|played) (?:the )?(?:album )?(.+?) by (.+)$/
  );

  if (tidalAlbumMatch) {
    try {
      return await playTidalAlbumByArtist(
        tidalAlbumMatch[1],
        tidalAlbumMatch[2]
      );
    } catch (error) {
      const safeFailure =
        /^TIDAL (?:artist|album|track|title) not found safely:/.test(
          String(error.message || '')
        );

      if (!safeFailure) {
        throw error;
      }

      const context =
        error.tidalVoiceContext &&
        typeof error.tidalVoiceContext === 'object'
          ? error.tidalVoiceContext
          : {};

      pendingTidalVoiceSearch = {
        id: ++tidalVoiceSearchSequence,
        query: tidalAlbumMatch[2].trim(),
        heard: text,
        requestedTitle: tidalAlbumMatch[1].trim(),
        type:
          context.type ||
          (/^TIDAL artist not found safely:/.test(
            String(error.message || '')
          )
            ? 'artist'
            : 'title'),
        artist: context.artist || '',
        artistCid: context.artistCid || '',
        reason: error.message,
        createdAt: Date.now()
      };

      return {
        ok: false,
        action: 'search-required',
        ...pendingTidalVoiceSearch
      };
    }
  }

  const tidalArtistMatch = text.match(/^play (.+)$/);

  if (tidalArtistMatch) {
    try {
      return await playTidalArtist(tidalArtistMatch[1]);
    } catch (error) {
      const safeFailure =
        /^TIDAL artist not found safely:/.test(
          String(error.message || '')
        );

      if (!safeFailure) {
        throw error;
      }

      pendingTidalVoiceSearch = {
        id: ++tidalVoiceSearchSequence,
        query: tidalArtistMatch[1].trim(),
        heard: text,
        requestedTitle: '',
        reason: error.message,
        createdAt: Date.now()
      };

      return {
        ok: false,
        action: 'search-required',
        ...pendingTidalVoiceSearch
      };
    }
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

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      if (!cid || !cid.trim()) return sendJson(res, 400, { error: 'Missing cid' });

      const heosCid = encodeURIComponent(cid.trim()).replace(/%20/g, ' ');
      if (url.searchParams.has('start') || url.searchParams.has('limit')) {
        const pageStart = Math.max(0, Number(url.searchParams.get('start')) || 0);
        const pageLimit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const pageEnd = pageStart + pageLimit - 1;
        const response = await heosBrowse(
          'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + pageStart + ',' + pageEnd
        );
        const message = response.heos?.message || '';
        const countMatch = message.match(/(?:^|&)count=(\d+)/);
        const total = countMatch ? Number(countMatch[1]) : null;
        return sendJson(res, 200, {
          ok: true,
          items: (response.payload || []).map(mapBrowseItem),
          count: total,
          start: pageStart,
          limit: pageLimit
        });
      }

      const pageSize = 50;
      const allItems = [];
      let start = 0;
      let total = null;
      while (total === null || start < total) {
        const response = await heosBrowse(
          'heos://browse/browse?sid=10&cid=' + heosCid + '&range=' + start + ',' + (start + pageSize - 1)
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

      return sendJson(res, 200, {
        ok: true,
        items: allItems.map(mapBrowseItem),
        count: allItems.length
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

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {
    try {
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

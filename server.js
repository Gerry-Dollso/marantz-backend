'use strict';

const http = require('http');
const net = require('net');

const AVR_HOST = '192.168.50.220';
const AVR_PORT = 23;
const HEOS_PORT = 1255;
const PLAYER_ID = '48723103';
const HTTP_PORT = 3100;

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
      socket.write(`${command}${port === AVR_PORT ? '\\r' : '\\r\\n'}`);
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
    line => prefix === 'MV'
      ? /^MV\d{2,3}$/.test(line)
      : line.startsWith(prefix)
  );
}

async function getHeosNowPlaying() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: AVR_HOST,
      port: HEOS_PORT
    });

    let buffer = '';
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    }

    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.write(
        `heos://player/get_now_playing_media?pid=${PLAYER_ID}\r\n`
      );
    });

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');

      if (!buffer.includes('\n')) return;

      const line = buffer.split('\n')[0].trim();

      try {
        finish(null, JSON.parse(line));
      } catch {
        finish(new Error('Invalid HEOS response'));
      }
    });

    socket.on('timeout', () => {
      finish(new Error('HEOS request timed out'));
    });

    socket.on('error', finish);
  });
}

async function getStatus() {
  const [power, input, volume, mute, heos] = await Promise.all([
    avr('ZM?', 'ZM'),
    avr('SI?', 'SI'),
    avr('MV?', 'MV'),
    avr('MU?', 'MU'),
    getHeosNowPlaying()
  ]);

  return {
    avr: {
      power,
      input,
      volume,
      mute
    },
    heos
  };
}


function avrSet(command, timeoutMs = 2000) {
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

    socket.on('timeout', () => {
      finish(null, { ok: true });
    });

    socket.on('error', finish);
  });
}



async function heosSet(command, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: AVR_HOST, port: HEOS_PORT });
    let buffer = "";
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
      socket.destroy();
      err ? reject(err) : resolve(val);
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => socket.write(command + "\r\n"));

    socket.on("data", d => {
      buffer += d.toString("utf8");
      while (buffer.includes("\n")) {
        const i = buffer.indexOf("\n");
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          if (r.heos?.result === "success") return finish(null, r);
          return finish(new Error(r.heos?.message || "HEOS failed"));
        } catch {}
      }
    });

    socket.on("timeout", () => finish(new Error("HEOS timeout")));
    socket.on("error", e => finish(e));
  });
}


async function heosBrowse(command, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: AVR_HOST,
      port: HEOS_PORT
    });

    let buffer = '';
    let finished = false;

    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(command + '\r\n');
    });

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
            finish(new Error(
              response.heos.message || 'HEOS browse failed'
            ));
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

    socket.on('timeout', () => {
      finish(new Error(`HEOS browse timeout: ${command}`));
    });

    socket.on('error', error => {
      finish(error);
    });

    socket.on('close', () => {
      if (!finished) {
        finish(new Error('HEOS connection closed'));
      }
    });
  });
}

async function selectSource(source) {
  const sources = {
    phono: 'MSSMART1',
    cd: 'MSSMART2',
    heos: 'MSSMART3',
    tv: 'MSSMART4',
    aux: 'SIAUX1'
  };

  const command = sources[source];

  if (!command) {
    throw new Error('Unknown source');
  }

  await avrSet(command);

  return {
    source,
    command
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/api/status') {
    try {
      const status = await getStatus();
      res.writeHead(200);
      res.end(JSON.stringify(status, null, 2));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }, null, 2));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/avr/mute')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const state = url.searchParams.get('state');

      if (state !== 'on' && state !== 'off') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'state must be on or off' }));
        return;
      }

      await avrSet(state === 'on' ? 'MUON' : 'MUOFF');

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        mute: state
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/avr/volume')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const direction = url.searchParams.get('direction');

      if (direction !== 'up' && direction !== 'down') {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'direction must be up or down'
        }));
        return;
      }

      await avrSet(direction === 'up' ? 'MVUP' : 'MVDOWN');

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        volume: direction
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/avr/power')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const state = url.searchParams.get('state');

      if (state !== 'on' && state !== 'standby') {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'state must be on or standby'
        }));
        return;
      }

      await avrSet(state === 'on' ? 'PWON' : 'PWSTANDBY');

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        power: state
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/avr/input')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const input = url.searchParams.get('input');

      const inputs = {
        phono: 'SIPHONO',
        cd: 'SICD',
        heos: 'SINET',
        tv: 'SITV',
        aux: 'SIAUX1'
      };

      if (!inputs[input]) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'input must be phono, cd, heos, tv, or aux'
        }));
        return;
      }

      await avrSet(inputs[input]);

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        input
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/avr/smart')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const number = url.searchParams.get('number');

      if (!['1', '2', '3', '4'].includes(number)) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'number must be 1, 2, 3, or 4'
        }));
        return;
      }

      await avrSet(`MSSMART${number}`);
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        smart: Number(number)
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/source')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const source = url.searchParams.get('source');

      if (!['phono', 'cd', 'heos', 'tv', 'aux'].includes(source)) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'source must be phono, cd, heos, tv, or aux'
        }));
        return;
      }

      const result = await selectSource(source);

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        ...result
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/heos/play') {
    try {
      await heosSet(
        `heos://player/set_play_state?pid=${PLAYER_ID}&state=play`
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        state: 'play'
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/heos/pause') {
    try {
      await heosSet(
        `heos://player/set_play_state?pid=${PLAYER_ID}&state=pause`
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        state: 'pause'
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/heos/next') {
    try {
      await heosSet(
        `heos://player/play_next?pid=${PLAYER_ID}`
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        action: 'next'
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/heos/previous') {
    try {
      await heosSet(
        `heos://player/play_previous?pid=${PLAYER_ID}`
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        action: 'previous'
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');

      if (!cid || !cid.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing cid' }));
        return;
      }

      const heosCid =
        encodeURIComponent(cid.trim()).replace(/%20/g, ' ');

      const pageSize = 50;
      const allItems = [];
      let start = 0;
      let total = null;

      while (total === null || start < total) {
        const end = start + pageSize - 1;

        const response = await heosBrowse(
          'heos://browse/browse?sid=10&cid=' +
          heosCid +
          '&range=' + start + ',' + end
        );

        const payload = Array.isArray(response.payload)
          ? response.payload
          : [];

        allItems.push(...payload);

        const message =
          response.heos && response.heos.message
            ? response.heos.message
            : '';

        const countMatch = message.match(/(?:^|&)count=(\d+)/);

        if (countMatch) {
          total = Number(countMatch[1]);
        }

        if (!payload.length) break;

        start += payload.length;

        if (total === null && payload.length < pageSize) break;
      }

      const items = allItems.map(item => ({
        name: item.name || '',
        cid: item.cid || '',
        mid: item.mid || '',
        type: item.type || '',
        container: item.container === 'yes',
        playable: item.playable === 'yes',
        artist: item.artist || '',
        albumId: item.album_id || '',
        imageUrl: item.image_url || ''
      }));

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        items,
        count: items.length
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/search?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('q');

      if (!query || !query.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'Missing search query'
        }));
        return;
      }

      const command =
        'heos://browse/search?sid=10&scid=1&search=' +
        encodeURIComponent(query.trim());

      const response = await heosBrowse(command);

      const artists = (response.payload || []).map(item => ({
        name: item.name,
        cid: item.cid,
        imageUrl: item.image_url || ''
      }));

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        artists
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/artist/albums?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');

      if (!cid || !cid.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'Missing artist cid'
        }));
        return;
      }

      const artistId = cid.trim().replace('LIBARTIST-', '');
      const albumsCid = `LIBARTIST-Albums-${artistId}`;

      const command =
        'heos://browse/browse?sid=10&cid=' +
        encodeURIComponent(albumsCid);

      const response = await heosBrowse(command);

      const albums = (response.payload || []).map(item => ({
        name: item.name,
        artist: item.artist || '',
        cid: item.cid,
        playable: item.playable === 'yes',
        imageUrl: item.image_url || ''
      }));

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        albums
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/album/tracks?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');

      if (!cid || !cid.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'Missing album cid'
        }));
        return;
      }

      const command =
        'heos://browse/browse?sid=10&cid=' +
        encodeURIComponent(cid.trim());

      const response = await heosBrowse(command);

      const tracks = (response.payload || []).map(item => ({
        name: item.name,
        artist: item.artist || '',
        album: item.album || '',
        albumId: item.album_id || '',
        mid: item.mid,
        playable: item.playable === 'yes',
        imageUrl: item.image_url || ''
      }));

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        tracks
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/tidal/play?')) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const cid = url.searchParams.get('cid');
      const selectedMid = url.searchParams.get('mid');

      if (!cid || !selectedMid) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'Missing cid or mid'
        }));
        return;
      }

      // Get the complete album track list.
      const albumResponse = await heosBrowse(
        'heos://browse/browse?sid=10&cid=' +
        encodeURIComponent(cid)
      );

      const tracks = (albumResponse.payload || [])
        .filter(item => item.playable === 'yes' && item.mid);

      if (!tracks.length) {
        throw new Error('Album has no playable tracks');
      }

      // Replace the existing HEOS queue with track 1.
      await heosBrowse(
        'heos://browse/add_to_queue?' +
        'pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10' +
        '&cid=' + encodeURIComponent(cid) +
        '&mid=' + encodeURIComponent(tracks[0].mid) +
        '&aid=4'
      );

      // Append the remainder of the album in normal track order.
      for (const track of tracks.slice(1)) {
        await heosBrowse(
          'heos://browse/add_to_queue?' +
          'pid=' + encodeURIComponent(PLAYER_ID) +
          '&sid=10' +
          '&cid=' + encodeURIComponent(cid) +
          '&mid=' + encodeURIComponent(track.mid) +
          '&aid=3'
        );
      }

      // If another track was selected, find its queue ID and start it.
      if (String(selectedMid) !== String(tracks[0].mid)) {
        const queueResponse = await heosBrowse(
          'heos://player/get_queue?' +
          'pid=' + encodeURIComponent(PLAYER_ID) +
          '&range=0,100'
        );

        const selectedItem = (queueResponse.payload || []).find(
          item => String(item.mid) === String(selectedMid)
        );

        if (!selectedItem || selectedItem.qid === undefined) {
          throw new Error('Selected track not found in HEOS queue');
        }

        await heosBrowse(
          'heos://player/play_queue?' +
          'pid=' + encodeURIComponent(PLAYER_ID) +
          '&qid=' + encodeURIComponent(selectedItem.qid)
        );
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        queued: tracks.length,
        selectedMid: String(selectedMid)
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Marantz backend listening on port ${HTTP_PORT}`);
});

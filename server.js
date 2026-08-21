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

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Marantz backend listening on port ${HTTP_PORT}`);
});

'use strict';

// Read-only validator for tidal-heos-resolver.js. It reuses the live official
// TIDAL metadata batch endpoint and permits only HEOS browse/search commands.
// It cannot change playback, queue, source, power, volume, or mute state.

const net = require('net');
const { createTidalHeosResolver } = require('../tidal-heos-resolver');

const BACKEND_URL = 'http://127.0.0.1:3100/api/tidal/oauth/probe-recommendation-resolution-batch';
const HEOS_HOST = '192.168.50.220';
const HEOS_PORT = 1255;

function assertReadOnly(command) {
  if (!/^heos:\/\/browse\/(browse|search)\?/.test(command)) {
    throw new Error('Refusing non-read-only HEOS command: ' + command);
  }
  if (/add_to_queue|player\//i.test(command)) {
    throw new Error('Refusing playback-changing HEOS command: ' + command);
  }
}

function heosBrowse(command, timeoutMs = 8000) {
  assertReadOnly(command);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HEOS_HOST, port: HEOS_PORT });
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
          const expected = command.replace(/^heos:\/\//, '').split('?')[0];
          if (response.heos.command !== expected) continue;
          if (response.heos.result === 'fail') {
            return finish(new Error(response.heos.message || 'HEOS browse failed'));
          }
          if (Array.isArray(response.payload)) return finish(null, response);
          const message = String(response.heos.message || '');
          if (!message.includes('command under process')) return finish(null, response);
        } catch {}
      }
    });
    socket.on('timeout', () => finish(new Error('HEOS timeout')));
    socket.on('error', finish);
    socket.on('close', () => {
      if (!finished) finish(new Error('HEOS connection closed'));
    });
  });
}

async function main() {
  const response = await fetch(BACKEND_URL);
  const batch = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(batch.tracks)) {
    throw new Error(batch.error || ('Metadata batch HTTP ' + response.status));
  }

  const resolver = createTidalHeosResolver({ heosBrowse, sid: '10' });
  const results = [];

  for (let i = 0; i < batch.tracks.length; i += 1) {
    const item = batch.tracks[i];
    if (!item.ok) {
      results.push({ id: item.id, source: item.source, status: 'metadata-error', reason: item.error || 'metadata failed' });
      continue;
    }

    try {
      const target = resolver.extractOfficialTrack(item);
      const resolution = await resolver.resolveTrack(target);
      results.push({ ...target, ...resolution });
      console.log(
        String(i + 1).padStart(2, '0') + '/' + batch.tracks.length,
        '|', target.source,
        '|', target.title,
        '|', target.artist,
        '|', resolution.status,
        '|', resolution.method || resolution.reason || ''
      );
    } catch (error) {
      results.push({ id: item.id, source: item.source, status: 'error', reason: error.message });
      console.log(
        String(i + 1).padStart(2, '0') + '/' + batch.tracks.length,
        '|', item.source,
        '|', item.id,
        '| ERROR |', error.message
      );
    }
  }

  const summary = {
    total: results.length,
    resolved: results.filter(x => x.status === 'resolved').length,
    ambiguous: results.filter(x => x.status === 'ambiguous').length,
    unresolved: results.filter(x => x.status === 'unresolved').length,
    metadataErrors: results.filter(x => x.status === 'metadata-error').length,
    errors: results.filter(x => x.status === 'error').length,
    methods: Object.fromEntries(
      [...new Set(results.filter(x => x.method).map(x => x.method))]
        .map(method => [method, results.filter(x => x.method === method).length])
    )
  };

  console.log('SUMMARY', JSON.stringify(summary));
  if (summary.errors || summary.metadataErrors) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

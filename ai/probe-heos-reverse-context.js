'use strict';

// Strictly read-only HEOS/TIDAL reconnaissance.
// Goal: determine whether a known official TIDAL track ID / likely HEOS MID
// can reveal a deterministic playable HEOS container/CID.
// Allowed HEOS commands: browse/get_search_criteria, browse/search, browse/browse.
// This script refuses player commands and browse/add_to_queue.

const fs = require('fs');
const net = require('net');

const HEOS_HOST = '192.168.50.220';
const HEOS_PORT = 1255;
const TIDAL_SID = '10';
const OUTPUT_FILE = '/tmp/heos-reverse-context.json';

const TESTS = [
  { label: 'unresolved', id: '33348416', title: 'Rise', artist: 'Public Image Ltd.', album: 'Public Image Ltd.' },
  { label: 'unresolved', id: '35888116', title: 'Black Soul Choir', artist: '16 Horsepower', album: "Sackcloth 'N' Ashes" },
  { label: 'ambiguous', id: '34454218', title: 'Birthday', artist: 'The Sugarcubes', album: "Life's Too Good" },
  { label: 'control', id: '119068622', title: 'Freak Scene', artist: 'Dinosaur Jr.' },
  { label: 'control', id: '113779406', title: 'A Daisy Chain 4 Satan (Acid & Flowers Mix)', artist: 'My Life With The Thrill Kill Kult' }
];

function normalise(value) {
  return String(value || '').replace(/%26/gi, '&').toLowerCase().replace(/[’']/g, "'")
    .replace(/&/g, ' and ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertReadOnly(command) {
  if (!/^heos:\/\/browse\/(?:get_search_criteria|search|browse)\?/.test(command)) {
    throw new Error('Refusing non-read-only HEOS command: ' + command);
  }
  if (/add_to_queue|play_|player\/|set_|clear_queue|remove_queue|move_queue/i.test(command)) {
    throw new Error('Refusing state-changing HEOS command: ' + command);
  }
}

function heos(command, timeoutMs = 8000) {
  assertReadOnly(command);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HEOS_HOST, port: HEOS_PORT });
    let buffer = '';
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      socket.destroy();
      err ? reject(err) : resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write(command + '\r\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const pos = buffer.indexOf('\n');
        const line = buffer.slice(0, pos).trim();
        buffer = buffer.slice(pos + 1);
        if (!line) continue;
        try {
          const response = JSON.parse(line);
          if (!response.heos) continue;
          const expected = command.replace(/^heos:\/\//, '').split('?')[0];
          if (response.heos.command !== expected) continue;
          if (response.heos.result === 'fail') return finish(new Error(response.heos.message || 'HEOS command failed'));
          if (Array.isArray(response.payload)) return finish(null, response);
          const message = String(response.heos.message || '');
          if (!message.includes('command under process')) return finish(null, response);
        } catch {}
      }
    });
    socket.on('timeout', () => finish(new Error('HEOS timeout')));
    socket.on('error', finish);
    socket.on('close', () => { if (!done) finish(new Error('HEOS connection closed')); });
  });
}

function compact(item) {
  return {
    type: String(item?.type || ''), container: String(item?.container || ''), playable: String(item?.playable || ''),
    name: String(item?.name || ''), artist: String(item?.artist || ''), album: String(item?.album || ''),
    cid: String(item?.cid || ''), mid: String(item?.mid || '')
  };
}

function parseCriteria(payload) {
  return (payload || []).map(item => ({
    name: String(item?.name || ''), scid: String(item?.scid || ''), wildcard: String(item?.wildcard || ''),
    playable: String(item?.playable || ''), cid: String(item?.cid || '')
  }));
}

async function search(scid, value) {
  const command = 'heos://browse/search?sid=' + TIDAL_SID + '&search=' + encodeURIComponent(value) + '&scid=' + encodeURIComponent(scid) + '&range=0,99';
  const response = await heos(command);
  return (response.payload || []).map(compact);
}

async function browse(cid) {
  const command = 'heos://browse/browse?sid=' + TIDAL_SID + '&cid=' + encodeURIComponent(cid) + '&range=0,99';
  const response = await heos(command);
  return (response.payload || []).map(compact);
}

function analyse(items, test) {
  const idMatches = items.filter(item => item.mid === test.id);
  const titleMatches = items.filter(item => normalise(item.name) === normalise(test.title));
  return { idMatches, titleMatches };
}

async function main() {
  const criteriaResponse = await heos('heos://browse/get_search_criteria?sid=' + TIDAL_SID);
  const criteria = parseCriteria(criteriaResponse.payload);
  console.log('SEARCH_CRITERIA', JSON.stringify(criteria));

  const trackCriteria = criteria.filter(item => /track|song/i.test(item.name));
  if (!trackCriteria.length) throw new Error('TIDAL HEOS source exposes no track/song search criterion');

  const results = [];
  for (const test of TESTS) {
    const record = { ...test, searches: [] };
    for (const criterion of trackCriteria) {
      for (const query of [test.id, test.title]) {
        try {
          const items = await search(criterion.scid, query);
          const analysis = analyse(items, test);
          record.searches.push({ criterion, query, returned: items.length, idMatches: analysis.idMatches, titleMatches: analysis.titleMatches,
            sample: items.slice(0, 20) });
        } catch (error) {
          record.searches.push({ criterion, query, error: error.message });
        }
      }
    }

    // If search itself returns a container carrying the exact target MID, browse
    // only that returned CID. Never construct a CID from the target ID here.
    const exactContainers = new Map();
    for (const attempt of record.searches) {
      for (const item of attempt.idMatches || []) {
        if (item.cid) exactContainers.set(item.cid, item);
      }
    }
    record.exactReturnedContainers = [];
    for (const [cid, sourceItem] of exactContainers) {
      try {
        const children = await browse(cid);
        record.exactReturnedContainers.push({ cid, sourceItem, children: children.slice(0, 100), targetMidChildren: children.filter(item => item.mid === test.id) });
      } catch (error) {
        record.exactReturnedContainers.push({ cid, sourceItem, error: error.message });
      }
    }

    results.push(record);
    const exactSearchHits = record.searches.reduce((n, attempt) => n + (attempt.idMatches?.length || 0), 0);
    console.log(test.label, '|', test.id, '|', test.title, '| exact MID search hits:', exactSearchHits, '| returned CIDs:', exactContainers.size);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), criteria, results }, null, 2));
  console.log('DETAILS', OUTPUT_FILE);
}

main().catch(error => { console.error('FATAL', error.message); process.exitCode = 1; });

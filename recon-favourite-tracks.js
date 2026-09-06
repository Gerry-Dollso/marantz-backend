'use strict';

const fs = require('fs');
const net = require('net');

const API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const COUNTRY_CODE = 'GB';
const AVR_HOST = '192.168.50.220';
const HEOS_PORT = 1255;
const HEOS_SID = '10';
const HEOS_CID = 'My Music-Tracks';
const ENV_FILE = '/etc/marantz-backend/tidal.env';
const REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token';
const DETAIL_LIMIT = Math.min(50, Math.max(0, Number(process.argv[2]) || 20));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseEnvFile(pathname) {
  const values = {};
  const text = fs.readFileSync(pathname, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function getAccessToken() {
  const env = parseEnvFile(ENV_FILE);
  const clientId = String(env.TIDAL_CLIENT_ID || '').trim();
  const refreshToken = fs.readFileSync(REFRESH_TOKEN_FILE, 'utf8').trim();
  if (!clientId) throw new Error('TIDAL_CLIENT_ID is missing');
  if (!refreshToken) throw new Error('TIDAL refresh token is missing');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`TIDAL token refresh failed: ${detail}`);
  }
  return String(payload.access_token);
}

function absoluteTidalUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return API_BASE + text;
  return API_BASE + '/' + text;
}

async function tidalGetUrl(accessToken, url) {
  const response = await fetch(absoluteTidalUrl(url), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.api+json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.detail || `HTTP ${response.status}`;
    throw new Error(`TIDAL ${response.status}: ${detail}`);
  }
  return payload;
}

async function getAllOfficialFavouriteTrackIds(accessToken) {
  let next = '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(COUNTRY_CODE);
  const ids = [];
  const pages = [];
  const seenUrls = new Set();
  while (next) {
    const absoluteNext = absoluteTidalUrl(next);
    if (seenUrls.has(absoluteNext)) throw new Error('Repeated TIDAL pagination URL');
    if (pages.length >= 250) throw new Error('TIDAL pagination safety limit reached');
    seenUrls.add(absoluteNext);
    const startedAt = process.hrtime.bigint();
    const payload = await tidalGetUrl(accessToken, absoluteNext);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const data = Array.isArray(payload?.data) ? payload.data : [];
    for (const item of data) {
      if (item?.type === 'tracks' && /^\d+$/.test(String(item.id || ''))) ids.push(String(item.id));
    }
    pages.push({ page: pages.length + 1, count: data.length, elapsedMs: Math.round(elapsedMs * 10) / 10 });
    next = payload?.links?.next || null;
    if (next) await sleep(1000);
  }
  return { ids, pages };
}

function heosBrowse(command, timeoutMs = 15000) {
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
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const response = JSON.parse(line);
          if (!response.heos) continue;
          if (response.heos.result === 'fail') return finish(new Error(response.heos.message || 'HEOS browse failed'));
          if (Array.isArray(response.payload)) return finish(null, response);
          const message = String(response.heos.message || '');
          if (!message.includes('command under process')) return finish(null, response);
        } catch {}
      }
    });
    socket.on('timeout', () => finish(new Error(`HEOS browse timeout: ${command}`)));
    socket.on('error', finish);
    socket.on('close', () => { if (!finished) finish(new Error('HEOS connection closed')); });
  });
}

async function getAllHeosFavouriteTracks() {
  const pageSize = 50;
  const items = [];
  let start = 0;
  let total = null;
  while (total === null || start < total) {
    const response = await heosBrowse('heos://browse/browse?sid=' + HEOS_SID + '&cid=' + HEOS_CID + '&range=' + start + ',' + (start + pageSize - 1));
    const payload = Array.isArray(response.payload) ? response.payload : [];
    items.push(...payload);
    const message = String(response.heos?.message || '');
    const countMatch = message.match(/(?:^|&)count=(\d+)/);
    if (countMatch) total = Number(countMatch[1]);
    if (!payload.length) break;
    start += payload.length;
    if (total === null && payload.length < pageSize) break;
  }
  return items.map((item, index) => ({
    position: index,
    mid: String(item.mid || ''),
    title: String(item.name || ''),
    artist: String(item.artist || ''),
    album: String(item.album || ''),
    albumId: String(item.album_id || ''),
    imageUrl: String(item.image_url || '')
  }));
}

function countIds(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

function duplicateSummary(ids) {
  return [...countIds(ids).entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function uniqueInOrder(ids) {
  const seen = new Set();
  return ids.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function main() {
  console.log('READ-ONLY Favourite Tracks positional correlation probe');
  console.log(`Positional detail limit: ${DETAIL_LIMIT}`);
  const accessToken = await getAccessToken();
  const [official, heosTracks] = await Promise.all([getAllOfficialFavouriteTrackIds(accessToken), getAllHeosFavouriteTracks()]);
  const officialIds = official.ids;
  const heosIds = heosTracks.map(item => item.mid);
  const officialSet = new Set(officialIds);
  const heosSet = new Set(heosIds);
  const officialOnlyPositions = officialIds.map((id, position) => ({ id, position })).filter(item => !heosSet.has(item.id));
  const heosCounts = countIds(heosIds);
  const heosSeen = new Map();
  const duplicateOccurrences = [];
  heosTracks.forEach(item => {
    const occurrence = (heosSeen.get(item.mid) || 0) + 1;
    heosSeen.set(item.mid, occurrence);
    if (occurrence > 1) duplicateOccurrences.push({ ...item, occurrence, totalOccurrences: heosCounts.get(item.mid) });
  });
  const officialLive = officialIds.filter(id => heosSet.has(id));
  const heosUnique = uniqueInOrder(heosIds);
  const dedupedSameOrder = officialLive.length === heosUnique.length && officialLive.every((id, index) => id === heosUnique[index]);
  const rowMatches = officialIds.reduce((count, id, index) => count + (id === heosIds[index] ? 1 : 0), 0);
  const staleRows = officialOnlyPositions.map(({ id, position }) => {
    const at = heosTracks[position] || null;
    const before = position > 0 ? heosTracks[position - 1] : null;
    const after = position + 1 < heosTracks.length ? heosTracks[position + 1] : null;
    return {
      position,
      officialStaleId: id,
      heosAtSamePosition: at ? { mid: at.mid, title: at.title, artist: at.artist, album: at.album, albumId: at.albumId, duplicateTotal: heosCounts.get(at.mid) } : null,
      heosBefore: before ? { position: before.position, mid: before.mid, title: before.title, artist: before.artist } : null,
      heosAfter: after ? { position: after.position, mid: after.mid, title: after.title, artist: after.artist } : null
    };
  });
  const summary = {
    officialTrackCount: officialIds.length,
    officialUniqueCount: new Set(officialIds).size,
    heosTrackCount: heosIds.length,
    heosUniqueMidCount: heosSet.size,
    exactIdOverlapUnique: [...officialSet].filter(id => heosSet.has(id)).length,
    officialOnlyCount: officialOnlyPositions.length,
    heosUniqueOnlyCount: [...heosSet].filter(id => !officialSet.has(id)).length,
    heosDuplicateIdCount: duplicateSummary(heosIds).length,
    heosDuplicateExcessOccurrences: heosIds.length - heosSet.size,
    samePositionRowMatches: rowMatches,
    officialLiveCount: officialLive.length,
    heosDedupedCount: heosUnique.length,
    dedupedSameOrder
  };
  console.log('\nSUMMARY');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nHEOS DUPLICATE IDS');
  console.log(JSON.stringify(duplicateSummary(heosIds), null, 2));
  console.log('\nOFFICIAL STALE POSITIONS WITH HEOS NEIGHBOURS');
  console.log(JSON.stringify(staleRows.slice(0, DETAIL_LIMIT), null, 2));
  console.log('\nHEOS EXTRA DUPLICATE OCCURRENCES');
  console.log(JSON.stringify(duplicateOccurrences.slice(0, DETAIL_LIMIT), null, 2));
  if (!dedupedSameOrder) {
    const firstDifferences = [];
    const limit = Math.max(officialLive.length, heosUnique.length);
    for (let i = 0; i < limit && firstDifferences.length < DETAIL_LIMIT; i += 1) {
      if (officialLive[i] !== heosUnique[i]) firstDifferences.push({ position: i, officialLiveId: officialLive[i] || null, heosUniqueMid: heosUnique[i] || null });
    }
    console.log('\nDEDUPED ORDER DIFFERENCES');
    console.log(JSON.stringify(firstDifferences, null, 2));
  }
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

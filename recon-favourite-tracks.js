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
const DETAIL_LIMIT = Math.min(30, Math.max(0, Number(process.argv[2]) || 10));

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
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken
    })
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.api+json'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.detail || `HTTP ${response.status}`;
    throw new Error(`TIDAL ${response.status}: ${detail}`);
  }
  return payload;
}

async function getAllOfficialFavouriteTrackIds(accessToken) {
  let next = '/userCollectionTracks/me/relationships/items?countryCode=' +
    encodeURIComponent(COUNTRY_CODE);
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
      if (item?.type === 'tracks' && /^\d+$/.test(String(item.id || ''))) {
        ids.push(String(item.id));
      }
    }
    pages.push({
      page: pages.length + 1,
      count: data.length,
      elapsedMs: Math.round(elapsedMs * 10) / 10
    });
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
          if (response.heos.result === 'fail') {
            finish(new Error(response.heos.message || 'HEOS browse failed'));
            return;
          }
          if (Array.isArray(response.payload)) {
            finish(null, response);
            return;
          }
          const message = String(response.heos.message || '');
          if (!message.includes('command under process')) {
            finish(null, response);
            return;
          }
        } catch {
          // Ignore unrelated/non-JSON HEOS traffic.
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

async function getAllHeosFavouriteTracks() {
  const pageSize = 50;
  const items = [];
  let start = 0;
  let total = null;

  while (total === null || start < total) {
    const response = await heosBrowse(
      'heos://browse/browse?sid=' + HEOS_SID +
      '&cid=' + HEOS_CID +
      '&range=' + start + ',' + (start + pageSize - 1)
    );
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

function findDuplicates(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
}

async function getOfficialTrackDetail(accessToken, id) {
  const url = '/tracks/' + encodeURIComponent(id) +
    '?include=' + encodeURIComponent('artists,albums,albums.coverArt') +
    '&countryCode=' + encodeURIComponent(COUNTRY_CODE);
  const payload = await tidalGetUrl(accessToken, url);
  const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
  const included = Array.isArray(payload?.included) ? payload.included : [];
  const artist = included.find(item => item?.type === 'artists');
  const album = included.find(item => item?.type === 'albums');
  return {
    id: String(root?.id || id),
    title: String(root?.attributes?.title || ''),
    artist: String(artist?.attributes?.name || ''),
    album: String(album?.attributes?.title || ''),
    albumId: String(album?.id || ''),
    isrc: String(root?.attributes?.isrc || ''),
    duration: String(root?.attributes?.duration || '')
  };
}

async function main() {
  console.log('READ-ONLY Favourite Tracks full correlation probe');
  console.log(`Mismatch metadata detail limit: ${DETAIL_LIMIT}`);

  const accessToken = await getAccessToken();
  const [official, heosTracks] = await Promise.all([
    getAllOfficialFavouriteTrackIds(accessToken),
    getAllHeosFavouriteTracks()
  ]);

  const officialIds = official.ids;
  const heosIds = heosTracks.map(item => item.mid);
  const officialSet = new Set(officialIds);
  const heosSet = new Set(heosIds);
  const officialOnly = officialIds.filter(id => !heosSet.has(id));
  const heosOnly = heosTracks.filter(item => !officialSet.has(item.mid));
  const shared = officialIds.filter(id => heosSet.has(id));
  const heosPositions = new Map();
  heosIds.forEach((id, index) => {
    if (!heosPositions.has(id)) heosPositions.set(id, index);
  });

  const positionDifferences = shared.map((id, officialPosition) => ({
    id,
    officialPosition,
    heosPosition: heosPositions.get(id),
    delta: heosPositions.get(id) - officialPosition
  }));
  const exactSamePositionCount = positionDifferences.filter(item => item.delta === 0).length;
  const sameOrder = officialIds.length === heosIds.length &&
    officialIds.every((id, index) => id === heosIds[index]);

  const summary = {
    officialTrackCount: officialIds.length,
    officialPages: official.pages.length,
    officialPageSizes: official.pages.map(page => page.count),
    heosTrackCount: heosIds.length,
    exactIdOverlap: shared.length,
    officialOnlyCount: officialOnly.length,
    heosOnlyCount: heosOnly.length,
    officialDuplicateIds: findDuplicates(officialIds),
    heosDuplicateIds: findDuplicates(heosIds),
    sameOrder,
    exactSamePositionCount,
    sharedTrackCount: shared.length,
    maxAbsolutePositionDelta: positionDifferences.length
      ? Math.max(...positionDifferences.map(item => Math.abs(item.delta)))
      : 0
  };

  console.log('\nSUMMARY');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\nTIDAL PAGE TIMINGS');
  console.log(JSON.stringify(official.pages, null, 2));

  console.log('\nOFFICIAL-ONLY IDS');
  console.log(JSON.stringify(officialOnly.slice(0, 50), null, 2));

  console.log('\nHEOS-ONLY ITEMS');
  console.log(JSON.stringify(heosOnly.slice(0, 50), null, 2));

  if (!sameOrder) {
    console.log('\nFIRST POSITION DIFFERENCES');
    console.log(JSON.stringify(positionDifferences.filter(item => item.delta !== 0).slice(0, 50), null, 2));
  }

  if (DETAIL_LIMIT > 0 && officialOnly.length) {
    const details = [];
    for (const id of officialOnly.slice(0, DETAIL_LIMIT)) {
      if (details.length) await sleep(1000);
      try {
        details.push({ ok: true, ...(await getOfficialTrackDetail(accessToken, id)) });
      } catch (error) {
        details.push({ ok: false, id, error: error.message });
      }
    }
    console.log('\nOFFICIAL-ONLY METADATA');
    console.log(JSON.stringify(details, null, 2));
  }
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

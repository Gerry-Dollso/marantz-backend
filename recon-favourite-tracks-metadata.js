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
const DETAIL_LIMIT = Math.min(100, Math.max(1, Number(process.argv[2]) || 25));
const CONCURRENCY = 4;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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
  if (!response.ok || !payload.access_token) throw new Error(`TIDAL token refresh failed: ${payload.error_description || payload.error || `HTTP ${response.status}`}`);
  return String(payload.access_token);
}

function absoluteTidalUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return text.startsWith('/') ? API_BASE + text : API_BASE + '/' + text;
}

async function tidalGetUrl(accessToken, url, attempt = 1) {
  const response = await fetch(absoluteTidalUrl(url), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.api+json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt <= 5) {
    const retryAfter = Math.max(1, Number(response.headers.get('retry-after')) || attempt * 2);
    await sleep(retryAfter * 1000);
    return tidalGetUrl(accessToken, url, attempt + 1);
  }
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.detail || `HTTP ${response.status}`;
    const error = new Error(`TIDAL ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getAllOfficialFavouriteTrackIds(accessToken) {
  let next = '/userCollectionTracks/me/relationships/items?countryCode=' + encodeURIComponent(COUNTRY_CODE);
  const ids = [];
  const seenUrls = new Set();
  let pages = 0;
  while (next) {
    const absoluteNext = absoluteTidalUrl(next);
    if (seenUrls.has(absoluteNext)) throw new Error('Repeated TIDAL pagination URL');
    if (pages >= 250) throw new Error('TIDAL pagination safety limit reached');
    seenUrls.add(absoluteNext);
    const payload = await tidalGetUrl(accessToken, absoluteNext);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    for (const item of data) if (item?.type === 'tracks' && /^\d+$/.test(String(item.id || ''))) ids.push(String(item.id));
    pages += 1;
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
          if (!String(response.heos.message || '').includes('command under process')) return finish(null, response);
        } catch {}
      }
    });
    socket.on('timeout', () => finish(new Error(`HEOS browse timeout: ${command}`)));
    socket.on('error', finish);
    socket.on('close', () => { if (!finished) finish(new Error('HEOS connection closed')); });
  });
}

async function getAllHeosFavouriteTracks() {
  const items = [];
  let start = 0;
  let total = null;
  while (total === null || start < total) {
    const response = await heosBrowse('heos://browse/browse?sid=' + HEOS_SID + '&cid=' + HEOS_CID + '&range=' + start + ',' + (start + 49));
    const payload = Array.isArray(response.payload) ? response.payload : [];
    items.push(...payload);
    const match = String(response.heos?.message || '').match(/(?:^|&)count=(\d+)/);
    if (match) total = Number(match[1]);
    if (!payload.length) break;
    start += payload.length;
    if (total === null && payload.length < 50) break;
  }
  return items.map((item, position) => ({
    position,
    mid: String(item.mid || ''),
    title: String(item.name || ''),
    artist: String(item.artist || ''),
    album: String(item.album || ''),
    albumId: String(item.album_id || '')
  }));
}

function uniqueRowsInOrder(rows) {
  const seen = new Set();
  return rows.filter(row => {
    if (!row.mid || seen.has(row.mid)) return false;
    seen.add(row.mid);
    return true;
  });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/%26/gi, '&')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function getOfficialTrackDetail(accessToken, id) {
  const payload = await tidalGetUrl(
    accessToken,
    '/tracks/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent('artists,albums') +
      '&countryCode=' + encodeURIComponent(COUNTRY_CODE)
  );
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

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      await sleep(75);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function main() {
  console.log('READ-ONLY Favourite Tracks 594-track metadata validation');
  console.log(`Mismatch detail limit: ${DETAIL_LIMIT}`);
  const accessToken = await getAccessToken();
  const [official, heosRows] = await Promise.all([
    getAllOfficialFavouriteTrackIds(accessToken),
    getAllHeosFavouriteTracks()
  ]);

  const heosUnique = uniqueRowsInOrder(heosRows);
  const heosSet = new Set(heosUnique.map(row => row.mid));
  const officialLiveIds = official.ids.filter(id => heosSet.has(id));
  const sameIdOrder = officialLiveIds.length === heosUnique.length && officialLiveIds.every((id, index) => id === heosUnique[index].mid);
  if (!sameIdOrder) throw new Error('594-track ID order is not identical; refusing metadata comparison');

  let completed = 0;
  const officialDetails = await mapPool(officialLiveIds, CONCURRENCY, async id => {
    const detail = await getOfficialTrackDetail(accessToken, id);
    completed += 1;
    if (completed % 50 === 0 || completed === officialLiveIds.length) console.log(`metadata ${completed}/${officialLiveIds.length}`);
    return detail;
  });

  const mismatches = [];
  let exactTitle = 0;
  let normalizedTitle = 0;
  let exactArtist = 0;
  let normalizedArtist = 0;
  let exactAlbum = 0;
  let normalizedAlbum = 0;
  let exactAlbumId = 0;
  let exactTitleArtist = 0;
  let normalizedTitleArtist = 0;

  for (let index = 0; index < officialDetails.length; index += 1) {
    const tidal = officialDetails[index];
    const heos = heosUnique[index];
    const titleExact = tidal.title === heos.title;
    const titleNorm = normalizeText(tidal.title) === normalizeText(heos.title);
    const artistExact = tidal.artist === heos.artist;
    const artistNorm = normalizeText(tidal.artist) === normalizeText(heos.artist);
    const albumExact = tidal.album === heos.album;
    const albumNorm = normalizeText(tidal.album) === normalizeText(heos.album);
    const albumIdExact = tidal.albumId === heos.albumId;
    if (titleExact) exactTitle += 1;
    if (titleNorm) normalizedTitle += 1;
    if (artistExact) exactArtist += 1;
    if (artistNorm) normalizedArtist += 1;
    if (albumExact) exactAlbum += 1;
    if (albumNorm) normalizedAlbum += 1;
    if (albumIdExact) exactAlbumId += 1;
    if (titleExact && artistExact) exactTitleArtist += 1;
    if (titleNorm && artistNorm) normalizedTitleArtist += 1;
    if (!(titleNorm && artistNorm && albumIdExact)) {
      mismatches.push({
        position: index,
        id: tidal.id,
        tidal: { title: tidal.title, artist: tidal.artist, album: tidal.album, albumId: tidal.albumId },
        heos: { title: heos.title, artist: heos.artist, album: heos.album, albumId: heos.albumId },
        normalized: { title: titleNorm, artist: artistNorm, album: albumNorm, albumId: albumIdExact }
      });
    }
  }

  console.log('\nSUMMARY');
  console.log(JSON.stringify({
    officialRawReferenceCount: official.ids.length,
    officialPages: official.pages,
    officialLiveTrackCount: officialLiveIds.length,
    heosRawRowCount: heosRows.length,
    heosUniqueTrackCount: heosUnique.length,
    sameIdOrder,
    exactTitle,
    normalizedTitle,
    exactArtist,
    normalizedArtist,
    exactAlbum,
    normalizedAlbum,
    exactAlbumId,
    exactTitleArtist,
    normalizedTitleArtist,
    fullIdentityMatchCount: officialDetails.length - mismatches.length,
    mismatchCount: mismatches.length
  }, null, 2));

  console.log('\nMISMATCHES');
  console.log(JSON.stringify(mismatches.slice(0, DETAIL_LIMIT), null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

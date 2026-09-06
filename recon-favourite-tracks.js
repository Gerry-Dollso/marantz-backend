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
const DETAIL_LIMIT = Math.min(100, Math.max(1, Number(process.argv[2]) || 50));
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

async function tidalGetUrl(accessToken, url) {
  const response = await fetch(absoluteTidalUrl(url), { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.api+json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TIDAL ${response.status}: ${payload?.errors?.[0]?.detail || payload?.detail || `HTTP ${response.status}`}`);
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

function uniqueInOrder(ids) {
  const seen = new Set();
  return ids.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function buildAnchorGaps(officialIds, heosTracks) {
  const heosIds = heosTracks.map(item => item.mid);
  const heosSet = new Set(heosIds);
  const anchors = officialIds.filter(id => heosSet.has(id));
  const gaps = Array.from({ length: anchors.length + 1 }, (_, index) => ({
    beforeAnchor: index > 0 ? anchors[index - 1] : null,
    afterAnchor: index < anchors.length ? anchors[index] : null,
    officialStaleIds: [],
    heosExtraRows: []
  }));

  let officialAnchorIndex = 0;
  for (const id of officialIds) {
    if (heosSet.has(id)) {
      if (id !== anchors[officialAnchorIndex]) throw new Error('Official anchor order mismatch');
      officialAnchorIndex += 1;
    } else {
      gaps[officialAnchorIndex].officialStaleIds.push(id);
    }
  }

  const seenHeos = new Set();
  let heosAnchorIndex = 0;
  for (const item of heosTracks) {
    if (!seenHeos.has(item.mid)) {
      seenHeos.add(item.mid);
      if (item.mid !== anchors[heosAnchorIndex]) throw new Error(`HEOS anchor order mismatch at unique index ${heosAnchorIndex}`);
      heosAnchorIndex += 1;
    } else {
      gaps[heosAnchorIndex].heosExtraRows.push({
        position: item.position,
        mid: item.mid,
        title: item.title,
        artist: item.artist,
        album: item.album,
        albumId: item.albumId
      });
    }
  }

  return gaps.filter(gap => gap.officialStaleIds.length || gap.heosExtraRows.length).map(gap => ({
    ...gap,
    countsMatch: gap.officialStaleIds.length === gap.heosExtraRows.length,
    structuralPairs: gap.officialStaleIds.length === gap.heosExtraRows.length
      ? gap.officialStaleIds.map((staleId, index) => ({ staleOfficialId: staleId, heosReplacementCandidate: gap.heosExtraRows[index] }))
      : []
  }));
}

async function main() {
  console.log('READ-ONLY Favourite Tracks shared-anchor alignment probe');
  console.log(`Gap detail limit: ${DETAIL_LIMIT}`);
  const accessToken = await getAccessToken();
  const [official, heosTracks] = await Promise.all([getAllOfficialFavouriteTrackIds(accessToken), getAllHeosFavouriteTracks()]);
  const officialIds = official.ids;
  const heosIds = heosTracks.map(item => item.mid);
  const heosSet = new Set(heosIds);
  const officialLive = officialIds.filter(id => heosSet.has(id));
  const heosUnique = uniqueInOrder(heosIds);
  const dedupedSameOrder = officialLive.length === heosUnique.length && officialLive.every((id, index) => id === heosUnique[index]);
  if (!dedupedSameOrder) throw new Error('Cannot perform anchor-gap alignment because de-duplicated anchor order differs');
  const gaps = buildAnchorGaps(officialIds, heosTracks);
  const officialStaleTotal = officialIds.filter(id => !heosSet.has(id)).length;
  const heosExcessTotal = heosIds.length - new Set(heosIds).size;
  const gapOfficialTotal = gaps.reduce((sum, gap) => sum + gap.officialStaleIds.length, 0);
  const gapHeosTotal = gaps.reduce((sum, gap) => sum + gap.heosExtraRows.length, 0);
  const matchedGapCount = gaps.filter(gap => gap.countsMatch).length;
  const unmatchedGaps = gaps.filter(gap => !gap.countsMatch);
  const exactStructuralAlignment = officialStaleTotal === heosExcessTotal && gapOfficialTotal === officialStaleTotal && gapHeosTotal === heosExcessTotal && unmatchedGaps.length === 0;

  console.log('\nSUMMARY');
  console.log(JSON.stringify({
    officialTrackCount: officialIds.length,
    heosTrackCount: heosIds.length,
    sharedUniqueTrackCount: officialLive.length,
    officialStaleTotal,
    heosExcessDuplicateTotal: heosExcessTotal,
    dedupedSameOrder,
    nonEmptyGapCount: gaps.length,
    matchedGapCount,
    unmatchedGapCount: unmatchedGaps.length,
    gapOfficialStaleTotal: gapOfficialTotal,
    gapHeosExtraTotal: gapHeosTotal,
    exactStructuralAlignment
  }, null, 2));

  console.log('\nANCHOR GAPS');
  console.log(JSON.stringify(gaps.slice(0, DETAIL_LIMIT), null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

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
const SAMPLE_LIMIT = Math.min(20, Math.max(1, Number(process.argv[2]) || 12));

function parseEnvFile(pathname) {
  const values = {};
  const text = fs.readFileSync(pathname, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

async function tidalGet(accessToken, path) {
  const response = await fetch(API_BASE + path, {
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

function resourceKey(resource) {
  return `${String(resource?.type || '')}:${String(resource?.id || '')}`;
}

function relationshipItems(relationship) {
  const data = relationship?.data;
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function buildResourceMap(payload) {
  const map = new Map();
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const included = Array.isArray(payload?.included) ? payload.included : [];
  for (const resource of [...data, ...included]) {
    if (resource?.type && resource?.id) map.set(resourceKey(resource), resource);
  }
  return map;
}

function compactOfficialTrack(payload) {
  const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
  if (!root || root.type !== 'tracks') return null;
  const resources = buildResourceMap(payload);
  const artistLink = relationshipItems(root.relationships?.artists)[0] || null;
  const albumLink = relationshipItems(root.relationships?.albums)[0] || null;
  const artist = artistLink ? resources.get(resourceKey(artistLink)) : null;
  const album = albumLink ? resources.get(resourceKey(albumLink)) : null;
  return {
    id: String(root.id || ''),
    title: String(root.attributes?.title || ''),
    artist: String(artist?.attributes?.name || ''),
    artistId: artist?.id ? String(artist.id) : '',
    album: String(album?.attributes?.title || ''),
    albumId: album?.id ? String(album.id) : '',
    isrc: String(root.attributes?.isrc || ''),
    duration: String(root.attributes?.duration || ''),
    explicit: Boolean(root.attributes?.explicit)
  };
}

async function getOfficialSample(accessToken) {
  const collection = await tidalGet(
    accessToken,
    '/userCollectionTracks/me?include=items&countryCode=' + encodeURIComponent(COUNTRY_CODE)
  );
  const includedTracks = (Array.isArray(collection?.included) ? collection.included : [])
    .filter(item => item?.type === 'tracks' && /^\d+$/.test(String(item.id || '')));
  const ids = includedTracks.slice(0, SAMPLE_LIMIT).map(item => String(item.id));
  if (!ids.length) {
    throw new Error('Official Favourite Tracks collection returned no included track IDs');
  }

  const tracks = [];
  for (let index = 0; index < ids.length; index += 1) {
    if (index) await new Promise(resolve => setTimeout(resolve, 1000));
    const payload = await tidalGet(
      accessToken,
      '/tracks/' + encodeURIComponent(ids[index]) +
      '?include=' + encodeURIComponent('artists,albums,albums.coverArt') +
      '&countryCode=' + encodeURIComponent(COUNTRY_CODE)
    );
    const track = compactOfficialTrack(payload);
    if (track) tracks.push(track);
  }

  return {
    collectionIncludedTracks: includedTracks.length,
    tracks
  };
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

  return items.map(item => ({
    mid: String(item.mid || ''),
    title: String(item.name || ''),
    artist: String(item.artist || ''),
    album: String(item.album || ''),
    albumId: String(item.album_id || ''),
    imageUrl: String(item.image_url || '')
  }));
}

function normalise(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compareTrack(track, heosTracks) {
  const exactMid = heosTracks.filter(item => item.mid === track.id);
  const titleArtist = heosTracks.filter(item =>
    normalise(item.title) === normalise(track.title) &&
    normalise(item.artist) === normalise(track.artist)
  );
  const titleArtistAlbumId = titleArtist.filter(item =>
    item.albumId && track.albumId && item.albumId === track.albumId
  );

  return {
    official: track,
    exactMidCount: exactMid.length,
    exactMid: exactMid.slice(0, 3),
    titleArtistCount: titleArtist.length,
    titleArtist: titleArtist.slice(0, 5),
    titleArtistAlbumIdCount: titleArtistAlbumId.length,
    titleArtistAlbumId: titleArtistAlbumId.slice(0, 5)
  };
}

async function main() {
  console.log('READ-ONLY Favourite Tracks correlation probe');
  console.log(`Sample size: ${SAMPLE_LIMIT}`);

  const accessToken = await getAccessToken();
  const [official, heosTracks] = await Promise.all([
    getOfficialSample(accessToken),
    getAllHeosFavouriteTracks()
  ]);

  const comparisons = official.tracks.map(track => compareTrack(track, heosTracks));
  const summary = {
    officialIncludedTracksFirstPage: official.collectionIncludedTracks,
    officialSampleCount: official.tracks.length,
    heosFavouriteTrackCount: heosTracks.length,
    exactMidMatches: comparisons.filter(item => item.exactMidCount === 1).length,
    uniqueTitleArtistMatches: comparisons.filter(item => item.titleArtistCount === 1).length,
    uniqueTitleArtistAlbumIdMatches: comparisons.filter(item => item.titleArtistAlbumIdCount === 1).length,
    ambiguousTitleArtistMatches: comparisons.filter(item => item.titleArtistCount > 1).length,
    noTitleArtistMatch: comparisons.filter(item => item.titleArtistCount === 0).length
  };

  console.log('\nSUMMARY');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nCOMPARISONS');
  console.log(JSON.stringify(comparisons, null, 2));
}

main().catch(error => {
  console.error('PROBE FAILED:', error.message);
  process.exitCode = 1;
});

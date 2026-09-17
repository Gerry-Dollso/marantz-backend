'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.MARANTZ_BACKEND_URL || 'http://127.0.0.1:3100';
const STATE_FILE = process.env.ARTIST_WARM_STATE || '/var/lib/marantz-backend/artist-cache-warm-state.json';
const PAUSE_MS = Number(process.env.ARTIST_WARM_PAUSE_MS || 1500);
const LIMIT = Math.max(0, Number(process.argv[2] || 0));

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getJson(route, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BASE_URL + route, { signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${response.status}: non-JSON response`); }
    if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return { version: 1, completed: {}, failures: {}, startedAt: new Date().toISOString() }; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, STATE_FILE);
}

async function favouriteArtists() {
  const body = await getJson('/api/tidal/favourite-artists', 120000);
  const artists = Array.isArray(body.artists) ? body.artists : [];
  return artists.map(item => ({ id: String(item.id || '').trim(), name: String(item.name || '').trim() }))
    .filter(item => /^\d+$/.test(item.id));
}

async function timed(label, route) {
  const started = Date.now();
  const body = await getJson(route, 180000);
  return { label, ms: Date.now() - started, body };
}

async function warmArtist(artist) {
  const id = encodeURIComponent(artist.id);
  const started = Date.now();
  const core = await timed('details', `/api/tidal/artist-details?id=${id}&refresh=1`);
  await sleep(PAUSE_MS);
  const top = await timed('topTracks', `/api/tidal/artist-top-tracks?id=${id}&refresh=1`);
  await sleep(PAUSE_MS);
  const bio = await timed('biography', `/api/tidal/artist-biography?id=${id}&refresh=1`);
  return {
    id: artist.id,
    name: core.body?.artist?.name || artist.name,
    totalMs: Date.now() - started,
    detailsMs: core.ms,
    topTracksMs: top.ms,
    biographyMs: bio.ms,
    topTrackCount: Array.isArray(top.body?.tracks) ? top.body.tracks.length : 0,
    biographyFound: Boolean(bio.body?.biography?.text || bio.body?.biography?.teaser),
    completedAt: new Date().toISOString()
  };
}

async function main() {
  const artists = await favouriteArtists();
  if (!artists.length) throw new Error('Favourite artist list is empty');
  const state = readState();
  state.artistCount = artists.length;
  const pending = artists.filter(artist => !state.completed[artist.id]);
  const queue = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  console.log(`[Artist cache warmer] favourites=${artists.length} alreadyComplete=${artists.length - pending.length} thisRun=${queue.length}`);

  for (let index = 0; index < queue.length; index += 1) {
    const artist = queue[index];
    const ordinal = artists.findIndex(item => item.id === artist.id) + 1;
    console.log(`[Artist cache warmer] START ${ordinal}/${artists.length} ${artist.name} (${artist.id})`);
    try {
      const result = await warmArtist(artist);
      state.completed[artist.id] = result;
      delete state.failures[artist.id];
      writeState(state);
      console.log(`[Artist cache warmer] DONE ${ordinal}/${artists.length} ${result.name} total=${(result.totalMs / 1000).toFixed(1)}s details=${(result.detailsMs / 1000).toFixed(1)}s top=${(result.topTracksMs / 1000).toFixed(1)}s bio=${(result.biographyMs / 1000).toFixed(1)}s tracks=${result.topTrackCount} bioFound=${result.biographyFound}`);
    } catch (error) {
      state.failures[artist.id] = { id: artist.id, name: artist.name, error: error.message, failedAt: new Date().toISOString() };
      writeState(state);
      console.error(`[Artist cache warmer] FAIL ${ordinal}/${artists.length} ${artist.name} (${artist.id}): ${error.message}`);
    }
    if (index + 1 < queue.length) await sleep(PAUSE_MS);
  }

  const results = Object.values(state.completed);
  const averageMs = results.length ? results.reduce((sum, item) => sum + Number(item.totalMs || 0), 0) / results.length : 0;
  const remaining = Math.max(0, artists.length - results.length);
  console.log(`[Artist cache warmer] SUMMARY complete=${results.length}/${artists.length} failures=${Object.keys(state.failures).length} average=${(averageMs / 1000).toFixed(1)}s estimatedRemaining=${((remaining * (averageMs + PAUSE_MS)) / 60000).toFixed(1)}m`);
}

main().catch(error => { console.error('[Artist cache warmer] FATAL:', error.message); process.exitCode = 1; });

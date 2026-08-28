'use strict';

// Read-only reconnaissance for mapping official TIDAL recommendation tracks
// to the HEOS TIDAL catalogue. This script NEVER sends player commands and
// NEVER calls browse/add_to_queue.

const fs = require('fs');
const net = require('net');

const BACKEND_URL = 'http://127.0.0.1:3100/api/tidal/oauth/probe-recommendation-resolution-batch';
const HEOS_HOST = '192.168.50.220';
const HEOS_PORT = 1255;
const TIDAL_SID = '10';
const OUTPUT_FILE = '/tmp/tidal-heos-resolution.json';

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(value) {
  return normalise(value)
    .replace(/\b(deluxe|expanded|remaster(?:ed)?|anniversary|edition|bonus|explicit)\b.*$/i, '')
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertReadOnlyHeos(command) {
  const allowed = /^heos:\/\/browse\/(browse|search)\?/;
  if (!allowed.test(command)) {
    throw new Error('Refusing non-read-only HEOS command: ' + command);
  }
  if (/add_to_queue|player\//i.test(command)) {
    throw new Error('Refusing playback-changing HEOS command: ' + command);
  }
}

function heosBrowse(command, timeoutMs = 8000) {
  assertReadOnlyHeos(command);

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
    socket.on('timeout', () => finish(new Error('HEOS timeout')));
    socket.on('error', finish);
    socket.on('close', () => {
      if (!finished) finish(new Error('HEOS connection closed'));
    });
  });
}

function relationIds(resource, key) {
  const data = resource?.relationships?.[key]?.data;
  if (Array.isArray(data)) return data.map(item => String(item?.id || '')).filter(Boolean);
  if (data?.id) return [String(data.id)];
  return [];
}

function extractOfficialTrack(item) {
  const payload = item?.metadata || {};
  const root = payload?.data && !Array.isArray(payload.data) ? payload.data : null;
  const included = Array.isArray(payload?.included) ? payload.included : [];
  if (!root) throw new Error('Official TIDAL track payload has no root data');

  const artistIds = relationIds(root, 'artists');
  const albumIds = relationIds(root, 'albums');
  const artist = included.find(resource =>
    resource?.type === 'artists' && artistIds.includes(String(resource.id || ''))
  );
  const album = included.find(resource =>
    resource?.type === 'albums' && albumIds.includes(String(resource.id || ''))
  );

  return {
    source: item.source,
    officialTrackId: String(root.id || item.id || ''),
    title: String(root?.attributes?.title || root?.attributes?.name || ''),
    artistId: String(artist?.id || artistIds[0] || ''),
    artist: String(artist?.attributes?.name || ''),
    albumId: String(album?.id || albumIds[0] || ''),
    album: String(album?.attributes?.title || album?.attributes?.name || ''),
    isrc: String(root?.attributes?.isrc || ''),
    duration: String(root?.attributes?.duration || '')
  };
}

function trackMatches(item, target) {
  if (!item?.mid || item.playable !== 'yes') return false;
  if (normalise(item.name) !== normalise(target.title)) return false;
  if (target.artist && item.artist && normalise(item.artist) !== normalise(target.artist)) return false;
  return true;
}

function summariseTracks(tracks) {
  return tracks
    .filter(item => item?.mid)
    .slice(0, 30)
    .map(item => ({
      name: String(item.name || ''),
      artist: String(item.artist || ''),
      album: String(item.album || ''),
      mid: String(item.mid || ''),
      playable: item.playable === 'yes'
    }));
}

function albumTitleScore(candidate, target) {
  const a = normalise(candidate);
  const b = normalise(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = baseTitle(candidate);
  const bb = baseTitle(target);
  if (aa && bb && aa === bb) return 0.9;
  return 0;
}

function chooseTrack(matches, target) {
  if (matches.length === 1) return { match: matches[0], method: 'exact-title' };
  if (matches.length > 1 && target.officialTrackId) {
    const sameMid = matches.filter(item => String(item.mid || '') === target.officialTrackId);
    if (sameMid.length === 1) return { match: sameMid[0], method: 'official-mid' };
  }
  return null;
}

const artistCache = new Map();
const artistAlbumsCache = new Map();

async function resolveArtistCid(target, evidence) {
  if (target.artistId) {
    const directCid = 'LIBARTIST-' + target.artistId;
    try {
      const root = await heosBrowse(
        'heos://browse/browse?sid=' + TIDAL_SID + '&cid=' + encodeURIComponent(directCid)
      );
      const payload = root.payload || [];
      if (payload.length) {
        evidence.push({ stage: 'direct-artist-id', cid: directCid, items: payload.length });
        return { name: target.artist, cid: directCid, method: 'direct-artist-id' };
      }
      evidence.push({ stage: 'direct-artist-id', cid: directCid, items: 0 });
    } catch (error) {
      evidence.push({ stage: 'direct-artist-id', cid: directCid, error: error.message });
    }
  }

  const key = normalise(target.artist);
  if (artistCache.has(key)) return artistCache.get(key);

  const response = await heosBrowse(
    'heos://browse/search?sid=' + TIDAL_SID + '&scid=1&search=' + encodeURIComponent(target.artist)
  );
  const exact = (response.payload || [])
    .filter(item => item.cid && normalise(item.name) === key)
    .map(item => ({ name: String(item.name || ''), cid: String(item.cid), method: 'exact-artist-search' }));
  const unique = [...new Map(exact.map(item => [item.cid, item])).values()];
  const result = unique.length === 1 ? unique[0] : null;
  artistCache.set(key, result);
  if (result) evidence.push({ stage: 'artist-search', name: result.name, cid: result.cid });
  return result;
}

async function browseAlbumTracks(cid) {
  const response = await heosBrowse(
    'heos://browse/browse?sid=' + TIDAL_SID + '&cid=' + encodeURIComponent(cid)
  );
  return response.payload || [];
}

async function getArtistAlbumCandidates(artistCid) {
  if (artistAlbumsCache.has(artistCid)) return artistAlbumsCache.get(artistCid);

  const artistId = String(artistCid).replace(/^LIBARTIST-/, '');
  const categoryCids = new Set(['LIBARTIST-Albums-' + artistId]);

  try {
    const root = await heosBrowse(
      'heos://browse/browse?sid=' + TIDAL_SID + '&cid=' + encodeURIComponent(artistCid)
    );
    for (const item of root.payload || []) {
      const name = normalise(item.name);
      if (item.cid && /(album|single|ep)/.test(name)) categoryCids.add(String(item.cid));
    }
  } catch {
    // The known Albums container remains as the conservative fallback.
  }

  const albums = [];
  const seen = new Set();
  for (const categoryCid of categoryCids) {
    try {
      const response = await heosBrowse(
        'heos://browse/browse?sid=' + TIDAL_SID + '&cid=' + encodeURIComponent(categoryCid)
      );
      for (const item of response.payload || []) {
        if (!item.cid || seen.has(String(item.cid))) continue;
        seen.add(String(item.cid));
        albums.push({
          name: String(item.name || ''),
          artist: String(item.artist || ''),
          cid: String(item.cid),
          playable: item.playable === 'yes'
        });
      }
    } catch {
      // Some artist categories may be unsupported/empty; continue read-only recon.
    }
    await sleep(80);
  }

  artistAlbumsCache.set(artistCid, albums);
  return albums;
}

async function resolveOne(target) {
  const evidence = [];

  if (target.albumId) {
    const directCid = 'LIBALBUM-' + target.albumId;
    try {
      const tracks = await browseAlbumTracks(directCid);
      const matches = tracks.filter(item => trackMatches(item, target));
      evidence.push({
        stage: 'direct-album-id',
        cid: directCid,
        tracks: tracks.length,
        matches: matches.length,
        trackList: matches.length === 1 ? undefined : summariseTracks(tracks)
      });
      const chosen = chooseTrack(matches, target);
      if (chosen) {
        return {
          status: 'resolved',
          method: chosen.method === 'official-mid' ? 'direct-album-id+official-mid' : 'direct-album-id',
          confidence: 'exact',
          cid: directCid,
          mid: String(chosen.match.mid),
          heosAlbum: String(chosen.match.album || target.album || ''),
          evidence
        };
      }
    } catch (error) {
      evidence.push({ stage: 'direct-album-id', cid: directCid, error: error.message });
    }
  }

  if (!target.artist) {
    return { status: 'unresolved', reason: 'official metadata has no artist name', evidence };
  }

  const artist = await resolveArtistCid(target, evidence);
  if (!artist) {
    return { status: 'unresolved', reason: 'no safe HEOS artist resolution', evidence };
  }

  const albums = await getArtistAlbumCandidates(artist.cid);
  const ranked = albums
    .map(album => ({ ...album, score: albumTitleScore(album.name, target.album) }))
    .filter(album => album.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    evidence.push({
      stage: 'artist-album-list',
      artistCid: artist.cid,
      albums: albums.slice(0, 80).map(item => ({ name: item.name, cid: item.cid }))
    });
    return { status: 'unresolved', reason: 'no HEOS album-title candidate', evidence };
  }

  const bestScore = ranked[0].score;
  const candidates = ranked.filter(album => album.score === bestScore);
  const matches = [];

  for (const album of candidates) {
    try {
      const tracks = await browseAlbumTracks(album.cid);
      const trackMatchesInAlbum = tracks.filter(item => trackMatches(item, target));
      evidence.push({
        stage: 'artist-album',
        album: album.name,
        cid: album.cid,
        score: album.score,
        tracks: tracks.length,
        matches: trackMatchesInAlbum.length,
        trackList: trackMatchesInAlbum.length === 1 ? undefined : summariseTracks(tracks)
      });
      for (const track of trackMatchesInAlbum) {
        matches.push({ album, track });
      }
    } catch (error) {
      evidence.push({ stage: 'artist-album', album: album.name, cid: album.cid, error: error.message });
    }
    await sleep(80);
  }

  const unique = [...new Map(matches.map(match => [match.album.cid + '|' + match.track.mid, match])).values()];
  if (unique.length === 1) {
    const match = unique[0];
    return {
      status: 'resolved',
      method: 'artist-album-track',
      confidence: match.album.score === 1 ? 'exact' : 'edition-normalised',
      cid: match.album.cid,
      mid: String(match.track.mid),
      heosAlbum: match.album.name,
      evidence
    };
  }

  if (unique.length > 1) {
    const sameMid = unique.filter(match => String(match.track.mid || '') === target.officialTrackId);
    if (sameMid.length === 1) {
      const match = sameMid[0];
      return {
        status: 'resolved',
        method: 'artist-album-track+official-mid',
        confidence: 'exact',
        cid: match.album.cid,
        mid: String(match.track.mid),
        heosAlbum: match.album.name,
        evidence
      };
    }
    return {
      status: 'ambiguous',
      reason: 'multiple HEOS album/track matches',
      candidates: unique.map(match => ({
        cid: match.album.cid,
        mid: String(match.track.mid),
        album: match.album.name
      })),
      evidence
    };
  }

  return { status: 'unresolved', reason: 'album candidates did not contain an exact track match', evidence };
}

async function main() {
  const response = await fetch(BACKEND_URL);
  const batch = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(batch.tracks)) {
    throw new Error(batch.error || ('Metadata batch HTTP ' + response.status));
  }

  const results = [];
  for (let i = 0; i < batch.tracks.length; i += 1) {
    const item = batch.tracks[i];
    if (!item.ok) {
      results.push({ source: item.source, id: item.id, status: 'metadata-error', reason: item.error || 'metadata failed' });
      continue;
    }

    let target;
    try {
      target = extractOfficialTrack(item);
      const resolution = await resolveOne(target);
      const result = { ...target, ...resolution };
      results.push(result);
      console.log(
        String(i + 1).padStart(2, '0') + '/' + batch.tracks.length,
        '|', target.source,
        '|', target.title,
        '|', target.artist,
        '|', resolution.status,
        '|', resolution.method || resolution.reason || ''
      );
    } catch (error) {
      results.push({ source: item.source, id: item.id, status: 'error', reason: error.message });
      console.log(String(i + 1).padStart(2, '0') + '/' + batch.tracks.length, '|', item.source, '|', item.id, '| ERROR |', error.message);
    }
    await sleep(100);
  }

  const summary = {
    total: results.length,
    resolved: results.filter(item => item.status === 'resolved').length,
    ambiguous: results.filter(item => item.status === 'ambiguous').length,
    unresolved: results.filter(item => item.status === 'unresolved').length,
    errors: results.filter(item => !['resolved', 'ambiguous', 'unresolved'].includes(item.status)).length
  };

  const output = { generatedAt: new Date().toISOString(), summary, results };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log('SUMMARY', JSON.stringify(summary));
  console.log('DETAILS', OUTPUT_FILE);
}

main().catch(error => {
  console.error('FATAL', error.message);
  process.exitCode = 1;
});

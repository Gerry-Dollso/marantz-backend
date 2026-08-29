'use strict';

const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(targetPath, 'utf8');

function replaceExactlyOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(label + ': anchor not found');
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(label + ': anchor is not unique');
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const playlistFunctionAnchor = `  async function probeRawPlaylist(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    return apiGetRaw(
      '/playlists/' + encodeURIComponent(id) +
      '?include=items&countryCode=' + encodeURIComponent(countryCode)
    );
  }
`;

const playlistFunctionReplacement = playlistFunctionAnchor + `
  async function probePlaylistReplaceMedia(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    return apiGetRaw(
      '/playlists/' + encodeURIComponent(id) +
      '?include=' + encodeURIComponent('items,items.tracks:artists,items.tracks:albums.coverArt') +
      '&replaceMedia=' + encodeURIComponent('items') +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }
`;

replaceExactlyOnce(
  'playlist replaceMedia function',
  playlistFunctionAnchor,
  playlistFunctionReplacement
);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-track-replacement') {
      try {
        const trackId = requestUrl.searchParams.get('id') || '';
        const track = await probeTrackReplacement(trackId);
        return sendJson(res, 200, { ok: true, track });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

const routeReplacement = routeAnchor + `
    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlist-replacements') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const playlist = await probePlaylistReplaceMedia(playlistId);
        return sendJson(res, 200, { ok: true, playlist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }
`;

replaceExactlyOnce(
  'playlist replaceMedia route',
  routeAnchor,
  routeReplacement
);

fs.writeFileSync(targetPath, source);
console.log('Added read-only TIDAL playlist replaceMedia probe.');

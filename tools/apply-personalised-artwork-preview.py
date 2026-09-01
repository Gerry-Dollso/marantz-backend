#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'tidal-user-auth-recon.js'
source = path.read_text()

replacements = [
    (
        '  const personalisedPlaylistCache = new Map();\n',
        '  const personalisedPlaylistCache = new Map();\n'
        '  const personalisedArtworkCache = new Map();\n'
    ),
    (
        '  const PERSONALISED_PLAYLIST_TTL_MS = 5 * 60 * 1000;\n',
        '  const PERSONALISED_PLAYLIST_TTL_MS = 5 * 60 * 1000;\n'
        '  const PERSONALISED_ARTWORK_TTL_MS = 30 * 60 * 1000;\n'
    ),
    (
        '  async function getPersonalisedPlaylist(playlistId) {\n',
        '''  async function getPersonalisedArtwork(playlistId) {
    const id = String(playlistId || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error('Playlist id must be alphanumeric');
    }

    const cached = personalisedArtworkCache.get(id);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.value, cached: true };
    }

    const fullCached = personalisedPlaylistCache.get(id);
    if (fullCached && Date.now() < fullCached.expiresAt) {
      const artwork = [];
      for (const track of fullCached.value?.tracks || []) {
        const url = String(track?.artwork || '').trim();
        if (!url || artwork.includes(url)) continue;
        artwork.push(url);
        if (artwork.length === 4) break;
      }
      const value = {
        playlist: {
          id: String(fullCached.value?.playlist?.id || id),
          name: String(fullCached.value?.playlist?.name || '')
        },
        artwork
      };
      personalisedArtworkCache.set(id, {
        value,
        expiresAt: Date.now() + PERSONALISED_ARTWORK_TTL_MS
      });
      return { ...value, cached: true };
    }

    const first = await probePlaylistArtworkAndPage(id, '');
    const root = first?.data && !Array.isArray(first.data) ? first.data : null;
    if (!root || root.type !== 'playlists') {
      throw new Error('TIDAL playlist response did not contain a playlist resource');
    }

    const resources = buildResourceMap(
      Array.isArray(first.included) ? first.included : []
    );
    const artwork = [];
    for (const linkage of relationshipItems(root.relationships?.items)) {
      const url = String(compactTrack(linkage, resources)?.artwork || '').trim();
      if (!url || artwork.includes(url)) continue;
      artwork.push(url);
      if (artwork.length === 4) break;
    }

    const value = {
      playlist: {
        id: String(root.id),
        name: playlistName(root)
      },
      artwork
    };
    personalisedArtworkCache.set(id, {
      value,
      expiresAt: Date.now() + PERSONALISED_ARTWORK_TTL_MS
    });
    if (personalisedArtworkCache.size > 16) {
      const oldestKey = personalisedArtworkCache.keys().next().value;
      personalisedArtworkCache.delete(oldestKey);
    }
    return { ...value, cached: false };
  }

  async function getPersonalisedPlaylist(playlistId) {
'''
    ),
    (
        "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/personalised/playlist') {\n",
        '''    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/personalised/artwork') {
      try {
        const playlistId = requestUrl.searchParams.get('id') || '';
        const personalised = await getPersonalisedArtwork(playlistId);
        return sendJson(res, 200, { ok: true, ...personalised });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/personalised/playlist') {
'''
    )
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one anchor, found {count}: {old!r}')
    source = source.replace(old, new, 1)

path.write_text(source)
print('Applied personalised artwork preview migration')

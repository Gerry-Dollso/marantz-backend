'use strict';

const TOKEN_URL = 'https://login.tidal.com/oauth2/token';
const API_BASE = 'https://openapi.tidal.com/v2';
const DEFAULT_ARTIST_ID = '64520';

async function apiGet(path, accessToken) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.api+json'
    }
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  const clientId = String(process.env.TIDAL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.TIDAL_CLIENT_SECRET || '').trim();
  const artistId = String(process.argv[2] || DEFAULT_ARTIST_ID).trim();

  if (!clientId || !clientSecret) {
    throw new Error('TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET are not available in this process');
  }
  if (!/^\d+$/.test(artistId)) {
    throw new Error('Artist ID must be numeric');
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(`Token request failed: ${tokenPayload.error_description || tokenPayload.error || `HTTP ${tokenResponse.status}`}`);
  }

  const radio = await apiGet(
    `/artists/${encodeURIComponent(artistId)}/relationships/radio?countryCode=GB`,
    tokenPayload.access_token
  );

  if (!radio.response.ok) {
    const detail = radio.payload?.errors?.[0]?.detail || radio.payload?.detail || `HTTP ${radio.response.status}`;
    throw new Error(`Artist radio relationship failed: ${detail}`);
  }

  const playlistRef = Array.isArray(radio.payload?.data)
    ? radio.payload.data.find(item => item?.type === 'playlists' && item?.id)
    : null;

  if (!playlistRef) {
    throw new Error('Artist radio relationship did not return a playlist');
  }

  const playlist = await apiGet(
    `/playlists/${encodeURIComponent(playlistRef.id)}?countryCode=GB&include=items`,
    tokenPayload.access_token
  );

  const included = Array.isArray(playlist.payload?.included) ? playlist.payload.included : [];
  const includedTracks = included
    .filter(item => item?.type === 'tracks')
    .map(item => ({
      id: String(item?.id || ''),
      title: String(item?.attributes?.title || item?.attributes?.name || '')
    }))
    .filter(item => item.id);

  const itemRelationship = Array.isArray(playlist.payload?.data?.relationships?.items?.data)
    ? playlist.payload.data.relationships.items.data
    : [];

  const safeSummary = {
    artistId,
    radio: {
      httpStatus: radio.response.status,
      playlistId: String(playlistRef.id)
    },
    playlist: {
      httpStatus: playlist.response.status,
      ok: playlist.response.ok,
      name: String(playlist.payload?.data?.attributes?.name || playlist.payload?.data?.attributes?.title || ''),
      relationshipItemCount: itemRelationship.length,
      includedTrackCount: includedTracks.length,
      firstTracks: includedTracks.slice(0, 10),
      errors: playlist.payload?.errors || null,
      links: playlist.payload?.links || null
    }
  };

  console.log(JSON.stringify(safeSummary, null, 2));
  if (!playlist.response.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(`TIDAL artist radio probe failed: ${error.message}`);
  process.exitCode = 1;
});

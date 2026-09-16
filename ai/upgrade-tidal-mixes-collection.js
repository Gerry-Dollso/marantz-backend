'use strict';

const fs = require('fs');

const path = 'tidal-user-auth-recon.js';
const source = fs.readFileSync(path, 'utf8');
const startMarker = '  async function getPersonalisedRecommendations() {';
const endMarker = '  async function getPersonalisedArtwork(playlistId) {';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0 || end <= start) {
  throw new Error('Could not locate personalised recommendations function boundaries');
}

const replacement = `  async function getPersonalisedRecommendations() {
    if (personalisedRecommendationsCache.value && Date.now() < personalisedRecommendationsCache.expiresAt) {
      return { ...personalisedRecommendationsCache.value, cached: true };
    }

    // TIDAL's saved playlist collection is the canonical source for the
    // Mixes & Radio shelf. Artist Radio, Track Radio, History mixes, My Mixes
    // and My New Arrivals are all playlist resources with playlistType MIX.
    const relationship = await getFavouritePlaylistReferenceIds();
    const metadata = await getPlaylistMetadata(relationship.ids);
    const playlists = metadata.items
      .filter(item => item.playlistType === 'MIX')
      .map(item => ({
        id: item.id,
        name: item.name,
        kind: 'mix',
        description: '',
        artwork: item.artwork || null
      }));

    const value = {
      playlists,
      referenceCount: relationship.ids.length,
      mixCount: playlists.length,
      relationshipPages: relationship.pages,
      metadataBatches: metadata.metadataBatches,
      unresolvedIds: metadata.unresolvedIds
    };
    personalisedRecommendationsCache.value = value;
    personalisedRecommendationsCache.expiresAt = Date.now() + PERSONALISED_RECOMMENDATIONS_TTL_MS;
    return { ...value, cached: false };
  }

`;

const updated = source.slice(0, start) + replacement + source.slice(end);
if (updated === source) throw new Error('No source change produced');
fs.writeFileSync(path, updated);
console.log('Updated Mixes & Radio to use saved TIDAL MIX playlists.');

'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldMarker = `  async function probeRecommendations() {\n    const resources = [`;
if (!source.includes(oldMarker)) {
  console.error('Refusing to edit: recommendation probe marker not found or already changed');
  process.exit(1);
}

const insertBefore = `\n  async function handle(req, res) {`;
if (!source.includes(insertBefore)) {
  console.error('Refusing to edit: handle marker not found');
  process.exit(1);
}

const helper = `
  async function probePersonalisedPlaylists() {
    const recommendationSets = await probeRecommendations();
    const selected = [];

    const addPlaylist = (label, item) => {
      if (!item?.id || item.type !== 'playlists') return;
      selected.push({ label, id: item.id, name: item.name || label });
    };

    const mixes = recommendationSets.dailyMixes?.included || [];
    addPlaylist('My Mix 1', mixes.find(item => item.name === 'My Mix 1'));
    addPlaylist('My Daily Discovery', recommendationSets.dailyDiscovery?.included?.[0]);
    addPlaylist('My New Arrivals', recommendationSets.newArrivals?.included?.[0]);

    const results = {};
    for (const playlist of selected) {
      try {
        results[playlist.label] = {
          playlistId: playlist.id,
          playlistName: playlist.name,
          ok: true,
          ...(await apiGet(
            '/playlists/' + encodeURIComponent(playlist.id) +
            '?include=items&countryCode=' + encodeURIComponent(countryCode)
          ))
        };
      } catch (error) {
        results[playlist.label] = {
          playlistId: playlist.id,
          playlistName: playlist.name,
          ok: false,
          error: error.message
        };
      }
    }

    return {
      discoveredCount: selected.length,
      playlists: results
    };
  }
`;
source = source.replace(insertBefore, helper + insertBefore);

const oldRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe') {`;
const newRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {
      try {
        const personalisedPlaylists = await probePersonalisedPlaylists();
        return sendJson(res, 200, {
          ok: true,
          personalisedPlaylists
        });
      } catch (error) {
        return sendJson(res, 401, {
          ok: false,
          error: error.message
        });
      }
    }

${oldRoute}`;
if (!source.includes(oldRoute)) {
  console.error('Refusing to edit: probe route marker not found');
  process.exit(1);
}
source = source.replace(oldRoute, newRoute);

fs.writeFileSync(target, source);
console.log('Extended: added read-only personalised playlist-content probe');

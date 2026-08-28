'use strict';

const fs = require('fs');
const path = require('path');

const reconFile = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
const serverFile = path.join(__dirname, '..', 'server.js');

let recon = fs.readFileSync(reconFile, 'utf8');
let server = fs.readFileSync(serverFile, 'utf8');

const exportMarker = `  return {
    handle,
    getTrackMetadata: probeTrackMetadata
  };`;
const updatedExport = `  return {
    handle,
    getTrackMetadata: probeTrackMetadata,
    getPersonalisedPlaylist
  };`;

if (!recon.includes('getPersonalisedPlaylist\n  };')) {
  if (!recon.includes(exportMarker)) {
    throw new Error('Expected tidal-user-auth-recon export block not found');
  }
  recon = recon.replace(exportMarker, updatedExport);
}

const routeMarker = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/resolve-track?')) {`;
const routeSignature = `/api/tidal/personalised/playlist/play?`;

if (!server.includes(routeSignature)) {
  if (!server.includes(routeMarker)) {
    throw new Error('Expected resolve-track route marker not found');
  }

  const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/personalised/playlist/play?')) {
    const queueGeneration = supersedeTidalQueueBuild();
    try {
      const pending = tidalFavouriteQueueCommand;
      if (pending) {
        try {
          await pending;
        } catch {
          // The superseded queue build owns/logs its HEOS failure.
        }
      }

      if (!tidalQueueBuildIsCurrent(queueGeneration)) {
        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: 0,
          skipped: 0
        });
      }

      const url = new URL(req.url, 'http://localhost');
      const id = String(url.searchParams.get('id') || '').trim();
      const shuffleValue = String(url.searchParams.get('shuffle') || '0').trim();

      if (!/^[a-zA-Z0-9]+$/.test(id)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid playlist id' });
      }
      if (shuffleValue !== '0' && shuffleValue !== '1') {
        return sendJson(res, 400, { ok: false, error: 'Invalid shuffle value' });
      }

      const shuffle = shuffleValue === '1';
      const personalised = await tidalUserAuthRecon.getPersonalisedPlaylist(id);
      const sourceTracks = Array.isArray(personalised.tracks)
        ? personalised.tracks
        : [];

      if (!sourceTracks.length) {
        return sendJson(res, 409, {
          ok: false,
          error: 'Personalised playlist contains no tracks'
        });
      }

      const queueTracks = sourceTracks.slice();
      if (shuffle) {
        for (let i = queueTracks.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queueTracks[i], queueTracks[j]] = [queueTracks[j], queueTracks[i]];
        }
      }

      const resolvedTracks = [];
      for (let index = 0; index < queueTracks.length; index += 1) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) {
          return sendJson(res, 200, {
            ok: true,
            cancelled: true,
            queued: 0,
            skipped: 0,
            resolved: resolvedTracks.length,
            attempted: queueTracks.length,
            shuffle
          });
        }

        const track = queueTracks[index];
        const target = {
          officialTrackId: String(track.id || ''),
          title: String(track.title || ''),
          artistId: String(track.artistId || ''),
          artist: String(track.artist || ''),
          albumId: String(track.albumId || ''),
          album: String(track.album || ''),
          isrc: String(track.isrc || ''),
          duration: String(track.duration || '')
        };
        const resolution = await tidalHeosResolver.resolveTrack(target);

        if (
          resolution.status !== 'resolved' ||
          !resolution.cid ||
          !resolution.mid
        ) {
          return sendJson(res, 409, {
            ok: false,
            error: 'Playlist track could not be resolved safely for HEOS playback',
            playlist: personalised.playlist,
            index,
            track: target,
            resolution
          });
        }

        resolvedTracks.push({ track: target, resolution });
      }

      if (!tidalQueueBuildIsCurrent(queueGeneration)) {
        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: 0,
          skipped: 0,
          resolved: resolvedTracks.length,
          attempted: resolvedTracks.length,
          shuffle
        });
      }

      let queuedCount = 0;
      let skippedCount = 0;
      let firstMid = '';

      for (const item of resolvedTracks) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) break;

        const aid = queuedCount === 0 ? 4 : 3;
        try {
          const queueCommand = heosBrowse(
            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
            '&sid=10&cid=' + encodeURIComponent(item.resolution.cid) +
            '&mid=' + encodeURIComponent(item.resolution.mid) +
            '&aid=' + aid,
            15000
          );
          tidalFavouriteQueueCommand = queueCommand;
          try {
            await queueCommand;
          } finally {
            if (tidalFavouriteQueueCommand === queueCommand) {
              tidalFavouriteQueueCommand = null;
            }
          }

          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          if (queuedCount === 0) firstMid = String(item.resolution.mid);
          queuedCount += 1;
        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          console.warn(
            'TIDAL RESOLVED PLAYLIST TRACK SKIP:',
            JSON.stringify({
              officialTrackId: item.track.officialTrackId,
              title: item.track.title,
              artist: item.track.artist,
              cid: item.resolution.cid,
              mid: item.resolution.mid,
              error: error.message
            })
          );
        }
      }

      const cancelled = !tidalQueueBuildIsCurrent(queueGeneration);
      if (!queuedCount && !cancelled) {
        throw new Error('No resolved playlist tracks could be queued');
      }

      if (!cancelled) {
        await heosBrowse(
          'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
          '&shuffle=off'
        );
      }

      return sendJson(res, 200, {
        ok: true,
        cancelled,
        playlist: personalised.playlist,
        queued: queuedCount,
        skipped: skippedCount,
        resolved: resolvedTracks.length,
        attempted: resolvedTracks.length,
        shuffle,
        firstMid,
        sourceCached: Boolean(personalised.cached)
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

`;

  server = server.replace(routeMarker, route + routeMarker);
}

fs.writeFileSync(reconFile, recon);
fs.writeFileSync(serverFile, server);
console.log('Added reusable resolved TIDAL personalised playlist queue path');

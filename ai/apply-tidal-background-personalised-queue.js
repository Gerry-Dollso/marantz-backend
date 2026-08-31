'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

const startAnchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/personalised/playlist/play?')) {";
const endAnchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/resolve-track?')) {";

const startCount = source.split(startAnchor).length - 1;
const endCount = source.split(endAnchor).length - 1;

if (startCount !== 1 || endCount !== 1) {
  throw new Error(
    `Expected exactly one personalised-play route and one resolve-track route; found ${startCount} and ${endCount}`
  );
}

const start = source.indexOf(startAnchor);
const end = source.indexOf(endAnchor, start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Could not locate personalised-play route boundaries safely');
}

const replacement = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/personalised/playlist/play?')) {
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

      const makeTarget = track => ({
        officialTrackId: String(track.id || ''),
        title: String(track.title || ''),
        artistId: String(track.artistId || ''),
        artist: String(track.artist || ''),
        albumId: String(track.albumId || ''),
        album: String(track.album || ''),
        isrc: String(track.isrc || ''),
        duration: String(track.duration || '')
      });

      const queueResolvedTrack = async (target, resolution, aid) => {
        const queueCommand = heosBrowse(
          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
          '&sid=10&cid=' + encodeURIComponent(resolution.cid) +
          '&mid=' + encodeURIComponent(resolution.mid) +
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
      };

      const logUnresolvedSkip = (index, target, resolution) => {
        console.warn(
          'TIDAL RESOLVED PLAYLIST UNRESOLVED SKIP:',
          JSON.stringify({
            index,
            officialTrackId: target.officialTrackId,
            title: target.title,
            artist: target.artist,
            status: resolution?.status || 'unknown',
            reason: resolution?.reason || resolution?.trustedContext?.status || ''
          })
        );
      };

      const logQueueSkip = (index, target, resolution, error) => {
        console.warn(
          'TIDAL RESOLVED PLAYLIST TRACK SKIP:',
          JSON.stringify({
            index,
            officialTrackId: target.officialTrackId,
            title: target.title,
            artist: target.artist,
            cid: resolution.cid,
            mid: resolution.mid,
            error: error.message
          })
        );
      };

      let skippedCount = 0;
      let resolvedCount = 0;
      let attemptedCount = 0;
      let firstMid = '';
      let backgroundStartIndex = queueTracks.length;

      for (let index = 0; index < queueTracks.length; index += 1) {
        if (!tidalQueueBuildIsCurrent(queueGeneration)) {
          return sendJson(res, 200, {
            ok: true,
            cancelled: true,
            queued: 0,
            skipped: skippedCount,
            resolved: resolvedCount,
            attempted: attemptedCount,
            shuffle
          });
        }

        const target = makeTarget(queueTracks[index]);
        attemptedCount += 1;
        let resolution;
        try {
          resolution = await tidalHeosTrustedResolver.resolveTrack(target);
        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          console.warn(
            'TIDAL RESOLVED PLAYLIST RESOLUTION SKIP:',
            JSON.stringify({
              index,
              officialTrackId: target.officialTrackId,
              title: target.title,
              artist: target.artist,
              error: error.message
            })
          );
          continue;
        }

        if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
        if (
          resolution.status !== 'resolved' ||
          !resolution.cid ||
          !resolution.mid
        ) {
          skippedCount += 1;
          logUnresolvedSkip(index, target, resolution);
          continue;
        }

        resolvedCount += 1;
        try {
          await queueResolvedTrack(target, resolution, 4);
        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          logQueueSkip(index, target, resolution, error);
          continue;
        }

        if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
        firstMid = String(resolution.mid);
        backgroundStartIndex = index + 1;
        break;
      }

      if (!tidalQueueBuildIsCurrent(queueGeneration)) {
        return sendJson(res, 200, {
          ok: true,
          cancelled: true,
          queued: firstMid ? 1 : 0,
          skipped: skippedCount,
          resolved: resolvedCount,
          attempted: attemptedCount,
          shuffle,
          firstMid
        });
      }

      if (!firstMid) {
        return sendJson(res, 409, {
          ok: false,
          error: 'No personalised playlist track could be resolved safely for HEOS playback',
          playlist: personalised.playlist,
          skipped: skippedCount,
          resolved: resolvedCount,
          attempted: attemptedCount,
          shuffle
        });
      }

      await heosBrowse(
        'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +
        '&shuffle=off'
      );

      const backgroundQueueBuild = async () => {
        let queuedCount = 1;
        let backgroundSkipped = skippedCount;
        let backgroundResolved = resolvedCount;
        let backgroundAttempted = attemptedCount;

        for (let index = backgroundStartIndex; index < queueTracks.length; index += 1) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;

          const target = makeTarget(queueTracks[index]);
          backgroundAttempted += 1;
          let resolution;
          try {
            resolution = await tidalHeosTrustedResolver.resolveTrack(target);
          } catch (error) {
            if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
            backgroundSkipped += 1;
            console.warn(
              'TIDAL RESOLVED PLAYLIST RESOLUTION SKIP:',
              JSON.stringify({
                index,
                officialTrackId: target.officialTrackId,
                title: target.title,
                artist: target.artist,
                error: error.message
              })
            );
            continue;
          }

          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          if (
            resolution.status !== 'resolved' ||
            !resolution.cid ||
            !resolution.mid
          ) {
            backgroundSkipped += 1;
            logUnresolvedSkip(index, target, resolution);
            continue;
          }

          backgroundResolved += 1;
          try {
            await queueResolvedTrack(target, resolution, 3);
          } catch (error) {
            if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
            backgroundSkipped += 1;
            logQueueSkip(index, target, resolution, error);
            continue;
          }

          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          queuedCount += 1;
        }

        console.log(
          'TIDAL RESOLVED PLAYLIST BACKGROUND:',
          JSON.stringify({
            generation: queueGeneration,
            cancelled: !tidalQueueBuildIsCurrent(queueGeneration),
            queued: queuedCount,
            skipped: backgroundSkipped,
            resolved: backgroundResolved,
            attempted: backgroundAttempted,
            total: queueTracks.length,
            shuffle
          })
        );
      };

      if (backgroundStartIndex < queueTracks.length) {
        void backgroundQueueBuild().catch(error => {
          console.warn(
            'TIDAL RESOLVED PLAYLIST BACKGROUND ERROR:',
            JSON.stringify({
              generation: queueGeneration,
              error: error.message
            })
          );
        });
      }

      return sendJson(res, 200, {
        ok: true,
        cancelled: false,
        playlist: personalised.playlist,
        queued: 1,
        skipped: skippedCount,
        resolved: resolvedCount,
        attempted: attemptedCount,
        shuffle,
        firstMid,
        building: backgroundStartIndex < queueTracks.length,
        remaining: Math.max(0, queueTracks.length - backgroundStartIndex),
        sourceCached: Boolean(personalised.cached)
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message });
    }
  }

`;

const updated = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(serverPath, updated);
console.log('Applied guarded background personalised TIDAL queue migration');

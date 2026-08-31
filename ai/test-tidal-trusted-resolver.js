'use strict';

const assert = require('assert');
const {
  createTidalHeosTrustedResolver
} = require('../tidal-heos-trusted-resolver');

function response(command, payload, count = payload.length) {
  return {
    heos: {
      command: 'browse/browse',
      result: 'success',
      message: `count=${count}`
    },
    payload
  };
}

async function main() {
  const candidates = [
    {
      cid: 'LIBALBUM-341262049',
      albumId: '341262049',
      mid: '341262056',
      title: 'Birthday',
      artist: 'The Sugarcubes'
    },
    {
      cid: 'LIBALBUM-526377759',
      albumId: '526377759',
      mid: '526377765',
      title: 'Birthday',
      artist: 'The Sugarcubes'
    }
  ];

  const target = {
    officialTrackId: '34454218',
    title: 'Birthday',
    artist: 'The Sugarcubes',
    album: "Life's Too Good"
  };

  let playlistBrowseCalls = 0;
  let favouritedBrowseCalls = 0;

  const baseResolver = {
    async resolveTrack() {
      return {
        status: 'ambiguous',
        reason: 'multiple HEOS album/track matches',
        candidates
      };
    }
  };

  const heosBrowse = async command => {
    if (command.includes('cid=My Music-Playlists&')) {
      playlistBrowseCalls += 1;
      return response(command, [
        {
          name: 'Created by me',
          cid: 'My Music-Playlists-Created by me',
          container: 'yes'
        },
        {
          name: 'Favorited',
          cid: 'My Music-Playlists-Favorited',
          container: 'yes'
        }
      ]);
    }

    if (command.includes('cid=My Music-Playlists-Created by me&')) {
      playlistBrowseCalls += 1;
      return response(command, [
        {
          name: 'Early Alternative',
          cid: 'LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84',
          container: 'yes',
          type: 'playlist'
        }
      ]);
    }

    if (command.includes('cid=My Music-Playlists-Favorited&')) {
      favouritedBrowseCalls += 1;
      return response(command, []);
    }

    if (command.includes('LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84')) {
      playlistBrowseCalls += 1;
      return response(command, [
        {
          name: 'Birthday',
          artist: 'The Sugarcubes',
          album_id: '341262049',
          mid: '341262056',
          playable: 'yes'
        }
      ]);
    }

    throw new Error(`Unexpected HEOS command: ${command}`);
  };

  const trusted = createTidalHeosTrustedResolver({
    baseResolver,
    heosBrowse,
    sid: '10',
    autoWarm: false,
    refreshIntervalMs: 0
  });

  const cold = await trusted.resolveTrack(target);
  assert.equal(cold.status, 'ambiguous');
  assert.equal(cold.trustedContext.status, 'not-ready');
  assert.equal(playlistBrowseCalls, 0, 'request path must not crawl playlists');

  await trusted.refreshIndex();
  assert.equal(playlistBrowseCalls, 3);
  assert.equal(favouritedBrowseCalls, 0, 'favourited playlists must not be trusted replacement evidence');
  assert.equal(trusted.stats().indexReady, true);
  assert.equal(trusted.stats().indexedPlaylists, 1);

  const first = await trusted.resolveTrack(target);
  assert.equal(first.status, 'resolved');
  assert.equal(first.mid, '341262056');
  assert.equal(first.cid, 'LIBALBUM-341262049');
  assert.equal(first.method, 'trusted-user-playlist-context');
  assert.equal(first.evidence.type, 'heos-user-created-playlist-index');
  assert.equal(
    first.evidence.playlistCid,
    'LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84'
  );
  assert.equal(playlistBrowseCalls, 3, 'indexed request must not browse playlists');

  const second = await trusted.resolveTrack(target);
  assert.equal(second.status, 'resolved');
  assert.equal(second.mid, '341262056');
  assert.equal(second.method, 'trusted-context-cache');
  assert.equal(playlistBrowseCalls, 3, 'trusted cache should avoid playlist browsing');

  const ambiguousTrusted = createTidalHeosTrustedResolver({
    baseResolver,
    autoWarm: false,
    refreshIntervalMs: 0,
    heosBrowse: async command => {
      if (command.includes('cid=My Music-Playlists&')) {
        return response(command, [
          { cid: 'My Music-Playlists-Created by me', container: 'yes' },
          { cid: 'My Music-Playlists-Favorited', container: 'yes' }
        ]);
      }
      if (command.includes('cid=My Music-Playlists-Created by me&')) {
        return response(command, [
          { cid: 'LIBPLAYLIST-one', container: 'yes' },
          { cid: 'LIBPLAYLIST-two', container: 'yes' }
        ]);
      }
      if (command.includes('cid=My Music-Playlists-Favorited&')) {
        throw new Error('Favorited branch must not be scanned');
      }
      if (command.includes('LIBPLAYLIST-one')) {
        return response(command, [{
          name: 'Birthday',
          artist: 'The Sugarcubes',
          album_id: '341262049',
          mid: '341262056',
          playable: 'yes'
        }]);
      }
      if (command.includes('LIBPLAYLIST-two')) {
        return response(command, [{
          name: 'Birthday',
          artist: 'The Sugarcubes',
          album_id: '526377759',
          mid: '526377765',
          playable: 'yes'
        }]);
      }
      throw new Error(`Unexpected HEOS command: ${command}`);
    }
  });

  await ambiguousTrusted.refreshIndex();
  const stillAmbiguous = await ambiguousTrusted.resolveTrack(target);
  assert.equal(stillAmbiguous.status, 'ambiguous');
  assert.equal(stillAmbiguous.trustedContext.status, 'ambiguous');

  let failPlaylist = false;
  const atomicTrusted = createTidalHeosTrustedResolver({
    baseResolver,
    autoWarm: false,
    refreshIntervalMs: 0,
    heosBrowse: async command => {
      if (command.includes('cid=My Music-Playlists&')) {
        return response(command, [
          { cid: 'My Music-Playlists-Created by me', container: 'yes' }
        ]);
      }
      if (command.includes('cid=My Music-Playlists-Created by me&')) {
        return response(command, [
          { cid: 'LIBPLAYLIST-one', container: 'yes' },
          { cid: 'LIBPLAYLIST-two', container: 'yes' }
        ]);
      }
      if (command.includes('LIBPLAYLIST-one')) {
        return response(command, [{
          name: 'Birthday',
          artist: 'The Sugarcubes',
          album_id: '341262049',
          mid: '341262056'
        }]);
      }
      if (command.includes('LIBPLAYLIST-two')) {
        if (failPlaylist) throw new Error('simulated playlist failure');
        return response(command, []);
      }
      throw new Error(`Unexpected HEOS command: ${command}`);
    }
  });

  await atomicTrusted.refreshIndex();
  const beforeFailure = await atomicTrusted.resolveTrack(target);
  assert.equal(beforeFailure.status, 'resolved');
  failPlaylist = true;
  await assert.rejects(() => atomicTrusted.refreshIndex(), /simulated playlist failure/);
  assert.equal(atomicTrusted.stats().indexReady, true, 'failed refresh must retain previous complete index');
  const afterFailure = await atomicTrusted.resolveTrack(target);
  assert.equal(afterFailure.status, 'resolved');
  assert.equal(afterFailure.mid, '341262056');

  const passthrough = createTidalHeosTrustedResolver({
    baseResolver: {
      async resolveTrack() {
        return {
          status: 'resolved',
          cid: 'LIBALBUM-1',
          mid: '2',
          method: 'direct-album-id+official-mid'
        };
      }
    },
    heosBrowse: async () => {
      throw new Error('HEOS trusted-context browse should not run');
    },
    autoWarm: false,
    refreshIntervalMs: 0
  });

  const direct = await passthrough.resolveTrack({ officialTrackId: '2' });
  assert.equal(direct.status, 'resolved');
  assert.equal(direct.mid, '2');

  console.log('TIDAL trusted resolver tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

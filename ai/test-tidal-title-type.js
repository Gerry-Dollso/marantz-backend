'use strict';

const assert = require('assert');
const { createTidalVoiceControl } = require('../tidal-voice');

function makeControl(callLog) {
  async function heosBrowse(command) {
    callLog.push(command);

    if (command.includes('browse/search?')) {
      return {
        payload: [
          { name: 'IDLES', cid: 'LIBARTIST-4653420' }
        ]
      };
    }

    if (command.includes('LIBARTIST-Albums-4653420')) {
      return {
        payload: [
          { name: 'TANGK', cid: 'LIBALBUM-403455815', playable: 'yes' },
          { name: 'Gift Horse', cid: 'LIBALBUM-999', playable: 'yes' }
        ]
      };
    }

    if (command.includes('LIBARTIST-Tracks-4653420')) {
      return {
        payload: [
          {
            name: 'Gift Horse',
            album: 'TANGK',
            mid: '403455823',
            playable: 'yes'
          }
        ]
      };
    }

    if (command.includes('cid=LIBALBUM-403455815')) {
      return {
        payload: [
          { name: 'IDEA 01', mid: '1', playable: 'yes' },
          { name: 'Gift Horse', mid: '2', playable: 'yes' }
        ]
      };
    }

    if (command.includes('cid=LIBALBUM-999')) {
      return {
        payload: [
          { name: 'Album Track', mid: '9', playable: 'yes' }
        ]
      };
    }

    return { payload: [] };
  }

  return createTidalVoiceControl({
    heosBrowse,
    playerId: '48723103',
    selectTidalSource: async () => {
      callLog.push('select:tidal');
    },
    resolveLearnedTitle: () => null
  });
}

(async () => {
  {
    const calls = [];
    const playByArtist = makeControl(calls);
    const result = await playByArtist('TANGK', 'IDLES', 'album');

    assert.strictEqual(result.action, 'play-album');
    assert.strictEqual(result.album, 'TANGK');
    assert.strictEqual(result.match.requestedType, 'album');
    assert.ok(
      !calls.some(command => String(command).includes('LIBARTIST-Tracks-4653420')),
      'explicit album requests must not fall through to track matching'
    );
  }

  {
    const calls = [];
    const playByArtist = makeControl(calls);
    const result = await playByArtist('Gift Horse', 'IDLES', 'track');

    assert.strictEqual(result.action, 'play-track');
    assert.strictEqual(result.track, 'Gift Horse');
    assert.strictEqual(result.match.requestedType, 'track');
    assert.ok(
      !calls.some(command => String(command).includes('LIBARTIST-Albums-4653420')),
      'explicit track requests must not be captured by same-named albums'
    );
  }

  {
    const calls = [];
    const playByArtist = makeControl(calls);
    const result = await playByArtist('TANGK', 'IDLES');

    assert.strictEqual(result.action, 'play-album');
    assert.strictEqual(result.match.requestedType, 'auto');
  }

  console.log('PASS: explicit album requests only resolve albums');
  console.log('PASS: explicit track requests only resolve tracks');
  console.log('PASS: legacy auto title resolution remains available');
  console.log('Mode: dry run; no TIDAL or receiver actions');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

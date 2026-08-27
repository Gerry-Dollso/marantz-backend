'use strict';

const assert = require('assert');
const {
  routeTidalSemanticRequest
} = require('./tidal-semantic-router');

(async () => {
  const calls = [];

  const handlers = {
    playArtist: async artist => {
      calls.push(['playArtist', artist]);
      return { ok: true, kind: 'artist', artist };
    },
    playAlbum: async (album, artist) => {
      calls.push(['playAlbum', album, artist]);
      return { ok: true, kind: 'album', album, artist };
    },
    playTrack: async (track, artist) => {
      calls.push(['playTrack', track, artist]);
      return { ok: true, kind: 'track', track, artist };
    },
    playTitle: async (title, artist) => {
      calls.push(['playTitle', title, artist]);
      return { ok: true, kind: 'title', title, artist };
    },
    showArtist: async (artist, view) => {
      calls.push(['showArtist', artist, view]);
      return { ok: true, kind: 'show', artist, view };
    }
  };

  const cases = [
    ['Play songs by IDLES', ['playArtist', 'IDLES']],
    ['Play the album TANGK by IDLES', ['playAlbum', 'TANGK', 'IDLES']],
    ['Play the song Gift Horse by IDLES', ['playTrack', 'Gift Horse', 'IDLES']],
    ['Play Gift Horse by IDLES', ['playTitle', 'Gift Horse', 'IDLES']],
    ['Show me IDLES', ['showArtist', 'IDLES', 'overview']],
    ['Show me albums by IDLES', ['showArtist', 'IDLES', 'albums']],
    ['Show me songs by IDLES', ['showArtist', 'IDLES', 'tracks']],
    ['Show me artists similar to IDLES', ['showArtist', 'IDLES', 'similar']],
    ['Tell me about IDLES', ['showArtist', 'IDLES', 'info']]
  ];

  for (const [phrase, expectedCall] of cases) {
    calls.length = 0;
    const routed = await routeTidalSemanticRequest(phrase, handlers);
    assert.strictEqual(routed.handled, true, `${phrase}: should be handled`);
    assert.deepStrictEqual(calls[0], expectedCall, `${phrase}: wrong handler routing`);
  }

  const unsupported = await routeTidalSemanticRequest('Show me IDLES', {});
  assert.strictEqual(unsupported.handled, true);
  assert.strictEqual(unsupported.result.action, 'not-supported-yet');
  assert.strictEqual(unsupported.result.missingHandler, 'showArtist');

  const unrelated = await routeTidalSemanticRequest('turn the volume down', handlers);
  assert.strictEqual(unrelated.handled, false);

  console.log('PASS: TIDAL semantic requests route to distinct handlers');
  console.log('PASS: future browse intents fail closed when no UI handler exists');
  console.log('PASS: unrelated receiver commands are left untouched');
  console.log('Mode: dry run; no TIDAL or receiver actions');
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

'use strict';

const assert = require('assert');
const {
  createTidalLiveAdapter
} = require('./tidal-live-adapter');

const calls = [];
const pending = [];

const adapter = createTidalLiveAdapter({
  playArtist: async artist => {
    calls.push(['artist', artist]);
    if (artist === 'Unknown Artist') {
      throw new Error('TIDAL artist not found safely: Unknown Artist');
    }
    return { ok: true, action: 'play-artist', artist };
  },
  playTitle: async (title, artist, type) => {
    calls.push(['title', type, title, artist]);
    if (title === 'Missing') {
      const error = new Error(`TIDAL ${type === 'track' ? 'track' : 'title'} not found safely: ${title} by ${artist}`);
      error.tidalVoiceContext = {
        type: 'title',
        artist,
        artistCid: 'LIBARTIST-1',
        requestedTitle: title
      };
      throw error;
    }
    return { ok: true, action: type === 'track' ? 'play-track' : type === 'album' ? 'play-album' : 'play-title' };
  },
  setPendingSearch: request => {
    pending.push(request);
    return { ok: false, action: 'search-required', ...request };
  }
});

(async () => {
  let result;

  result = await adapter('Play songs by IDLES');
  assert.strictEqual(result.handled, true);
  assert.deepStrictEqual(calls.pop(), ['artist', 'IDLES']);

  result = await adapter('Play the album TANGK by IDLES');
  assert.strictEqual(result.handled, true);
  assert.deepStrictEqual(calls.pop(), ['title', 'album', 'TANGK', 'IDLES']);

  result = await adapter('Play the song Gift Horse by IDLES');
  assert.strictEqual(result.handled, true);
  assert.deepStrictEqual(calls.pop(), ['title', 'track', 'Gift Horse', 'IDLES']);

  result = await adapter('Play Gift Horse by IDLES');
  assert.strictEqual(result.handled, true);
  assert.deepStrictEqual(calls.pop(), ['title', 'auto', 'Gift Horse', 'IDLES']);

  result = await adapter('Show me IDLES');
  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.result.action, 'not-supported-yet');
  assert.strictEqual(result.result.missingHandler, 'showArtist');

  result = await adapter('Play Unknown Artist');
  assert.strictEqual(result.result.action, 'search-required');
  assert.strictEqual(pending.at(-1).query, 'Unknown Artist');
  assert.strictEqual(pending.at(-1).type, 'artist');

  result = await adapter('Play the song Missing by IDLES');
  assert.strictEqual(result.result.action, 'search-required');
  assert.strictEqual(pending.at(-1).requestedType, 'track');
  assert.strictEqual(pending.at(-1).requestedTitle, 'Missing');

  result = await adapter('volume up');
  assert.strictEqual(result.handled, false);

  console.log('PASS: live adapter preserves artist, album, track and auto-title routing');
  console.log('PASS: safe lookup failures still create search-required requests');
  console.log('PASS: browse intents fail closed until Pi navigation is wired');
  console.log('PASS: non-TIDAL commands remain untouched');
  console.log('Mode: dry run; no TIDAL or receiver actions');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

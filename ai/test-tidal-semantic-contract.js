'use strict';

const assert = require('assert');
const { parseTidalSemanticRequest } = require('./tidal-semantic-contract');

const cases = [
  ['Play songs by IDLES', { action: 'play', entity: 'artist', view: 'tracks', artist: 'IDLES' }],
  ['Play music by IDLES', { action: 'play', entity: 'artist', view: 'tracks', artist: 'IDLES' }],
  ['Play IDLES', { action: 'play', entity: 'artist', view: 'tracks', artist: 'IDLES' }],
  ['Play the album TANGK by IDLES', { action: 'play', entity: 'album', view: 'default', artist: 'IDLES', album: 'TANGK' }],
  ['Play the song Gift Horse by IDLES', { action: 'play', entity: 'track', view: 'default', artist: 'IDLES', track: 'Gift Horse' }],
  ['Play Gift Horse by IDLES', { action: 'play', entity: 'title', view: 'default', artist: 'IDLES' }],
  ['Show me IDLES', { action: 'show', entity: 'artist', view: 'overview', artist: 'IDLES' }],
  ['Open IDLES', { action: 'show', entity: 'artist', view: 'overview', artist: 'IDLES' }],
  ['Show me albums by IDLES', { action: 'show', entity: 'artist', view: 'albums', artist: 'IDLES' }],
  ['Show me songs by IDLES', { action: 'show', entity: 'artist', view: 'tracks', artist: 'IDLES' }],
  ['Show me artists similar to IDLES', { action: 'show', entity: 'artist', view: 'similar', artist: 'IDLES' }],
  ['Tell me about IDLES', { action: 'show', entity: 'artist', view: 'info', artist: 'IDLES' }]
];

for (const [input, expected] of cases) {
  const actual = parseTidalSemanticRequest(input);
  assert(actual, `No semantic result for: ${input}`);

  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(
      actual[key],
      value,
      `${input}: expected ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`
    );
  }
}

const playSongs = parseTidalSemanticRequest('Play songs by IDLES');
const showSongs = parseTidalSemanticRequest('Show me songs by IDLES');
assert.notDeepStrictEqual(playSongs, showSongs, 'play/show artist tracks must remain distinct');

const album = parseTidalSemanticRequest('Play the album TANGK by IDLES');
const track = parseTidalSemanticRequest('Play the song Gift Horse by IDLES');
assert.notStrictEqual(album.entity, track.entity, 'album and track requests must remain distinct');

console.log(`PASS: ${cases.length} TIDAL semantic phrases classified correctly`);
console.log('PASS: play artist, album, track and browse/show intents remain distinct');
console.log('Mode: dry run; no TIDAL or receiver actions');

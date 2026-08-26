'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVoiceAliasStore } = require('../voice-alias-store');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marantz-alias-test-'));
const statePath = path.join(tempDir, 'voice-aliases.json');

try {
  const store = createVoiceAliasStore(statePath);

  store.learnArtist('chaos', 'Kyuss', 'LIBARTIST-13021');
  store.learnArtist('edels', 'IDLES', 'LIBARTIST-4653420');
  store.learnArtist('aydles', 'IDLES', 'LIBARTIST-4653420');
  store.learnArtist('adolph', 'IDLES', 'LIBARTIST-4653420');

  assert.deepStrictEqual(store.getArtist('chaos').name, 'Kyuss');
  assert.deepStrictEqual(store.getArtist('kyuss').cid, 'LIBARTIST-13021');
  assert.deepStrictEqual(store.getArtist('idles').cid, 'LIBARTIST-4653420');
  assert.strictEqual(store.getArtist('chaos uk'), null);

  store.learnArtist('same one', 'Same Artist', 'LIBARTIST-111');
  store.learnArtist('same two', 'Same Artist', 'LIBARTIST-222');
  assert.strictEqual(store.getArtist('same artist'), null);

  console.log('PASS: exact learned aliases still win');
  console.log('PASS: confirmed canonical artist names resolve safely');
  console.log('PASS: partial-name collisions do not rewrite (Chaos UK remains unknown)');
  console.log('PASS: ambiguous canonical-name collisions fail closed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

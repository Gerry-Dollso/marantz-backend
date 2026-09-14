'use strict';

const crypto = require('crypto');
const fs = require('fs');

const file = 'tidal-user-auth-recon.js';
const expectedBlobSha = '1b1e434a2fa08e1e844e46c4e1c1acd4c6e01dc5';

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

const source = fs.readFileSync(file, 'utf8');
const actualBlobSha = gitBlobSha(source);
if (actualBlobSha !== expectedBlobSha) {
  throw new Error(`Refusing to edit ${file}: expected blob ${expectedBlobSha}, found ${actualBlobSha}`);
}

const functionStart = source.indexOf('  async function probeRawPlaylist(playlistId) {');
const nextFunction = source.indexOf('\n  async function probeRichPlaylist(playlistId)', functionStart);
if (functionStart < 0 || nextFunction < 0) {
  throw new Error('Could not locate the guarded probeRawPlaylist function');
}

const block = source.slice(functionStart, nextFunction);
const oldValidation = "if (!/^[a-zA-Z0-9]+$/.test(id)) {\n      throw new Error('Playlist id must be alphanumeric');\n    }";
const newValidation = "if (!/^[a-zA-Z0-9-]+$/.test(id)) {\n      throw new Error('Playlist id must contain only letters, numbers, or hyphens');\n    }";
if (!block.includes(oldValidation)) {
  throw new Error('probeRawPlaylist validation did not match the expected pre-change text');
}
if ((block.match(/\^\[a-zA-Z0-9\]\+\$/g) || []).length !== 1) {
  throw new Error('probeRawPlaylist validation occurrence count was not exactly one');
}

const updatedBlock = block.replace(oldValidation, newValidation);
const updated = source.slice(0, functionStart) + updatedBlock + source.slice(nextFunction);
fs.writeFileSync(file, updated);

console.log('Widened only the temporary raw Playlist probe to accept hyphenated UUID IDs.');
console.log(`${file}: ${gitBlobSha(updated)}`);
console.log('No production catalogue, HEOS playback, queue, favourites, or Pi files were modified.');

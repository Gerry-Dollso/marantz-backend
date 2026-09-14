'use strict';

const crypto = require('crypto');
const fs = require('fs');

const file = 'tidal-user-auth-recon.js';
const expectedBlobSha = '6d33424ab9ee6a97ffe83acc743b82260f46fff1';

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
const oldText = "'?include=items&countryCode=' + encodeURIComponent(countryCode)";
const newText = "'?include=' + encodeURIComponent('items,coverArt') +\n      '&countryCode=' + encodeURIComponent(countryCode)";
if (!block.includes(oldText)) {
  throw new Error('probeRawPlaylist include expression did not match the expected pre-change text');
}
if (block.split(oldText).length !== 2) {
  throw new Error('probeRawPlaylist include expression occurrence count was not exactly one');
}

const updatedBlock = block.replace(oldText, newText);
const updated = source.slice(0, functionStart) + updatedBlock + source.slice(nextFunction);
fs.writeFileSync(file, updated);

console.log('Extended only the temporary raw Playlist probe to request coverArt with items.');
console.log(`${file}: ${gitBlobSha(updated)}`);
console.log('No production catalogue, HEOS playback, queue, favourites, or Pi files were modified.');

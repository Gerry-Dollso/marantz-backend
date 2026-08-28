'use strict';

// Guarded migration: fix album-title normalization in the read-only
// TIDAL -> HEOS resolution probe so quote-delimited N separators such as
// "Sackcloth 'N' Ashes" compare equivalently with "Sackcloth -N- Ashes".
// This migration only edits ai/probe-tidal-heos-resolution.js.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'probe-tidal-heos-resolution.js');
const before = `function albumNormalise(value) {
  return normalise(value)
    .replace(/\\s+(?:and|n)\\s+/g, ' n ')
    .replace(/\\s+/g, ' ')
    .trim();
}`;
const after = `function albumNormalise(value) {
  return normalise(value)
    .replace(/\\s+'n'\\s+/g, ' n ')
    .replace(/\\s+(?:and|n)\\s+/g, ' n ')
    .replace(/\\s+/g, ' ')
    .trim();
}`;

const source = fs.readFileSync(target, 'utf8');
if (source.includes(after)) {
  console.log('Already applied: album N-separator normalization fix present.');
  process.exit(0);
}
if (!source.includes(before)) {
  throw new Error('Guard failed: expected albumNormalise block not found; refusing to edit.');
}
const updated = source.replace(before, after);
if (updated === source) throw new Error('Guard failed: no change produced.');
fs.writeFileSync(target, updated);
console.log('Updated ai/probe-tidal-heos-resolution.js');
console.log('Only albumNormalise was changed; no runtime server or playback code touched.');

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const EXPECTED_SERVER_BLOB = '61141b782453ce3ea9df94304dd2bb3bea808c53';

function blob(file) {
  return execFileSync('git', ['hash-object', file], { cwd: root, encoding: 'utf8' }).trim();
}

function guard(file, expected, label) {
  const actual = blob(file);
  if (actual !== expected) {
    throw new Error(`Guard failed: ${label} blob is ${actual}, expected ${expected}`);
  }
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error('Guard failed: ' + label + ' anchor not found');
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error('Guard failed: ' + label + ' anchor is not unique');
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

guard(serverPath, EXPECTED_SERVER_BLOB, 'server.js');

let server = fs.readFileSync(serverPath, 'utf8');

const oldBlock = `  setImmediate(() => {\n    tidalUserAuthRecon.getFavouriteTracks()\n      .then(result => console.log(\n        'TIDAL Favourite Tracks prewarm ready:',\n        Array.isArray(result.tracks) ? result.tracks.length : 0,\n        'tracks'\n      ))\n      .catch(error => console.warn(\n        'TIDAL Favourite Tracks prewarm failed:',\n        error.message\n      ));\n  });\n`;

const newBlock = `  setImmediate(async () => {\n    const prewarmSteps = [\n      {\n        label: 'Artists',\n        load: () => tidalUserAuthRecon.getFavouriteArtists(),\n        count: result => Array.isArray(result.items) ? result.items.length : 0,\n        noun: 'artists'\n      },\n      {\n        label: 'Albums',\n        load: () => tidalUserAuthRecon.getFavouriteAlbums(),\n        count: result => Array.isArray(result.items) ? result.items.length : 0,\n        noun: 'albums'\n      },\n      {\n        label: 'Favourite Tracks',\n        load: () => tidalUserAuthRecon.getFavouriteTracks(),\n        count: result => Array.isArray(result.tracks) ? result.tracks.length : 0,\n        noun: 'tracks'\n      }\n    ];\n\n    for (const step of prewarmSteps) {\n      try {\n        const result = await step.load();\n        console.log(\n          'TIDAL ' + step.label + ' prewarm ready:',\n          step.count(result),\n          step.noun\n        );\n      } catch (error) {\n        console.warn(\n          'TIDAL ' + step.label + ' prewarm failed:',\n          error.message\n        );\n      }\n    }\n  });\n`;

server = replaceOnce(server, oldBlock, newBlock, 'startup prewarm');
fs.writeFileSync(serverPath, server);

console.log('server.js:', blob(serverPath));
console.log('Sequential TIDAL prewarm applied: Artists -> Albums -> Favourite Tracks; no service restart performed.');

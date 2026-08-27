'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

const oldBlock = `      await heosBrowse(\n        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n        '&sid=10&cid=' + heosCid +\n        '&mid=' + encodeURIComponent(queueTracks[0].mid) +\n        '&aid=4'\n      );\n\n      for (const track of queueTracks.slice(1)) {\n        await heosBrowse(\n          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n          '&sid=10&cid=' + heosCid +\n          '&mid=' + encodeURIComponent(track.mid) +\n          '&aid=3'\n        );\n      }\n`;

const newBlock = `      let queuedCount = 0;\n      let skippedCount = 0;\n      let firstMid = '';\n\n      for (const track of queueTracks) {\n        const aid = queuedCount === 0 ? 4 : 3;\n        try {\n          await heosBrowse(\n            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n            '&sid=10&cid=' + heosCid +\n            '&mid=' + encodeURIComponent(track.mid) +\n            '&aid=' + aid\n          );\n          if (queuedCount === 0) firstMid = String(track.mid);\n          queuedCount += 1;\n        } catch (error) {\n          skippedCount += 1;\n          console.warn(\n            'TIDAL FAVOURITE TRACK SKIP:',\n            JSON.stringify({\n              mid: String(track.mid || ''),\n              name: String(track.name || ''),\n              artist: String(track.artist || ''),\n              error: error.message\n            })\n          );\n        }\n      }\n\n      if (!queuedCount) {\n        throw new Error('No Favourite Tracks could be queued');\n      }\n`;

if (server.includes("'TIDAL FAVOURITE TRACK SKIP:'")) {
  throw new Error('Favourite Tracks skip-failure fix already appears applied');
}
if (!server.includes(oldBlock)) {
  throw new Error('Expected Favourite Tracks queue loop not found');
}

server = server.replace(oldBlock, newBlock);
server = server.replace(
  `        queued: queueTracks.length,\n        shuffle,\n        firstMid: String(queueTracks[0].mid),\n`,
  `        queued: queuedCount,\n        skipped: skippedCount,\n        attempted: queueTracks.length,\n        shuffle,\n        firstMid,\n`
);

const backup = serverPath + '.before-fix-tidal-favourite-tracks-skip-failures';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Applied Favourite Tracks skip-failure fix');
console.log('Backup:', backup);

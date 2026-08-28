'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(resolution.cid) +
        '&mid=' + encodeURIComponent(resolution.mid) +
        '&aid=4'
      );

      return sendJson(res, 200, {
        ok: true,
        action: 'play-only',
        track,
        resolution
      });`;

const newBlock = `      const action = String(
        url.searchParams.get('action') || 'play-only'
      ).trim();
      const aidByAction = {
        'play-now': 1,
        'play-next': 2,
        'add-end': 3,
        'play-only': 4
      };
      const aid = aidByAction[action];
      if (!aid) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Invalid resolved track action'
        });
      }

      await heosBrowse(
        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +
        '&sid=10&cid=' + encodeURIComponent(resolution.cid) +
        '&mid=' + encodeURIComponent(resolution.mid) +
        '&aid=' + aid
      );

      return sendJson(res, 200, {
        ok: true,
        action,
        track,
        resolution
      });`;

if (source.includes("'play-next': 2") && source.includes("'add-end': 3")) {
  console.log('Resolved TIDAL track actions already present; no change needed.');
  process.exit(0);
}

const count = source.split(oldBlock).length - 1;
if (count !== 1) {
  throw new Error('Expected exactly one proven play-resolved block; found ' + count);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(file, source);
console.log('Extended /api/tidal/play-resolved with play-now, play-next, add-end and play-only');

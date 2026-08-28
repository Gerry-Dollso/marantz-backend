'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const routeStart = source.indexOf("if (req.method === 'GET' && req.url.startsWith('/api/tidal/play-resolved?')) {");
if (routeStart < 0) throw new Error('play-resolved route not found');

const routeEnd = source.indexOf("\n  if (", routeStart + 20);
const end = routeEnd >= 0 ? routeEnd : source.length;
const route = source.slice(routeStart, end);

if (
  route.includes("'play-now': 1") &&
  route.includes("'play-next': 2") &&
  route.includes("'add-end': 3") &&
  route.includes("'play-only': 4")
) {
  console.log('Resolved TIDAL track actions already present in play-resolved route; no change needed.');
  process.exit(0);
}

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

if (!route.includes(oldBlock)) {
  throw new Error('Expected proven play-only block not found inside play-resolved route');
}

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

const updatedRoute = route.replace(oldBlock, newBlock);
source = source.slice(0, routeStart) + updatedRoute + source.slice(end);
fs.writeFileSync(file, source);
console.log('Extended play-resolved route with play-now, play-next, add-end and play-only');

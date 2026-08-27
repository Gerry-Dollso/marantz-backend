'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

const routeStart = server.indexOf("  if (req.method === 'GET' && req.url.startsWith('/api/tidal/tracks/play-all?')) {");
const routeEnd = server.indexOf("  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {", routeStart);
if (routeStart < 0 || routeEnd < 0) {
  throw new Error('Expected Favourite Tracks play-all route not found');
}

let route = server.slice(routeStart, routeEnd);

const old = `          await heosBrowse(\n            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n            '&sid=10&cid=' + heosCid +\n            '&mid=' + encodeURIComponent(track.mid) +\n            '&aid=' + aid\n          );`;
const replacement = `          await heosBrowse(\n            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n            '&sid=10&cid=' + heosCid +\n            '&mid=' + encodeURIComponent(track.mid) +\n            '&aid=' + aid,\n            15000\n          );`;

if (!route.includes(old)) {
  if (route.includes("'&aid=' + aid,\n            15000")) {
    throw new Error('Favourite Tracks queue timeout fix already appears to be applied');
  }
  throw new Error('Expected Favourite Tracks add_to_queue anchor not found');
}

route = route.replace(old, replacement);
server = server.slice(0, routeStart) + route + server.slice(routeEnd);

const backup = serverPath + '.before-fix-tidal-favourite-tracks-queue-timeout';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Applied Favourite Tracks 15-second HEOS queue timeout');
console.log('Backup:', backup);

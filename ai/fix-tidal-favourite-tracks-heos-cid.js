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

const route = server.slice(routeStart, routeEnd);
if (route.includes("const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');")) {
  throw new Error('Favourite Tracks HEOS CID fix already appears to be applied');
}

let fixed = route;
fixed = fixed.replace(
  "      const cacheKey = cid + '|all';\n",
  "      const cacheKey = cid + '|all';\n      const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');\n"
);

const occurrences = (fixed.match(/encodeURIComponent\(cid\)/g) || []).length;
if (occurrences < 3) {
  throw new Error('Expected Favourite Tracks CID encoding anchors not found');
}
fixed = fixed.replace(/encodeURIComponent\(cid\)/g, 'heosCid');

server = server.slice(0, routeStart) + fixed + server.slice(routeEnd);

const backup = serverPath + '.before-fix-tidal-favourite-tracks-heos-cid';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Corrected Favourite Tracks HEOS CID handling');
console.log('Backup:', backup);

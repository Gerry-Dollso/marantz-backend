'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

const bad = "      const heosCid = heosCid.replace(/%20/g, ' ');\n";
const good = "      const heosCid = encodeURIComponent(cid).replace(/%20/g, ' ');\n";

if (!server.includes(bad)) {
  throw new Error('Expected Favourite Tracks HEOS CID self-reference not found');
}
if (server.includes(good)) {
  throw new Error('Correct Favourite Tracks HEOS CID line already present');
}

server = server.replace(bad, good);

const backup = serverPath + '.before-fix-tidal-favourite-tracks-heos-cid-self-reference';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Corrected Favourite Tracks HEOS CID self-reference');
console.log('Backup:', backup);

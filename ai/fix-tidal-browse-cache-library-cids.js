'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

const oldBlock = `      const highValueLibrary = new Set([\n        'My Music',\n        'Artists',\n        'Albums',\n        'Tracks',\n        'Playlists'\n      ]).has(cleanCid);\n`;

const newBlock = `      const highValueLibrary = new Set([\n        'My Music',\n        'My Music-Artists',\n        'My Music-Albums',\n        'My Music-Tracks',\n        'My Music-Playlists'\n      ]).has(cleanCid);\n`;

if (server.includes(newBlock)) {
  throw new Error('TIDAL browse cache library CIDs already corrected');
}

if (!server.includes(oldBlock)) {
  throw new Error('Expected TIDAL browse cache policy block not found');
}

server = server.replace(oldBlock, newBlock);
fs.writeFileSync(serverPath, server);

console.log('Corrected TIDAL browse cache high-value library CIDs');

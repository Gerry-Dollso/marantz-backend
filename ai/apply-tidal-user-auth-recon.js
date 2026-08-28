'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.resolve(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

function insertOnce(anchor, insertion, description) {
  if (source.includes(insertion.trim())) {
    console.log(`Already present: ${description}`);
    return;
  }
  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error(`Anchor not found for ${description}`);
  }
  source = source.slice(0, index) + insertion + source.slice(index);
  console.log(`Inserted: ${description}`);
}

insertOnce(
  "const {\n  createTidalMetadataClient\n} = require('./tidal-metadata-client');\n",
  "const {\n  createTidalUserAuthRecon\n} = require('./tidal-user-auth-recon');\n",
  'TIDAL user auth require'
);

insertOnce(
  "let pendingTidalVoiceSearch = null;\n",
  "const tidalUserAuthRecon = createTidalUserAuthRecon({\n  countryCode: 'GB'\n});\n",
  'TIDAL user auth instance'
);

insertOnce(
  "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/browse?')) {\n",
  "  if (await tidalUserAuthRecon.handle(req, res)) return;\n\n",
  'TIDAL OAuth reconnaissance routes'
);

fs.writeFileSync(serverPath, source);
console.log('Updated server.js');

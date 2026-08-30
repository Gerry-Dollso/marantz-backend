'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const requireAnchor = `const {\n  createTidalHeosResolver\n} = require('./tidal-heos-resolver');\n`;
const requireReplacement = requireAnchor + `const {\n  createTidalHeosTrustedResolver\n} = require('./tidal-heos-trusted-resolver');\n`;

const requireCount = source.split(requireAnchor).length - 1;
if (requireCount !== 1) {
  throw new Error(`Expected exactly one trusted-resolver require anchor; found ${requireCount}`);
}
source = source.replace(requireAnchor, requireReplacement);

const instanceAnchor = `const tidalHeosResolver = createTidalHeosResolver({\n  heosBrowse,\n  sid: '10'\n});\n`;
const instanceReplacement = instanceAnchor + `const tidalHeosTrustedResolver = createTidalHeosTrustedResolver({\n  baseResolver: tidalHeosResolver,\n  heosBrowse,\n  sid: '10'\n});\n`;

const instanceCount = source.split(instanceAnchor).length - 1;
if (instanceCount !== 1) {
  throw new Error(`Expected exactly one trusted-resolver instance anchor; found ${instanceCount}`);
}
source = source.replace(instanceAnchor, instanceReplacement);

const callAnchor = 'await tidalHeosResolver.resolveTrack(';
const callCount = source.split(callAnchor).length - 1;
if (callCount !== 3) {
  throw new Error(`Expected exactly three resolver call sites; found ${callCount}`);
}
source = source.split(callAnchor).join('await tidalHeosTrustedResolver.resolveTrack(');

fs.writeFileSync(serverPath, source);
console.log('Integrated trusted TIDAL HEOS resolver into server.js');

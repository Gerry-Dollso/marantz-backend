'use strict';

// One-shot, guarded migration helper for server.js.
// It refuses to edit unless the expected pre-integration anchors are present.

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const importAnchor = "const { executeIntent } = require('./ai/intent-action-router');\n";
const importReplacement = importAnchor +
  "const {\n" +
  "  createTidalLiveAdapter\n" +
  "} = require('./ai/tidal-live-adapter');\n";

if (!source.includes(importAnchor)) {
  throw new Error('Expected import anchor not found; refusing to edit server.js');
}
if (source.includes("require('./ai/tidal-live-adapter')")) {
  throw new Error('TIDAL semantic integration already appears to be applied');
}
source = source.replace(importAnchor, importReplacement);

const setupAnchor = `const playTidalArtist = createTidalArtistVoiceControl({\n  heosBrowse,\n  heosStart,\n  playerId: PLAYER_ID,\n  selectTidalSource: () => semanticSourceControl('tidal'),\n  resolveLearnedArtist: artist => voiceAliases.getArtist(artist)\n});\n\n`;

const setupReplacement = setupAnchor + `function setPendingTidalVoiceSearch(details) {\n  pendingTidalVoiceSearch = {\n    id: ++tidalVoiceSearchSequence,\n    ...details,\n    createdAt: Date.now()\n  };\n\n  return {\n    ok: false,\n    action: 'search-required',\n    ...pendingTidalVoiceSearch\n  };\n}\n\nconst handleTidalSemanticCommand = createTidalLiveAdapter({\n  playArtist: playTidalArtist,\n  playTitle: (title, artist, requestedType) =>\n    playTidalAlbumByArtist(title, artist, requestedType),\n  setPendingSearch: setPendingTidalVoiceSearch\n});\n\n`;

if (!source.includes(setupAnchor)) {
  throw new Error('Expected TIDAL setup anchor not found; refusing to edit server.js');
}
source = source.replace(setupAnchor, setupReplacement);

const oldBlockStart = "  const tidalAlbumMatch = text.match(\n";
const oldBlockEnd = "  const transportPhrases = {\n";
const startIndex = source.indexOf(oldBlockStart);
const endIndex = source.indexOf(oldBlockEnd, startIndex);

if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  throw new Error('Expected legacy TIDAL command block not found; refusing to edit server.js');
}

const semanticBlock = `  const tidalSemantic = await handleTidalSemanticCommand(text);\n\n  if (tidalSemantic.handled) {\n    return tidalSemantic.result;\n  }\n\n`;

source = source.slice(0, startIndex) + semanticBlock + source.slice(endIndex);

const backupPath = serverPath + '.before-tidal-semantic-integration';
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(serverPath, backupPath);
}

fs.writeFileSync(serverPath, source);
console.log('Applied guarded TIDAL semantic integration to server.js');
console.log('Backup:', backupPath);

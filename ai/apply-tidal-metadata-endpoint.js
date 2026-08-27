'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

if (source.includes("require('./tidal-metadata-client')")) {
  throw new Error('TIDAL metadata endpoint already appears to be applied');
}

const requireAnchor = `const {\n  createTidalLiveAdapter\n} = require('./ai/tidal-live-adapter');\n`;
if (!source.includes(requireAnchor)) {
  throw new Error('Expected TIDAL live adapter require anchor not found; refusing to edit');
}
source = source.replace(
  requireAnchor,
  requireAnchor +
    `const {\n` +
    `  createTidalMetadataClient\n` +
    `} = require('./tidal-metadata-client');\n`
);

const configAnchor = `const AI_FALLBACK_ENABLED = process.env.MARANTZ_AI_FALLBACK === '1';\n`;
if (!source.includes(configAnchor)) {
  throw new Error('Expected backend config anchor not found; refusing to edit');
}
source = source.replace(
  configAnchor,
  configAnchor +
    `const tidalMetadata = createTidalMetadataClient({ countryCode: 'GB' });\n`
);

const endpointAnchor = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/track/action?')) {\n`;
if (!source.includes(endpointAnchor)) {
  throw new Error('Expected TIDAL track action endpoint anchor not found; refusing to edit');
}

const endpoint = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/metadata/track-artists?')) {\n` +
`    try {\n` +
`      const url = new URL(req.url, 'http://localhost');\n` +
`      const mid = String(url.searchParams.get('mid') || '').trim();\n` +
`      if (!mid) {\n` +
`        return sendJson(res, 400, { error: 'Missing track mid' });\n` +
`      }\n\n` +
`      const result = await tidalMetadata.getTrackArtists(mid);\n` +
`      return sendJson(res, 200, { ok: true, ...result });\n` +
`    } catch (error) {\n` +
`      return sendJson(res, 502, { error: error.message });\n` +
`    }\n` +
`  }\n\n`;

source = source.replace(endpointAnchor, endpoint + endpointAnchor);

const backup = serverPath + '.before-tidal-metadata-endpoint';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);

fs.writeFileSync(serverPath, source);
console.log('Applied guarded TIDAL metadata endpoint migration');
console.log('Backup:', backup);

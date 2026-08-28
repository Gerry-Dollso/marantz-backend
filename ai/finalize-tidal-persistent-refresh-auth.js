'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes('TIDAL_PERSISTENT_REFRESH_AUTH_V3')) {
  console.log('Final TIDAL persistent refresh auth already present; no changes made.');
  process.exit(0);
}

const oldClear = `  function clearPersistedRefreshToken() {
    try {
      fs.unlinkSync(refreshTokenFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
`;
const newClear = `  function clearPersistedRefreshToken() {
    try {
      fs.writeFileSync(refreshTokenFile, '', { mode: 0o600 });
      fs.chmodSync(refreshTokenFile, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
`;
if (!source.includes(oldClear)) throw new Error('Expected clearPersistedRefreshToken block not found');
source = source.replace(oldClear, newClear);

const probeAnchor = `  async function probeTrackMetadata(trackId) {
    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }
`;
const probeReplacement = `  async function probeTrackMetadata(trackId) {
    await ensureSession(); // TIDAL_PERSISTENT_REFRESH_AUTH_V3
`;
if (!source.includes(probeAnchor)) throw new Error('Expected probeTrackMetadata session guard not found');
source = source.replace(probeAnchor, probeReplacement);

fs.writeFileSync(target, source);
console.log('Finalized persistent TIDAL refresh auth.');

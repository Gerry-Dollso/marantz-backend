'use strict';

// Guarded follow-up migration: make every direct TIDAL API probe use the
// persistent refresh-session helper, and make /oauth/status restore a stored
// session automatically after a backend restart.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes('TIDAL_PERSISTENT_REFRESH_AUTH_V2')) {
  console.log('Complete persistent TIDAL refresh auth already present; no changes made.');
  process.exit(0);
}

if (!source.includes('async function ensureSession()')) {
  throw new Error('Persistent refresh auth V1 is not present');
}

const oldGuard = `    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

`;

let replacements = 0;
while (source.includes(oldGuard)) {
  source = source.replace(oldGuard, '    await ensureSession();\n\n');
  replacements += 1;
}

// apiGet was already converted by V1, so the remaining direct-probe guards
// should account for at least one replacement. Fail closed if the expected
// legacy pattern has disappeared for an unknown reason.
if (replacements < 1) {
  throw new Error('No remaining direct TIDAL session guards found');
}

const statusAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/status') {\n";
if (!source.includes(statusAnchor)) throw new Error('Expected oauth status route anchor not found');
source = source.replace(
  statusAnchor,
  statusAnchor +
    "      // TIDAL_PERSISTENT_REFRESH_AUTH_V2\n" +
    "      try { await ensureSession(); } catch {}\n"
);

const statusTail = "        refreshTokenReceived: Boolean(session?.refreshToken)\n";
if (!source.includes(statusTail)) throw new Error('Expected oauth status payload anchor not found');
source = source.replace(
  statusTail,
  "        refreshTokenReceived: Boolean(session?.refreshToken),\n" +
  "        refreshTokenStored: Boolean(loadRefreshToken())\n"
);

fs.writeFileSync(target, source);
console.log('Completed persistent TIDAL refresh auth; converted ' + replacements + ' direct session guard(s).');

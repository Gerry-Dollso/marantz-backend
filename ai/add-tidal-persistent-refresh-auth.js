'use strict';

// Guarded migration: persist only the TIDAL refresh token outside Git and
// automatically restore/refresh the user session after backend restarts.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

if (source.includes('TIDAL_PERSISTENT_REFRESH_AUTH_V1')) {
  console.log('Persistent TIDAL refresh auth already present; no changes made.');
  process.exit(0);
}

const cryptoAnchor = "const crypto = require('crypto');\n";
if (!source.includes(cryptoAnchor)) throw new Error('Expected crypto require anchor not found');
source = source.replace(cryptoAnchor, cryptoAnchor + "const fs = require('fs');\n");

const ttlAnchor = 'const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;\n';
if (!source.includes(ttlAnchor)) throw new Error('Expected auth TTL anchor not found');
source = source.replace(ttlAnchor, ttlAnchor + "const DEFAULT_REFRESH_TOKEN_FILE = '/etc/marantz-backend/tidal-refresh-token'; // TIDAL_PERSISTENT_REFRESH_AUTH_V1\n");

const sessionAnchor = '  let pendingAuth = null;\n  let session = null;\n';
if (!source.includes(sessionAnchor)) throw new Error('Expected session anchor not found');
source = source.replace(sessionAnchor, `  let pendingAuth = null;
  let session = null;
  let refreshInFlight = null;
  const refreshTokenFile = String(
    options.refreshTokenFile || process.env.TIDAL_REFRESH_TOKEN_FILE || DEFAULT_REFRESH_TOKEN_FILE
  ).trim();

  function loadRefreshToken() {
    try {
      return fs.readFileSync(refreshTokenFile, 'utf8').trim();
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }

  function persistRefreshToken(refreshToken) {
    const token = String(refreshToken || '').trim();
    if (!token) return;
    fs.writeFileSync(refreshTokenFile, token + '\\n', { mode: 0o600 });
    fs.chmodSync(refreshTokenFile, 0o600);
  }

  function clearPersistedRefreshToken() {
    try {
      fs.unlinkSync(refreshTokenFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

`);

const apiAnchor = '  async function apiGet(path) {\n';
const apiAt = source.indexOf(apiAnchor);
if (apiAt < 0) throw new Error('Expected apiGet anchor not found');
const refreshFunctions = `  async function exchangeRefreshToken(refreshToken) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description || payload.error || ('HTTP ' + response.status);
      throw new Error('TIDAL refresh-token exchange failed: ' + detail);
    }
    const expiresIn = Math.max(60, Number(payload.expires_in) || 86400);
    return {
      accessToken: String(payload.access_token),
      refreshToken: String(payload.refresh_token || refreshToken),
      tokenType: String(payload.token_type || 'Bearer'),
      scope: String(payload.scope || ''),
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  async function ensureSession() {
    if (session?.accessToken && Date.now() < session.expiresAt - 60000) return session;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const refreshToken = session?.refreshToken || loadRefreshToken();
      if (!refreshToken) {
        throw new Error('TIDAL user authorization has not been completed');
      }
      try {
        const refreshed = await exchangeRefreshToken(refreshToken);
        session = refreshed;
        persistRefreshToken(refreshed.refreshToken);
        return session;
      } catch (error) {
        if (/invalid_grant|invalid refresh|expired|revoked/i.test(String(error.message || ''))) {
          clearPersistedRefreshToken();
          session = null;
        }
        throw error;
      }
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

`;
source = source.slice(0, apiAt) + refreshFunctions + source.slice(apiAt);

const oldApiGuard = `    if (!session?.accessToken) {
      throw new Error('TIDAL user authorization has not been completed');
    }
    if (Date.now() >= session.expiresAt) {
      throw new Error('TIDAL user access token has expired; authorize again');
    }

    const response = await fetch(\`${'${API_BASE}${path}'}\`, {`;
const newApiGuard = `    await ensureSession();

    const response = await fetch(\`${'${API_BASE}${path}'}\`, {`;
if (!source.includes(oldApiGuard)) throw new Error('Expected apiGet session guard not found');
source = source.replace(oldApiGuard, newApiGuard);

const callbackAnchor = '        session = await exchangeCode(code, verifier);\n';
if (!source.includes(callbackAnchor)) throw new Error('Expected callback exchange anchor not found');
source = source.replace(callbackAnchor, callbackAnchor + '        persistRefreshToken(session.refreshToken);\n');

const htmlOld = 'MarantzPi now has a temporary in-memory user session for API reconnaissance. No token has been displayed or written to Git. Return to Termius.';
const htmlNew = 'MarantzPi is authorized. The refresh token is stored securely outside Git so authorization can survive backend restarts. Return to Termius.';
if (!source.includes(htmlOld)) throw new Error('Expected success text anchor not found');
source = source.replace(htmlOld, htmlNew);

const statusAnchor = "    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/status') {\n";
const statusAt = source.indexOf(statusAnchor);
if (statusAt < 0) throw new Error('Expected oauth status route anchor not found');
const statusInsert = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/refresh') {
      try {
        await ensureSession();
        return sendJson(res, 200, {
          ok: true,
          authorized: true,
          expiresAt: new Date(session.expiresAt).toISOString(),
          tokenScope: session.scope || '',
          refreshTokenStored: Boolean(loadRefreshToken())
        });
      } catch (error) {
        return sendJson(res, 401, { ok: false, authorized: false, error: error.message });
      }
    }

`;
source = source.slice(0, statusAt) + statusInsert + source.slice(statusAt);

fs.writeFileSync(target, source);
console.log('Added persistent TIDAL refresh-token auth.');

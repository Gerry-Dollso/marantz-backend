'use strict';

const fs = require('fs');
const path = require('path');

const reconFile = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let recon = fs.readFileSync(reconFile, 'utf8');

const functionSignature = 'async function probeArtistMetadata(artistId)';
const routeSignature = '/api/tidal/oauth/probe-artist';

const functionAnchor = '  async function probeRichMetadata() {';
const artistFunction = `  async function probeArtistMetadata(artistId) {
    if (!/^\\d+$/.test(artistId || '')) {
      throw new Error('Artist id must contain digits only');
    }

    return apiGetRaw(
      '/artists/' + encodeURIComponent(artistId) +
      '?include=' + encodeURIComponent('profileArt') +
      '&countryCode=' + encodeURIComponent(countryCode)
    );
  }

`;

if (!recon.includes(functionSignature)) {
  const matches = recon.split(functionAnchor).length - 1;
  if (matches !== 1) {
    throw new Error('Expected probeRichMetadata anchor exactly once; found ' + matches);
  }
  recon = recon.replace(functionAnchor, artistFunction + functionAnchor);
}

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-rich-metadata') {`;
const artistRoute = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-artist') {
      try {
        const artistId = requestUrl.searchParams.get('id') || '';
        const artist = await probeArtistMetadata(artistId);
        return sendJson(res, 200, { ok: true, artist });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

`;

if (!recon.includes(routeSignature)) {
  const matches = recon.split(routeAnchor).length - 1;
  if (matches !== 1) {
    throw new Error('Expected probe-rich-metadata route anchor exactly once; found ' + matches);
  }
  recon = recon.replace(routeAnchor, artistRoute + routeAnchor);
}

fs.writeFileSync(reconFile, recon);
console.log('Added read-only TIDAL artist metadata probe.');

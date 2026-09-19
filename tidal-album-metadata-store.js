'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = '/var/lib/marantz-backend/album-metadata';
const STORE_VERSION = 1;

function createTidalAlbumMetadataStore(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  fs.mkdirSync(root, { recursive: true });

  function validateId(albumId) {
    const id = String(albumId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Album id must contain digits only');
    return id;
  }

  function fileFor(albumId) {
    return path.join(root, validateId(albumId) + '.json');
  }

  function read(albumId) {
    const id = validateId(albumId);
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
      if (parsed?.version !== STORE_VERSION || String(parsed.albumId) !== id || !parsed.value || typeof parsed.value !== 'object') return null;
      return parsed.value;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('TIDAL album metadata cache read failed:', id, error.message);
      return null;
    }
  }

  function write(albumId, value) {
    const id = validateId(albumId);
    const target = fileFor(id);
    const temp = target + '.tmp-' + process.pid + '-' + Date.now();
    const payload = JSON.stringify({ version: STORE_VERSION, albumId: id, cachedAt: new Date().toISOString(), value });
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(temp, target);
    return value;
  }

  function stats() {
    let entries = 0;
    let bytes = 0;
    try {
      for (const name of fs.readdirSync(root)) {
        if (!/^\d+\.json$/.test(name)) continue;
        entries += 1;
        try { bytes += fs.statSync(path.join(root, name)).size; } catch (_) {}
      }
    } catch (_) {}
    return { root, entries, bytes };
  }

  return { read, write, stats };
}

module.exports = { createTidalAlbumMetadataStore };

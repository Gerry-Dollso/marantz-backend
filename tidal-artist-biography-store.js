'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = '/var/lib/marantz-backend/artist-biographies';
const DEFAULT_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

function createTidalArtistBiographyStore(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const freshMs = Math.max(0, Number(options.freshMs ?? DEFAULT_FRESH_MS));
  fs.mkdirSync(root, { recursive: true });

  function validateId(artistId) {
    const id = String(artistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    return id;
  }

  function fileFor(artistId) {
    return path.join(root, validateId(artistId) + '.json');
  }

  function read(artistId) {
    const id = validateId(artistId);
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
      if (parsed?.version !== 1 || String(parsed.artistId) !== id || !Object.prototype.hasOwnProperty.call(parsed, 'value')) return null;
      const createdAt = Date.parse(parsed.createdAt || '');
      if (!Number.isFinite(createdAt)) return null;
      const ageMs = Math.max(0, Date.now() - createdAt);
      return { value: parsed.value, createdAt, ageMs, fresh: ageMs <= freshMs };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('TIDAL Artist biography persistent cache read failed:', error.message);
      return null;
    }
  }

  function write(artistId, value, createdAt = Date.now()) {
    const id = validateId(artistId);
    const target = fileFor(id);
    const temp = target + '.tmp-' + process.pid + '-' + Date.now();
    const payload = JSON.stringify({ version: 1, artistId: id, createdAt: new Date(createdAt).toISOString(), value });
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(temp, target);
    return { path: target, bytes: Buffer.byteLength(payload), createdAt };
  }

  function remove(artistId) {
    try { fs.unlinkSync(fileFor(artistId)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
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
    return { root, entries, bytes, freshMs };
  }

  return { read, write, remove, stats };
}

module.exports = { createTidalArtistBiographyStore };

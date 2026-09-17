'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = '/var/lib/marantz-backend/artwork';
const INDEX_VERSION = 1;

function createTidalArtworkCache(options = {}) {
  const root = String(options.root || process.env.MARANTZ_ARTWORK_CACHE_DIR || DEFAULT_ROOT);
  const filesDir = path.join(root, 'files');
  const indexPath = path.join(root, 'index.json');
  const inFlight = new Map();
  let index = { version: INDEX_VERSION, entries: {} };
  let pendingIndexSave = null;

  function ensureDirectories() {
    fs.mkdirSync(filesDir, { recursive: true });
  }

  function loadIndex() {
    ensureDirectories();
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (parsed?.version === INDEX_VERSION && parsed.entries && typeof parsed.entries === 'object') {
        index = parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('TIDAL artwork cache index load failed:', error.message);
    }
  }

  function saveIndex() {
    if (pendingIndexSave) {
      clearTimeout(pendingIndexSave);
      pendingIndexSave = null;
    }
    ensureDirectories();
    const temp = indexPath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(index, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, indexPath);
  }

  function scheduleIndexSave() {
    if (pendingIndexSave) return;
    pendingIndexSave = setTimeout(() => {
      pendingIndexSave = null;
      saveIndex();
    }, 1000);
    pendingIndexSave.unref?.();
  }

  function normaliseKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (!['artist', 'album', 'track', 'playlist'].includes(value)) throw new Error('Unsupported artwork kind');
    return value;
  }

  function normaliseId(id) {
    const value = String(id || '').trim();
    if (!value || value.length > 256 || !/^[a-zA-Z0-9-]+$/.test(value)) throw new Error('Invalid artwork id');
    return value;
  }

  function keyFor(kind, id) {
    return normaliseKind(kind) + ':' + normaliseId(id);
  }

  function extensionFor(contentType) {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (type === 'image/jpeg') return '.jpg';
    if (type === 'image/png') return '.png';
    if (type === 'image/webp') return '.webp';
    if (type === 'image/gif') return '.gif';
    return '';
  }

  function publicUrl(kind, id) {
    return '/api/tidal/artwork/' + encodeURIComponent(normaliseKind(kind)) + '/' + encodeURIComponent(normaliseId(id));
  }

  function localPathFor(entry) {
    if (!entry?.filename) return null;
    const candidate = path.join(filesDir, path.basename(entry.filename));
    return candidate.startsWith(filesDir + path.sep) ? candidate : null;
  }

  function getEntry(kind, id) {
    return index.entries[keyFor(kind, id)] || null;
  }

  function hasFile(entry) {
    const filename = localPathFor(entry);
    return Boolean(filename && fs.existsSync(filename));
  }

  async function download(kind, id, sourceUrl) {
    const cleanKind = normaliseKind(kind);
    const cleanId = normaliseId(id);
    const cleanUrl = String(sourceUrl || '').trim();
    if (!/^https:\/\//i.test(cleanUrl)) throw new Error('Artwork source must use HTTPS');
    const key = keyFor(cleanKind, cleanId);
    if (inFlight.has(key)) return inFlight.get(key);

    const work = (async () => {
      ensureDirectories();
      const response = await fetch(cleanUrl, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' } });
      if (!response.ok) throw new Error('Artwork download HTTP ' + response.status);
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) throw new Error('Artwork response was not an image');
      const extension = extensionFor(contentType);
      if (!extension) throw new Error('Unsupported artwork content type ' + contentType);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Artwork download was empty');
      if (bytes.length > 15 * 1024 * 1024) throw new Error('Artwork download exceeded 15 MB');

      const digest = crypto.createHash('sha256').update(cleanUrl).digest('hex').slice(0, 16);
      const filename = cleanKind + '-' + cleanId + '-' + digest + extension;
      const target = path.join(filesDir, filename);
      const temp = target + '.tmp-' + process.pid;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, target);

      const previous = index.entries[key];
      const previousPath = localPathFor(previous);
      index.entries[key] = {
        kind: cleanKind,
        id: cleanId,
        sourceUrl: cleanUrl,
        filename,
        contentType,
        bytes: bytes.length,
        cachedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      };
      saveIndex();
      if (previousPath && previousPath !== target) {
        try { fs.unlinkSync(previousPath); } catch (error) { if (error.code !== 'ENOENT') console.warn('TIDAL artwork old file cleanup failed:', error.message); }
      }
      return index.entries[key];
    })().finally(() => inFlight.delete(key));

    inFlight.set(key, work);
    return work;
  }

  function touch(kind, id, sourceUrl) {
    const key = keyFor(kind, id);
    const entry = index.entries[key];
    if (!entry) return false;
    entry.lastSeenAt = new Date().toISOString();
    if (sourceUrl) entry.sourceUrl = String(sourceUrl);
    scheduleIndexSave();
    return true;
  }

  async function ensure(kind, id, sourceUrl) {
    const entry = getEntry(kind, id);
    const cleanUrl = String(sourceUrl || '').trim();
    if (entry && hasFile(entry) && entry.sourceUrl === cleanUrl) {
      touch(kind, id, cleanUrl);
      return { entry, cached: true, url: publicUrl(kind, id) };
    }
    const refreshed = await download(kind, id, cleanUrl);
    return { entry: refreshed, cached: false, url: publicUrl(kind, id) };
  }

  function resolve(kind, id) {
    const entry = getEntry(kind, id);
    if (!entry || !hasFile(entry)) return null;
    return { ...entry, path: localPathFor(entry), url: publicUrl(kind, id) };
  }

  function reconcile(activeKeys, options = {}) {
    const active = new Set(Array.from(activeKeys || [], String));
    const graceMs = Math.max(0, Number(options.graceMs) || 7 * 24 * 60 * 60 * 1000);
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of Object.entries(index.entries)) {
      if (active.has(key)) continue;
      const lastSeen = Date.parse(entry.lastSeenAt || entry.cachedAt || 0) || 0;
      if (now - lastSeen < graceMs) continue;
      const filename = localPathFor(entry);
      if (filename) {
        try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') console.warn('TIDAL artwork orphan cleanup failed:', error.message); }
      }
      delete index.entries[key];
      removed += 1;
    }
    if (removed) saveIndex();
    return { removed, entries: Object.keys(index.entries).length };
  }

  function stats() {
    let bytes = 0;
    let files = 0;
    for (const entry of Object.values(index.entries)) {
      if (!hasFile(entry)) continue;
      files += 1;
      bytes += Number(entry.bytes) || 0;
    }
    return { root, entries: Object.keys(index.entries).length, files, bytes, inFlight: inFlight.size };
  }

  loadIndex();
  return { ensure, resolve, touch, reconcile, stats, publicUrl, keyFor };
}

module.exports = { createTidalArtworkCache };

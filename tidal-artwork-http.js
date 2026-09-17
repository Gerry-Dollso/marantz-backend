'use strict';

const fs = require('fs');
const { createTidalArtworkCache } = require('./tidal-artwork-cache');

function createTidalArtworkHttp(options = {}) {
  const cache = options.cache || createTidalArtworkCache(options.cacheOptions);
  const populateQueue = [];
  const queued = new Set();
  let workers = 0;
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 2));

  function itemIdentity(kind, item) {
    const id = String(item?.id || '').trim();
    const field = typeof item?.artwork === 'string' && item.artwork.trim() ? 'artwork' : 'imageUrl';
    const imageUrl = String(item?.[field] || '').trim();
    if (!id || !/^https:\/\//i.test(imageUrl)) return null;
    return { kind, id, field, imageUrl, key: cache.keyFor(kind, id) };
  }

  function pump() {
    while (workers < concurrency && populateQueue.length) {
      const job = populateQueue.shift();
      workers += 1;
      cache.ensure(job.kind, job.id, job.imageUrl)
        .catch(error => console.warn('TIDAL artwork background cache failed:', job.key, error.message))
        .finally(() => {
          queued.delete(job.key);
          workers -= 1;
          pump();
        });
    }
  }

  function enqueue(job) {
    if (queued.has(job.key)) return;
    queued.add(job.key);
    populateQueue.push(job);
    pump();
  }

  function decorateItems(kind, items) {
    if (!Array.isArray(items)) return items;
    return items.map(item => {
      const identity = itemIdentity(kind, item);
      if (!identity) return item;
      const local = cache.resolve(kind, identity.id);
      if (local && local.sourceUrl === identity.imageUrl) {
        cache.touch(kind, identity.id, identity.imageUrl);
        return { ...item, [identity.field]: local.url };
      }
      enqueue(identity);
      return item;
    });
  }

  function decorateLibraryResult(kind, field, result) {
    if (!result || typeof result !== 'object') return result;
    return { ...result, [field]: decorateItems(kind, result[field]) };
  }

  function serve(req, res, pathname) {
    const match = String(pathname || '').match(/^\/api\/tidal\/artwork\/(artist|album|track|playlist)\/([A-Za-z0-9-]+)$/);
    if (!match) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return true;
    }
    const entry = cache.resolve(match[1], match[2]);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Artwork not cached');
      return true;
    }
    let stat;
    try {
      stat = fs.statSync(entry.path);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Artwork not cached');
      return true;
    }
    res.writeHead(200, {
      'Content-Type': entry.contentType || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400, immutable'
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    fs.createReadStream(entry.path).on('error', error => {
      console.warn('TIDAL artwork read failed:', error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }).pipe(res);
    return true;
  }

  function stats() {
    return { ...cache.stats(), queued: populateQueue.length, workers, concurrency };
  }

  return { cache, decorateItems, decorateLibraryResult, serve, stats };
}

module.exports = { createTidalArtworkHttp };

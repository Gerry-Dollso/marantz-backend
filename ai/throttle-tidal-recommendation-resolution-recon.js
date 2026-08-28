'use strict';

// Guarded migration: pace the read-only TIDAL recommendation metadata batch
// and retry HTTP 429 responses with backoff. No HEOS/player commands are added.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const marker = 'TIDAL_RECOMMENDATION_RECON_PACING_V1';
if (source.includes(marker)) {
  console.log('TIDAL recommendation recon pacing already present; no changes made.');
  process.exit(0);
}

const oldBlock = `    const results = [];
    for (const item of unique) {
      try {
        const metadata = await probeTrackMetadata(item.id);
        results.push({ source: item.source, id: item.id, ok: true, metadata });
      } catch (error) {
        results.push({ source: item.source, id: item.id, ok: false, error: error.message });
      }
    }

    return { count: results.length, tracks: results };`;

const newBlock = `    const results = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); // TIDAL_RECOMMENDATION_RECON_PACING_V1
    for (const item of unique) {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (results.length > 0 || attempt > 0) {
          await sleep(attempt > 0 ? 2500 : 1000);
        }
        try {
          const metadata = await probeTrackMetadata(item.id);
          results.push({ source: item.source, id: item.id, ok: true, metadata });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!/HTTP 429/i.test(String(error.message || ''))) break;
        }
      }
      if (lastError) {
        results.push({ source: item.source, id: item.id, ok: false, error: lastError.message });
      }
    }

    return { count: results.length, tracks: results };`;

if (!source.includes(oldBlock)) {
  throw new Error('Expected recommendation batch loop not found; no changes made');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);
console.log('Added pacing and HTTP 429 retry to TIDAL recommendation-resolution recon.');

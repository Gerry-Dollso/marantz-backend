const fs = require('fs');

const marker = '<!-- TASK3_TIDAL_LANDING_MIXES_2026_09_16 -->';
const section = marker + '\n## 2026-09-16 — TIDAL landing / Mixes & Radio accepted\n\nTask 3 of the post-catalogue UI/control phase is production-accepted. The Pi TIDAL landing page now has six local line-icon shortcuts: Playlists, Artists, Albums, Tracks, Mixes & Radio and Genres. Genres restores the existing HEOS/TIDAL genre browse surface and live testing returned artwork correctly. Videos were deliberately omitted.\n\nMixes & Radio is no longer built from the incomplete recommendations endpoints. The backend walks the official TIDAL saved playlist collection, bulk-loads playlist metadata, preserves relationship order and selects resources with `playlistType === "MIX"`. This is the canonical discriminator: do not use names, hard-coded IDs, HEOS subtraction or the old recommendation list. The 2026-09-16 acceptance snapshot was 53 saved playlist references and 19 MIX resources with zero unresolved metadata IDs; counts are snapshots, not constants. The collection naturally included My New Arrivals, Artist Radio, Track Radio, history/listening mixes, My Most Listened and My Mix 1–8.\n\nThe backend returns official TIDAL playlist artwork directly and the Pi renders that artwork without the old per-MIX enrichment requests. Existing official playlist-detail and TIDAL-to-HEOS resolver paths remain the playback mechanism. Touchscreen acceptance passed TRICKY Artist Radio browse, Turnip Farm Track Radio browse/playback, My Mix 8 playback and Genres artwork.\n\nCanonical checkpoints: backend production `d075c78`, backend cleanup `5da1641`, backend documentation head before this roll-up `4ad1725`; companion Pi production `e98c1e1`, cleanup `d94b55d`, documentation `2530d9c`. Detailed record: `docs/TIDAL_MIXES_RADIO_2026-09-16.md`.\n\nCurrent Queue, Now Playing favourite heart and TIDAL landing/Mixes & Radio are complete. **Next active task: richer Artist Page.** Now Playing Track Radio was discussed and deliberately left as a later task.\n\n';

for (const path of ['README.md', 'CHANGELOG.md', 'CURRENT_HANDOVER.md']) {
  const old = fs.readFileSync(path, 'utf8');
  if (old.includes(marker)) throw new Error(`${path}: marker already present`);
  const firstBreak = old.indexOf('\n');
  if (firstBreak < 0) throw new Error(`${path}: no heading line`);
  const updated = old.slice(0, firstBreak + 1) + '\n' + section + old.slice(firstBreak + 1);
  fs.writeFileSync(path, updated);
  console.log(`Updated ${path}`);
}

'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'README.md');
const before = fs.readFileSync(file, 'utf8');

const oldLine = 'Next TIDAL UI migration target: move My Music Artists, Albums and Playlists from the older HEOS browse-led display path to fast/rich official TIDAL catalogue data where deterministic playback identity can be preserved.';
const newSection = `## 2026-09-14 — Official TIDAL My Music catalogue migration complete

The official-TIDAL catalogue migration is now production-accepted for **Favourite Tracks, Artists, Albums and ordinary My Music Playlists**. The governing architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**.

- Artists: 393 official collection references resolve to 392 live official artist resources; the one unresolved reference is stale/unavailable. The live 392 IDs match HEOS after that stale reference is omitted. Endpoint: \`GET /api/tidal/favourite-artists\`.
- Albums: all 1,535 official collection relationship IDs match HEOS; rich official metadata currently resolves 1,482 resources, with 53 unresolved/stale references. Endpoint: \`GET /api/tidal/favourite-albums\`.
- Artists and Albums preserve HEOS-compatible \`LIBARTIST-*\` / \`LIBALBUM-*\` CIDs, so existing HEOS drill-in and playback remain unchanged. Live touchscreen acceptance proved artist/album drill-in, album PLAY RANDOM and ordinary album-track PLAY NOW.
- Ordinary Playlists use the **live exact-ID intersection** of the official TIDAL user-playlist collection and the two live HEOS ordinary branches, Created by me and Favorited. This is deliberately dynamic: no current playlist IDs or personalised Mix/Radio exclusions are hard-coded.
- Playlist acceptance snapshot: 53 official relationship IDs over 3 pages; HEOS 13 Created by me + 21 Favorited = 34 ordinary playlists; all 34 were present officially, HEOS-only count was zero, and the 19 official-only resources were personalised Mixes/Radio. Counts are a snapshot, not permanent invariants.
- Both \`USER\` and \`EDITORIAL\` ordinary playlists are valid; do not filter by playlist type. Official metadata/artwork is mapped by ID and HEOS grouping/order plus playable \`LIBPLAYLIST-*\` CIDs are preserved. Endpoint: \`GET /api/tidal/favourite-playlists\`.
- Playlist catalogue building is read-only and uses a five-minute stale-while-revalidate cache. Existing \`LIBPLAYLIST-*\` drill-in and playback/actions remain HEOS-backed. Live touchscreen acceptance proved both branches, rich artwork, playlist drill-in, PLAY NOW, PLAY ALL and SHUFFLE ALL.
- Personalised My Mix/Radio remains a separate resolver architecture. Do not reopen the closed Sugarcubes/Birthday work merely for ordinary playlist catalogue changes.

Detailed migration records are in \`docs/TIDAL_ARTISTS_ALBUMS_2026-09-13.md\`, \`docs/TIDAL_FAVOURITE_TRACKS_2026-09-07.md\` and \`docs/TIDAL_PLAYLISTS_2026-09-14.md\`.

Current ordinary-Playlists production/cleanup checkpoints:

\`\`\`text
Backend production: 43902d1 — Add official TIDAL ordinary Playlists catalogue
Backend cleanup:    0f6bf7b — Remove ordinary Playlists migration helpers
Pi production:      d2f96e4 — Use official TIDAL ordinary Playlists UI
Pi cleanup:         1e810ed — Remove ordinary Playlists UI migration helper
\`\`\``;

if (!before.includes(oldLine)) {
  throw new Error('README guard failed: obsolete migration-target line not found exactly once');
}
if (before.split(oldLine).length !== 2) {
  throw new Error('README guard failed: obsolete migration-target line is not unique');
}
if (before.includes('## 2026-09-14 — Official TIDAL My Music catalogue migration complete')) {
  throw new Error('README guard failed: new catalogue section already exists');
}

const after = before.replace(oldLine, newSection);
fs.writeFileSync(file, after);
console.log('README.md: replaced obsolete migration target with accepted catalogue checkpoint');
console.log('No source/runtime files modified.');

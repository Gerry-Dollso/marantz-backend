const fs = require('fs');

const files = ['README.md', 'CHANGELOG.md', 'CURRENT_HANDOVER.md'];
const marker = '<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->';
const nextMarker = '<!-- TASK3_TIDAL_LANDING_MIXES_2026_09_16 -->';
const replacement = String.raw`<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->
## 2026-09-17 — Rich TIDAL Artist page production accepted

The richer Artist Page phase is now **complete and accepted on the physical 8-inch 1080p MarantzPi touchscreen**. The governing architecture remains **official TIDAL API for what the user sees; HEOS for what the user hears**.

### Accepted architecture

Artist Details core is deliberately separated from expensive secondary enrichment. The landing core keeps official TIDAL artist metadata/artwork, HEOS-backed release previews, Artist Radio and Similar Artists. Top Tracks and biography load lazily and persist independently, so they do not block the core Artist landing response.

The landing layout is now intentionally bounded to **4 genuine popularity-ranked Top Tracks in a fixed 2x2**, **3 Albums**, **3 EPs & Singles** and **3 Appears On**. Full release categories are not packed into the landing payload. The compact category control loads the complete requested HEOS category on demand and enriches those exact release identities with official TIDAL metadata/artwork. The backend route is GET /api/tidal/artist-releases?id=<artistId>&category=<albums|singles|appears>; the Pi proxies the same route. Do not deduplicate releases merely because titles/artwork appear similar: separate TIDAL catalogue versions are legitimate unless identity evidence proves otherwise.

Top Tracks correctness remains non-negotiable. Official TIDAL Artist track relationships do not provide the app's Top Tracks order, so the backend crawls the relationship, de-duplicates, sorts by official TIDAL popularity, and persistently stores the ranked top 10. The landing shows the first four; the full Top Tracks page shows all 10. Never replace this with the first four raw relationship tracks. Production endpoint: GET /api/tidal/artist-top-tracks?id=<artistId>, optional refresh=1; persistent store: /var/lib/marantz-backend/artist-top-tracks/<artistId>.json.

Biography is also lazy and persistent through GET /api/tidal/artist-biography?id=<artistId> and /var/lib/marantz-backend/artist-biographies/<artistId>.json. Null biography results are valid and persisted; not every artist has a resolved biography. The MusicBrainz -> Wikidata -> Wikipedia enrichment chain remains unchanged.

Persistent backend roots are /var/lib/marantz-backend/artwork, /var/lib/marantz-backend/artist-details, /var/lib/marantz-backend/artist-top-tracks and /var/lib/marantz-backend/artist-biographies. A sequential cache warmer, ai/warm-tidal-artist-cache.js, pre-populates favourite Artist details, Top Tracks and biography without hammering external services. The completed pass processed 391 of 392 favourite artists; BODEGA TIDAL ID 3644091 was the single HTTP 429 failure and should not be repeatedly hammered. BODEGA IDs 3644091 and 43627077 are separate TIDAL profiles for the same real-world band and must not be automatically merged.

### Runtime and touchscreen acceptance

Backend full-category production checkpoint is **c1d578f — Add full Artist release loading**. The Afghan Whigs, TIDAL Artist ID 672, Albums endpoint returned **14/14**, from Soft Control through Up In It, with official TIDAL enrichment. The measured full-category request was about **0.875 s**, so no additional full-category cache layer was required.

Companion Pi production checkpoint is **c5841e6 — Load full Artist categories on demand** on branch housekeeping-2026-08-21. The Pi -> HP proxy was runtime-proven with the same Afghan Whigs **14/14** result. Physical touchscreen acceptance then confirmed the Artist headers/categories open their complete lists, the landing remains bounded after returning from a full category, and the intended **3-release previews / 4-Top-Tracks landing** is restored on Back. This is the acceptance boundary: backend curl/syntax tests alone are never sufficient for MarantzPi UI completion.

The Pi lazy-load implementation uses the Artist request token/current Artist ID as a navigation guard, so a late release, Top Tracks or biography response cannot update a different Artist page after navigation. Existing album drill-in and track actions remain on their established HEOS-backed paths.

### Production checkpoints

Backend repository Gerry-Dollso/marantz-backend, branch local-ai-development, runtime /opt/marantz-backend, system service marantz-backend.service, HTTP port 3100. Current accepted Artist production head before this documentation roll-up: **c1d578f**.

Companion Pi repository Gerry-Dollso/marantzPI, branch housekeeping-2026-08-21, runtime ~/marantz-now-playing, user service marantz-display.service, HTTP port 3000. Current accepted Artist production head before its documentation roll-up: **c5841e6**.

Important Artist-phase checkpoints include 97a09d6 core performance, 3172044 3/3/3 release previews, 0994b54 lazy persistent Top Tracks, 6103aa3/aa8f276 persistent biography, eb5885a sequential Artist cache warmer, and c1d578f full release loading. Companion Pi checkpoints include 05ce9f1 persistent artwork proxy, 228cb39 8-inch layout, b141a76 lazy rich Artist data and c5841e6 full categories on demand.

### Mandatory working method

The user works primarily from Android phone/tablet using Termius. Commands must be single-line, short, sequential and copy/paste safe; label HP/Pi and read-only/mutating, then wait for output. A 👍🏻 means agree/continue and can represent expected blank output. Use GitHub first for repository inspection and substantial/interconnected edits; Termius is for runtime evidence, deployment/testing and small bounded edits. Never guess source/API shapes when GitHub or the official TIDAL OpenAPI can answer them. Before new TIDAL API probes, inspect the current official OpenAPI. User-entered/name-based search still uses HEOS; official TIDAL rich metadata is available once an exact Artist ID is known.

For touched JavaScript run node --check; before restart/commit run git diff --check and inspect the actual diff. HP marantz-backend.service is a system service; Pi marantz-display.service is a user service. Never touch marantz-mic-stream.service. Credentials stay outside Git in /etc/marantz-backend/tidal.env. Finish accepted checkpoints committed/pushed with blank git status --short.

### Next work

The richer Artist Page is no longer the active unfinished task. **Track Radio remains deliberately on the back burner.** Any next feature should start from these accepted clean checkpoints rather than reopening Artist-page architecture that has already passed physical touchscreen acceptance.

`;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(marker);
  const end = text.indexOf(nextMarker);
  if (start < 0 || end < 0 || end <= start) throw new Error(file + ': expected Artist handover markers not found exactly');
  if (text.indexOf(marker, start + marker.length) >= 0) throw new Error(file + ': duplicate Artist marker');
  const updated = text.slice(0, start) + replacement + text.slice(end);
  fs.writeFileSync(file, updated);
}
console.log('Updated completed Artist handover in README, CHANGELOG and CURRENT_HANDOVER');

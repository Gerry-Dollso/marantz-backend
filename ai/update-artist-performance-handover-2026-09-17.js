const fs = require('fs');

const files = ['README.md', 'CHANGELOG.md', 'CURRENT_HANDOVER.md'];
const start = '<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->';
const end = '<!-- TASK3_TIDAL_LANDING_MIXES_2026_09_16 -->';

const block = `${start}
## 2026-09-17 — Artist landing performance checkpoint (backend accepted; final Pi redesign pending)

The governing architecture remains **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not treat the richer Artist Page as fully finished yet: the backend performance architecture below is live and runtime-proven, but the final compact 8-inch Pi Artist landing redesign and touchscreen acceptance are still pending.

### Current accepted HP backend architecture

Artist Details core is deliberately separated from expensive secondary enrichment. The landing core keeps official TIDAL artist metadata/artwork, HEOS-backed release previews, Artist Radio and Similar Artists, but **Top Tracks and biography no longer block the core Artist Details response**. Biography is available lazily through \`GET /api/tidal/artist-biography?id=<id>\`. Top Tracks is available lazily through \`GET /api/tidal/artist-top-tracks?id=<id>\`.

HEOS landing release previews are now genuinely bounded at the backend to **3 Albums, 3 EPs & Singles and 3 Appears On** entries. Do not revert to fetching complete HEOS release categories for the landing page. Full-list views must be loaded lazily from dedicated/full retrieval paths rather than assuming the truncated core payload is complete.

Top Tracks correctness is non-negotiable. Official TIDAL Artist \`tracks\` relationships do not expose a documented server-side popularity sort or a separate app-ranked Top Tracks relationship. Existing \`getAllTracks()\` therefore crawls the Artist track relationship, de-duplicates and sorts by official TIDAL \`popularity\`, then keeps the ranked result. Earlier empirical testing proved raw relationship order is not Top Tracks order: for the tested artist, \`Judith\` was 12th in raw relationship order but ranked #1 after official popularity sorting, matching the TIDAL app. **Never replace this with the first four raw relationship tracks.** The landing UI may display only four, but the genuine ranking calculation remains authoritative.

Top Tracks is now lazy and persistently cached. Production endpoint: \`GET /api/tidal/artist-top-tracks?id=<artistId>\`, with optional \`refresh=1\`. The persistent store is \`/var/lib/marantz-backend/artist-top-tracks/<artistId>.json\`, using atomic temp-file/rename writes, 24-hour freshness and a 30-day maximum stale window. It retains the existing 15-minute memory cache, in-flight de-duplication and stale-while-refresh behaviour. Current backend code stores the existing **top 10 ranked tracks**; the planned landing view displays the first four. Do not call those 10 a complete artist track list.

Runtime proof used favourite artist **TRICKY, TIDAL ID 27444**. Before the 3/3/3 release limit, forced Artist Details took **20.532 s**. After 3/3/3 it took **14.258 s**, with Top Tracks still consuming **10.318 s**. After removing Top Tracks from the critical path, forced core Artist Details took **3.894 s**. The first separate lazy Top Tracks request took **10.455 s**, the immediate RAM hit took **0.000781 s**, and after a complete \`marantz-backend.service\` restart the same request took **0.002326 s** with \`cached:true\`, \`cacheSource:'disk'\`, \`trackCount:10\`. The verified first four were \`Hell Is Round The Corner\`, \`Black Steel\`, \`Overcome\`, \`Aftermath\`. This proves the expensive genuine ranking is moved off the landing critical path and survives process restart.

### Production checkpoints through this handover

Backend repository \`Gerry-Dollso/marantz-backend\`, branch \`local-ai-development\`, runtime \`/opt/marantz-backend\`, system service \`marantz-backend.service\`, HTTP port 3100.

- \`97a09d6 — Optimize Artist Details cold loading\`
- \`aa34f70 — Make Artist biography load lazily\`
- \`3172044 — Limit Artist landing release previews\`
- \`d7debb5 — Add persistent Artist Top Tracks store\`
- \`3d93282 — Add guarded lazy persistent Artist Top Tracks updater\`
- \`ef89872 — Add guarded Artist Top Tracks route updater\`
- \`0994b54 — Make Artist Top Tracks lazy and persistent\`

The production Top Tracks changes passed \`node --check server.js\`, \`node --check tidal-artist-details.js\` and \`git diff --check\`, were runtime-proven as above, committed as \`0994b54\`, and pushed to \`origin/local-ai-development\` before this documentation roll-up.

### Persistent caches and known caveat

Existing persistent roots remain \`/var/lib/marantz-backend/artwork\`, \`/var/lib/marantz-backend/artist-details\`, plus new \`/var/lib/marantz-backend/artist-top-tracks\`. Artwork list performance was fixed by batching touch-index writes; accepted timings were about **0.0189 s for Artists** and **0.0466 s for Albums**. The Pi binary artwork proxy regression was also fixed and touchscreen-confirmed for both lists.

**Biography persistence is still outstanding.** The lazy biography resolver currently has a 7-day RAM cache, but there is not yet a dedicated persistent biography disk store. Newly refreshed core Artist Details records contain \`biography:null\`. The agreed next backend cleanup is to persist biography separately (prefer the existing store pattern, e.g. \`/var/lib/marantz-backend/artist-biographies/<artistId>.json\`, atomic writes, stale handling) before calling the Artist architecture complete. Do not falsely claim biography persistence is already preserved.

### Immediate next work — do not skip touchscreen acceptance

Before changing Pi source, inspect the actual GitHub state of \`Gerry-Dollso/marantzPI\`, branch \`housekeeping-2026-08-21\`; do not ask the user to grep source that GitHub can provide. The physical MarantzPi uses an **8-inch 1080p touchscreen**.

Agreed final landing design: **4 Top Tracks in a fixed 2×2 layout**, **3 Albums**, **3 EPs & Singles**, **3 Appears On**, no preview scrollbars, and a compact end-of-row full-list control such as \`›\` or \`…\` instead of the large SEE ALL control. Similar Artists should be inspected before deciding whether the same 3-item treatment applies. Core Artist Details should render immediately; Top Tracks and biography should fill asynchronously with a navigation/request-token guard so late responses cannot update a page the user has left.

Because the core release arrays are now deliberately truncated, inspect and implement proper lazy full-list retrieval for Albums, EPs & Singles and Appears On. Existing SEE ALL/full-list behaviour must not silently show only the three preview entries. Likewise, the Top Tracks endpoint currently returns the ranked top 10; determine from the existing Pi UX whether the full Top Tracks page is intended to mean those 10 or something broader before labelling it.

**Final acceptance must happen on the actual 8-inch touchscreen.** Backend syntax checks, diffs and curl timings are not sufficient. Verify fast core appearance, asynchronous Top Tracks/biography, fixed 2×2 Top Tracks, three-card release rows, no preview scrollbars, working compact full-list controls, genuinely complete intended full-list pages, and safe navigation while lazy requests are in flight. Only after that acceptance should Pi documentation say the redesign is complete.

### Mandatory working method

The user works primarily from Android phone/tablet using Termius. Commands must be single-line, short, sequential and copy/paste safe; label HP/Pi and read-only/mutating, then wait for output. A 👍🏻 means agree/continue and can represent expected blank output. Use GitHub first for repository inspection and substantial/interconnected edits; Termius is for runtime evidence, deployment/testing and small bounded edits. Never guess source/API shapes when GitHub or the official TIDAL OpenAPI can answer them. Before new TIDAL API probes, inspect the current official OpenAPI. User-entered/name-based search still uses HEOS; official TIDAL rich metadata is available once an exact Artist ID is known.

For touched JavaScript run \`node --check\`; before restart/commit run \`git diff --check\` and inspect the actual diff. HP \`marantz-backend.service\` is a system service; Pi \`marantz-display.service\` is a user service. Never touch \`marantz-mic-stream.service\`. Credentials stay outside Git in \`/etc/marantz-backend/tidal.env\`. Finish accepted checkpoints committed/pushed with blank \`git status --short\`.

`;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error(`${file}: handover markers not found in expected order`);
  fs.writeFileSync(file, text.slice(0, a) + block + text.slice(b));
}

console.log('Updated README.md, CHANGELOG.md and CURRENT_HANDOVER.md with current Artist performance handover');

'use strict';

const fs = require('fs');

const marker = '<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->';
const summary = `${marker}
## 2026-09-17 — Rich Artist Page and persistent TIDAL caches accepted

The richer Artist Page phase is complete and live. The governing architecture remains **official TIDAL API for what the user sees; HEOS for what the user hears**. The Artist landing page uses official TIDAL artist metadata/artwork, Top Tracks and Similar Artists, biography enrichment, and HEOS-backed release categories/playback. The Pi landing view is deliberately compact: Top Tracks plus four-item section previews, with dedicated **SEE ALL ›** pages; only the SEE ALL text is clickable, not the whole heading. Preserve the tested HEOS release/playback paths rather than trying to replace playback with direct TIDAL playback.

The HP now has persistent official-TIDAL artwork caching under \`/var/lib/marantz-backend/artwork\`. Acceptance snapshot: 392 favourite-artist images + 1,482 favourite-album images = 1,874 local files, about 56 MB. \`library-state.json\` records the authoritative Artist/Album key sets and survives restart. Artwork is served through \`/api/tidal/artwork/<kind>/<id>\` with immutable browser caching. Reconciliation only runs after complete authoritative Artist and Album sets are known. The known Artist collection state is 393 relationship references resolving to 392 live resources with stale/unresolvable reference ID \`32968323\`; this stale relationship must not block housekeeping. The final helper/live-logic alignment is commit \`d672211\`.

The HP also now persists complete Artist Details JSON under \`/var/lib/marantz-backend/artist-details/<artistId>.json\`. The store uses embedded \`createdAt\` timestamps, atomic temp-file/rename writes, 24-hour freshness and a 30-day maximum stale window. Fresh disk records are returned immediately after process restart. Stale-but-usable records are returned immediately as \`cacheSource: disk-stale\` while one background refresh rebuilds the expensive hybrid Artist payload; a successful refresh atomically replaces the stale record. The existing 15-minute memory cache and in-flight de-duplication remain. Persistent Artist Details production commit is \`5c9cf1e\`.

Runtime acceptance proved the persistence behaviour across complete backend restarts. The original uncached Artist build took about 7 seconds; after persistence, a restart request completed in about 0.03 s and explicitly reported \`cached:true, cacheSource:'disk'\`. A controlled 48-hour-old embedded \`createdAt\` test returned stale data in about 0.11 s with \`refreshing:true\`, then background refresh replaced it with a fresh timestamp. The test artist was Coluche, TIDAL ID \`1386\`. **Do not call ID 1386 Tricky.** Tricky is a favourite artist and the current favourite-artists response identifies him as \`{ id: '27444', name: 'TRICKY' }\`.

Important API/diagnostic lesson: production \`GET /api/tidal/favourite-artists\` exposes its resolved list as top-level \`artists\`, not \`items\`. Internally \`getFavouriteArtists()\` uses \`getOfficialLibrary('artists')\`, whose internal value uses \`items\`, but \`server.js\` maps/decorates those to the public \`artists\` field. A 17 Sep diagnostic mistakenly inspected \`j.items\` and therefore falsely reported that Tricky was absent. Never infer collection membership from that failed diagnostic. The verified public endpoint returned \`count:392\` and \`artists.length:392\`; filtering that returned array locally found Tricky ID \`27444\`. This was local filtering of already-returned favourites, **not TIDAL text search**.

Official TIDAL catalogue text search remains unavailable for this developer integration. Do not try to solve name search by guessing TIDAL endpoints or IDs. User-entered/name-based search still uses HEOS; once an exact TIDAL ID is known, official TIDAL metadata can be used. Before any new TIDAL API probe, inspect the current official TIDAL OpenAPI/schema and existing repository implementation first. Do not repeat already-closed HEOS/TIDAL identity reconnaissance without new evidence.

### Current backend checkpoint

Backend repository \`Gerry-Dollso/marantz-backend\`, live branch \`local-ai-development\`, runtime \`/opt/marantz-backend\`, system service \`marantz-backend.service\`, HTTP port 3100. The production code/cache work was clean and pushed through:

\`54e5a99 — Add persistent TIDAL artwork cache and safe housekeeping\`
\`5c9cf1e — Add persistent TIDAL artist details cache\`
\`d672211 — Align artwork housekeeping helper with live logic\`

Immediately before this documentation update, \`git push origin local-ai-development && git status --short\` pushed \`5c9cf1e..d672211\` successfully and status was blank. The Tricky correction required no source-code change.

### Current project position

Completed: Current Queue read-only viewer; Now Playing TIDAL favourite heart; TIDAL landing artwork/categories and canonical Mixes & Radio; richer Artist Page; persistent favourite Artist/Album artwork; persistent Artist Details stale-while-refresh cache. Now Playing Track Radio remains deliberately parked/back-burner. Do not reopen completed work merely to re-prove it.

The Pi Artist UI is implemented and active. The Pi repository remains \`Gerry-Dollso/marantzPI\`, branch \`housekeeping-2026-08-21\`, runtime \`~/marantz-now-playing\`, user service \`marantz-display.service\`. At the end of this phase the Pi had local Artist-page changes in \`public/index.html\`, \`public/tidal-artist-ui.js\` and \`server.js\`; the final small UI correction made only **SEE ALL ›** clickable. Before any future Pi commit/reset/merge, inspect its actual local Git status/diff first; do not assume it is clean and do not discard those tested local changes.

### Mandatory working method for the next chat

The user works primarily from Android phone/tablet using Termius and is not a software developer. Keep terminal commands **single-line, short, sequential and copy/paste safe**. Clearly label **HP** or **Pi** and read-only vs mutating. Wait for pasted output before the next command. A 👍🏻 means agree/continue and can also represent expected blank output; continue implementation after it rather than repeating the plan. A 👎🏻 means investigate. If pasted output visually ends in \`(END)\`, assume the user has already exited the pager and is back at the prompt.

Use **GitHub first** for repository inspection and substantial/interconnected edits. Use Termius for runtime evidence, deployment/testing and genuinely small bounded edits where the exact insertion is known. Never ask the user to paste large source files when GitHub can provide them. Never guess paths, API fields, ownership, service names, IDs or response shapes. Inspect first. For touched JavaScript run \`node --check\`; before restart/commit run \`git diff --check\` and inspect the exact diff. Restart only the affected service. Finish accepted work committed/pushed with blank \`git status --short\`.

Avoid multiline/escape-heavy shell editing and huge raw JSON in Termius. Prefer small Node summaries for runtime JSON. Avoid Bash history-expansion traps involving \`!\` in double-quoted commands. Avoid chained pager-producing Git commands; use \`git --no-pager diff\` and bounded output instead. Safety first, fastest safe method second.

HP backend service is a **system** service. Pi \`marantz-display.service\` is a **user** service. Never touch unrelated \`marantz-mic-stream.service\` during display/backend work. Credentials remain outside Git in \`/etc/marantz-backend/tidal.env\`; never print, move or commit them. Do not mutate TIDAL favourites/playlists, HEOS queue or AVR state during reconnaissance without explicit agreement.

Persistent runtime data belongs outside the repository. Current cache roots are \`/var/lib/marantz-backend/artwork\` and \`/var/lib/marantz-backend/artist-details\`, owned/writable by runtime user \`gerry\`. The HP OS/NVMe has ample space; the artwork snapshot used only about 56 MB. Do not move these caches to the media drive merely because it exists.

`;

for (const file of ['README.md', 'CHANGELOG.md', 'CURRENT_HANDOVER.md']) {
  const old = fs.readFileSync(file, 'utf8');
  if (old.includes(marker)) throw new Error(file + ' already contains handover marker');
  const firstBreak = old.indexOf('\n');
  if (firstBreak < 0) throw new Error('No heading line in ' + file);
  fs.writeFileSync(file, old.slice(0, firstBreak + 1) + '\n' + summary + old.slice(firstBreak + 1));
}

console.log('Updated README.md, CHANGELOG.md and CURRENT_HANDOVER.md');

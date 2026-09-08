# TIDAL Favourite Tracks — official API / TIDAL UI / HEOS discrepancy

Date: 2026-09-07

This document records the read-only reconnaissance performed before migrating MarantzPi `TRACKS` / Favourite Tracks from HEOS-backed display data to official TIDAL metadata. Preserve these findings so future work does not repeat the investigation or mistake the HEOS representation for the user's real visible TIDAL collection.

## Architecture context

The target architecture remains:

- **official TIDAL API = what the user sees / rich catalogue metadata**
- **HEOS = what the user hears / SR8015 playback transport**
- identity and playback correlation must remain deterministic and fail closed; AI/fuzzy matching must not invent track identity.

Unlike personalised My Mixes, Favourite Tracks is directly exposed by HEOS as `My Music-Tracks`. This should be exploited for deterministic playback context, but the HEOS browse representation must not automatically be treated as authoritative display/catalogue data.

## Observed live collection counts

Read-only probes and direct inspection established three different views of the same Favourite Tracks collection:

### TIDAL consumer UI

The user's TIDAL Favourite Tracks screen visibly contains **594 tracks**. The final visible item is numbered 594.

### Official TIDAL user-collection API

The relationship endpoint returned **635 unique saved track references** across 32 pages:

- 594 IDs are current/live track resources.
- 41 IDs are stale/historical references for which current track-resource lookup fails/omits the resource.
- the official relationship itself contained no duplicate IDs in this 635-reference snapshot.

### HEOS `My Music-Tracks`

HEOS returned and the official HEOS app visibly displayed **635 rows**, but only **594 unique MIDs**:

- 594 unique HEOS MIDs correspond to the 594 live/current official TIDAL IDs.
- there are 41 excess HEOS row occurrences.
- 40 HEOS MIDs occur more than once; 39 occur twice and one MID occurs three times, producing 41 excess occurrences in total.
- `heosUniqueOnlyCount` was zero: HEOS did not expose a separate set of 41 old/stale unique MIDs.

## Strong deterministic ordering result

The decisive read-only comparison was:

1. remove the 41 stale/unresolvable references from the 635 official TIDAL relationship;
2. deduplicate the 635 HEOS rows by MID, retaining first-occurrence order.

Both sides then contain **594 IDs and the two 594-ID sequences are exactly identical in order** (`dedupedSameOrder: true`).

This is much stronger than a title/fuzzy match and is the main reason the 594 live official IDs are the correct candidate set for the new Favourite Tracks display path.

## HEOS repeated-block behaviour is real and is not MarantzPi code

The user inspected Favourite Tracks directly in the official HEOS mobile app. HEOS reports 635 tracks and visibly contains repeated contiguous blocks. The same repeated rows were present in raw HEOS reconnaissance, so this behaviour is upstream of MarantzPi and is not introduced by the Pi/backend UI code.

Examples observed in the HEOS app / raw HEOS data include repeated sequences such as:

- `1969` → `I Like It` → `Mother Mary` → `Son of a Gun`
- `Pretty In Pink` → `She Sells Sanctuary` → `The Passenger`
- `What Needs Must Be` → `Loss Leader`
- `Sweet Young Thing Ain't Sweet No More` → `Salad Days` → `Used For Glue`
- `Winn Coma` → `Rule the Beast` → `Ski Bunny` → `Don't Want to Know If You Are Lonely`
- `Cut Your Hair` → `The Reproduction Of Death` → `Green Machine`
- a longer block containing `Creepy Jackalope Eye`, `Behemoth`, `Born Slippy`, `Try Honesty`, `Bastards of Young` and `Sweet Dreams`.

The repeated HEOS entries are playable. The TIDAL consumer Favourite Tracks UI does **not** show these HEOS-style repeated blocks and reports 594 tracks rather than 635.

## What is proven vs inferred

### Proven by observation/probes

- TIDAL consumer UI: 594 visible Favourite Tracks.
- Official collection relationship: 635 unique references in the captured snapshot.
- 594 official IDs are live/current; 41 captured relationship IDs are stale/unresolvable as current track resources.
- HEOS: 635 rows, 594 unique MIDs, 41 excess duplicate occurrences.
- every unique HEOS MID belongs to the 594 live official-ID set.
- after stale-reference removal / HEOS deduplication, the same 594 IDs remain in exactly the same order.
- official HEOS app itself displays the repeated-block behaviour, independently of MarantzPi.
- repeated HEOS rows can play.

### Plausible but NOT proven internally

A strong working hypothesis is that historical/unavailable saved references remain in an underlying TIDAL collection relationship, while TIDAL's consumer Favourite Tracks UI suppresses them. HEOS appears to mishandle that state and emits repeated current/playable rows rather than suppressing the obsolete references.

Do **not** document as fact that HEOS "saved both old and new IDs" or that a particular stale TIDAL ID maps to a particular repeated HEOS MID. The data does not show 41 old unique MIDs in HEOS, and anchor-gap analysis did not establish local 1:1 stale-to-duplicate mappings.

## Failed/closed positional-mapping idea

A shared-anchor gap probe tested whether each stale official reference could be paired positionally with a repeated HEOS row between the same neighbouring live IDs. It did **not** support that model:

- official stale total: 41
- HEOS excess duplicate total: 41
- gap totals account for all 41 on both sides
- local gap counts do not align
- `exactStructuralAlignment: false`

The repeated HEOS rows often occur in blocks at different positions from the stale official references. Do not infer stale-ID replacement mappings from raw row position.

## Final 594-track metadata validation

The final row-for-row read-only validation compared the 594 current official TIDAL tracks with the 594 HEOS rows after first-occurrence MID deduplication.

Authoritative result:

- official raw references: 635
- official live/current tracks: 594
- HEOS raw rows: 635
- HEOS unique MIDs: 594
- same ID order: **true**
- exact primary artist: **594/594**
- exact album: **594/594**
- exact album ID: **594/594**
- normalized title + artist identity: **593/594**
- full identity matches: **593/594**
- mismatch count: **1**

The only genuine display discrepancy was track ID `77638341`, Sonic Youth, album `Dirty`: official TIDAL title `100%`, while HEOS exposed `100%25`. This is HEOS/transport-style encoding leakage, reinforcing that official TIDAL metadata should be the display authority.

### Primary artist rule discovered during validation

Do not use the first artist resource appearing in JSON:API `included[]` as the primary artist. `included[]` ordering is not semantic.

The correct primary artist is the **first artist linkage in `track.relationships.artists.data`**, resolved by ID against `included[]`.

This was verified with tracks including:

- Massive Attack — `I Against I` (Mos Def also included)
- Massive Attack — `Teardrop` (Elizabeth Fraser also included)
- Gorillaz — `Feel Good Inc.` (De La Soul also included)

The existing production-oriented `compactTrack()` already follows relationship linkage ordering and is the model to preserve.

## Official TIDAL API shape and performance reconnaissance

The final read-only API-shape probes established the efficient production mechanism rather than performing hundreds of individual track lookups.

### Collection relationship pagination

`/userCollectionTracks/me/relationships/items` is effectively capped at **20 saved references per page**. Supplying `page[limit]=50` or `100` did not increase the returned count.

For the captured 635-reference collection this means 32 relationship pages.

The relationship endpoint is useful for **membership and canonical saved order**, but it cannot directly include rich artist/album metadata. An attempted rich include on a relationship cursor returned HTTP 400 with:

`Invalid include path 'artists': 'artists' is unavailable. Available: [items]`

The root `/userCollectionTracks/me?include=...` can richly expand its first 20 items, but synthesizing `page[cursor]` on that root request did not advance it; repeated requests returned the first page again. Therefore do not build production pagination around root collection cursor synthesis.

### Bulk track metadata lookup

`/tracks` supports deterministic bulk lookup using `filter[id]` together with rich includes for artists, albums and album cover art.

Both comma-separated and repeated `filter[id]` forms worked in reconnaissance. Prefer one simple, consistent production form.

The hard maximum is **20 IDs per bulk request**. A request for 50 or 100 IDs returned HTTP 400 `INVALID_ARRAY_LENGTH` with `Filter accepts at most 20 values`.

A representative 20-track rich lookup returned all 20 resources in about **173 ms** in the captured run. Five-track probes returned in roughly 146–233 ms. These are observations, not latency guarantees.

### Stale-reference behaviour

This is an important production result. A bulk request containing four live IDs plus known stale reference `241512492` returned:

- HTTP 200
- four live track resources
- the stale ID omitted
- rich included metadata for the live resources
- no request-level error.

Therefore stale saved references can be filtered naturally by bulk track resolution: production does not need to make one failing `/tracks/<id>` request per saved reference.

### Bulk response ordering

Bulk `/tracks?filter[id]=...` responses did **not** preserve requested collection order in the probes.

Production must never trust bulk response order. Build an ID→resource map and reconstruct the live collection according to the original relationship-ID sequence.

## Canonical production design for Favourite Tracks

Do **not** reproduce the raw 635-row HEOS Favourite Tracks browse result on MarantzPi.

The intended display target is the same **594 current tracks visible in TIDAL**, using official TIDAL metadata. HEOS remains the playback transport and direct library context.

Canonical loader design:

```text
Official /userCollectionTracks/me/relationships/items
        ↓
collect canonical saved-reference order (20/page)
        ↓
635 saved IDs in captured snapshot
        ↓
split IDs into batches of at most 20
        ↓
bulk /tracks?filter[id]=... with artists/albums/cover art
        ↓
stale/unresolvable IDs are omitted by TIDAL
        ↓
index returned resources by track ID
        ↓
reconstruct in original relationship order
        ↓
594 current rich tracks in captured snapshot
        ↓
validate against unique HEOS My Music-Tracks identity/order
        ↓
MarantzPi displays official metadata
        ↓
HEOS performs playback
```

Because the 594 current official IDs already correspond to the 594 unique HEOS MIDs in identical order, Favourite Tracks should not require the expensive My-Mix trusted replacement resolver for normal current tracks. Preserve deterministic validation and fail closed if this invariant is not satisfied after a collection change.

The old HEOS browse/cache path should remain available as playback context, fallback/correlation evidence and diagnostics even after the display/catalogue path moves to official TIDAL.

## Cache / UX design direction

A naive cold rebuild would require approximately 32 sequential relationship reads plus 32 bulk metadata reads for the captured collection. Do not make the Pi perform or wait for that entire sequence every time Favourite Tracks opens.

Preferred direction, to be implemented and runtime-tested rather than assumed:

- backend owns the canonical Favourite Tracks collection;
- cache the last validated canonical collection;
- opening Favourite Tracks should normally be served from backend cache;
- refresh official data without blocking every UI open;
- use controlled concurrency where safe for independent 20-ID metadata batches;
- relationship pagination remains ordered/cursor-driven;
- validate refreshed identity against HEOS before allowing fresh collection state to drive deterministic playback;
- retain last-known-good validated state if a refresh is incomplete or fails, with diagnostics rather than fuzzy substitution.

The user's preference is a **continuous full Favourite Tracks list without restoring the old pager**, if the cached official-TIDAL implementation proves responsive enough. Do not promise this solely from reconnaissance timings; confirm with production/runtime testing.

## Production canonical cache and pacing validation — 2026-09-08

The canonical official-TIDAL Favourite Tracks loader is now implemented in `tidal-user-auth-recon.js` with an in-memory cache and one in-flight refresh. Production validation established:

- canonical live tracks: **594**
- saved relationship references: **635**
- stale references naturally omitted by bulk metadata resolution: **41**
- relationship pages: **32**
- metadata batches: **32**
- cold rebuild after final pacing: approximately **34.9 s** in the controlled run
- warm cached response: effectively immediate (sub-millisecond HTTP timing observed in the earlier warm test)
- stale-while-revalidate response: effectively immediate while background refresh proceeds.

TIDAL rate limiting required conservative pacing. The accepted production settings are:

- relationship-page delay: **500 ms**
- metadata concurrency: **1**
- metadata inter-batch delay: **250 ms**
- bounded exponential 429 retry remains enabled.

With these settings the controlled rebuild produced only **one first-level 429**, on metadata batch 32, versus 19 metadata 429s with concurrency 2. The retry succeeded and the complete 594-track canonical result remained correct. Chasing absolute zero 429s with additional fixed delay was not considered justified.

## Live production official ↔ HEOS validation — 2026-09-08

After the canonical cache was implemented, a dedicated **read-only** production route was added and run against the live backend. It performed no queue, playback, AVR, or collection mutation.

Observed live result after a backend restart/cold official cache:

- official current tracks: **594**
- official saved references: **635**
- official stale references: **41**
- HEOS reported rows: **635**
- HEOS raw/playable rows: **635**
- HEOS unique MIDs after first-occurrence deduplication: **594**
- HEOS duplicate excess occurrences: **41**
- exact official/HEOS ID-set match: **true**
- exact official/HEOS order match: **true**
- official-only IDs: **none**
- HEOS-only IDs: **none**

The first five IDs were identical on both sides:

`487926786`, `430143675`, `513907656`, `125226`, `501665`

The last five IDs were also identical:

`69724246`, `635819`, `3971684`, `33711684`, `2945500`

The complete cold validation request took approximately **50.6 s**, which included both rebuilding the cold official canonical cache and browsing the full 635-row HEOS collection. This is a diagnostic/cold-start observation, not the intended Pi screen-open latency.

This production result confirms the key invariant for the captured live library: the official 594-track canonical collection maps directly and deterministically to HEOS `My Music-Tracks` using the **same track ID as MID**, in the same logical order, after HEOS duplicate rows are ignored. Favourite Tracks therefore does **not** require the My-Mix trusted replacement resolver for this validated collection.

Do not generalise this as a universal TIDAL-ID-equals-HEOS-MID rule. It is specifically validated for the current direct HEOS `My Music-Tracks` library context; My Mixes retain their separate trusted resolver because their official IDs can differ from HEOS-playable identities.

## Fast production display endpoint and startup prewarm — 2026-09-08

The backend display path is now implemented and production-tested. Source checkpoint: `6f6ab2f` (`Add fast Favourite Tracks library endpoint`).

The backend now starts an asynchronous `getFavouriteTracks()` prewarm only after the HTTP server has begun listening. In the live restart test:

- backend listening: **11:46:18**
- one handled first-level TIDAL 429 occurred on metadata batch 28 at **11:46:49**
- prewarm completed with **594 tracks** at **11:46:52**
- backend availability was therefore not blocked by the approximately 34-second cache build.

Once prewarmed, the production read-only endpoint `/api/tidal/favourite-tracks` returned the complete 594-track rich official collection in approximately **15 ms** (`real 0m0.015s`) in the measured request. The response was verified as:

- `ok: true`
- `count: 594`
- `cached: true`
- `stale: false`
- `refreshing: false`
- first track ID: `487926786` — Lo Fidelity Allstars, `Battleflag`
- last track ID: `2945500` — Screaming Trees, `Shadow of the Season`
- rich official fields included artist/artist ID, album/album ID, duration, explicit flag, ISRC and 320×320 artwork URL.

### Deliberate display/playback separation

The production display endpoint **does not perform a live HEOS validation browse on every request**. An earlier migration draft did so, but full diff review caught that it would make every Tracks screen open perform the complete 635-row HEOS browse and would undermine the purpose of the fast official-TIDAL display path. That draft was discarded before commit/restart.

The accepted architecture is:

```text
official TIDAL canonical cache
        ↓
/api/tidal/favourite-tracks
        ↓
fast rich 594-track display

separate reusable official ↔ HEOS bridge
        ↓
read-only diagnostic validation / playback-boundary safety
        ↓
HEOS My Music-Tracks playback
```

This is an intentional refinement of the earlier wording that fresh display state itself should fail closed on live HEOS validation. **Official TIDAL is display authority; deterministic HEOS validation belongs at the playback boundary.** A slow or temporarily unavailable HEOS full-library browse must not prevent a valid cached TIDAL collection from being displayed.

The reusable `getFavouriteTracksLibraryBridge()` remains in `server.js`. The existing read-only HEOS-validation probe now reuses it rather than carrying duplicate validation code. The bridge still reports `ok` only when the official and deduplicated HEOS ID sets match exactly **and** their order matches exactly.

No queue, playback, AVR or TIDAL-favourite mutation was introduced in this display/prewarm stage.

A separate startup log immediately after the successful prewarm showed `TIDAL TRUSTED CONTEXT INDEX REFRESH FAILED` for a HEOS playlist browse timeout. That belongs to the existing trusted-context/My-Mix machinery and is not evidence of Favourite Tracks prewarm failure; investigate separately if it becomes operationally significant.

## Playback implications

The existing HEOS `My Music-Tracks` playback machinery currently operates on the raw 635-row HEOS collection. Migration must change the logical collection supplied to PLAY ALL / SHUFFLE ALL / PLAY FROM HERE so the new UI does not silently reintroduce HEOS's repeated blocks.

For the canonical collection:

- PLAY NOW / PLAY NEXT / ADD TO END / PLAY ONLY can use validated official track ID = HEOS MID with known `My Music-Tracks` context;
- PLAY FROM HERE must take the selected index from the canonical live collection and queue its canonical tail;
- PLAY ALL / SHUFFLE ALL must use the canonical live collection, not raw HEOS rows;
- preserve the existing HEOS queue generation/cancellation and per-track failure-isolation machinery rather than replacing it unnecessarily.

Preserve the critical HEOS CID rule: use literal-space `My Music-Tracks`, not `My%20Music-Tracks`, when constructing HEOS browse/add-to-queue commands.

## Current checkpoint / next implementation step

The backend **display-source stage is complete and production-validated**. The current backend branch contains:

- canonical official loader/cache with accepted pacing;
- non-blocking startup prewarm;
- fast read-only `/api/tidal/favourite-tracks` endpoint serving the canonical 594 official tracks;
- reusable read-only official↔HEOS library bridge;
- confirmed 594/594 exact ID-set and order invariant for the captured `My Music-Tracks` library;
- HEOS raw 635-row representation retained only as playback/correlation/diagnostic context, not display authority.

The production source was committed as `6f6ab2f`; the spent migration helper was then removed in cleanup commit `1dba895`.

Next planned implementation stage is the first **playback-mutating** stage:

1. make PLAY FROM HERE use the selected index and tail of the canonical 594-track logical collection rather than the raw 635 HEOS rows;
2. make PLAY ALL and SHUFFLE ALL queue the canonical 594 tracks rather than raw HEOS rows;
3. preserve the existing queue generation/cancellation and per-track failure-isolation machinery;
4. enforce deterministic HEOS identity/context at the playback boundary and fail closed rather than fuzzy-substituting;
5. perform explicit playback-mutating runtime acceptance tests only after syntax/diff/restart checks;
6. after backend playback acceptance, modify the MarantzPi `TRACKS` screen to consume `/api/tidal/favourite-tracks` as a continuous rich list without restoring the old HEOS-driven pager.

Temporary migration/recon helpers are implementation tools, not production architecture, and should be removed after their findings/changes are safely committed and documented.

Do not modify/delete the user's TIDAL favourites as part of this work; the 594-track consumer collection appears correct and the malformed 635-row representation is visible independently in HEOS.

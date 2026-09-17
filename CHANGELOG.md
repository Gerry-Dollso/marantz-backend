# Changelog

<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->
## 2026-09-17 — Rich Artist Page and persistent TIDAL caches accepted

The richer Artist Page phase is complete and live. The governing architecture remains **official TIDAL API for what the user sees; HEOS for what the user hears**. The Artist landing page uses official TIDAL artist metadata/artwork, Top Tracks and Similar Artists, biography enrichment, and HEOS-backed release categories/playback. The Pi landing view is deliberately compact: Top Tracks plus four-item section previews, with dedicated **SEE ALL ›** pages; only the SEE ALL text is clickable, not the whole heading. Preserve the tested HEOS release/playback paths rather than trying to replace playback with direct TIDAL playback.

The HP now has persistent official-TIDAL artwork caching under `/var/lib/marantz-backend/artwork`. Acceptance snapshot: 392 favourite-artist images + 1,482 favourite-album images = 1,874 local files, about 56 MB. `library-state.json` records the authoritative Artist/Album key sets and survives restart. Artwork is served through `/api/tidal/artwork/<kind>/<id>` with immutable browser caching. Reconciliation only runs after complete authoritative Artist and Album sets are known. The known Artist collection state is 393 relationship references resolving to 392 live resources with stale/unresolvable reference ID `32968323`; this stale relationship must not block housekeeping. The final helper/live-logic alignment is commit `d672211`.

The HP also now persists complete Artist Details JSON under `/var/lib/marantz-backend/artist-details/<artistId>.json`. The store uses embedded `createdAt` timestamps, atomic temp-file/rename writes, 24-hour freshness and a 30-day maximum stale window. Fresh disk records are returned immediately after process restart. Stale-but-usable records are returned immediately as `cacheSource: disk-stale` while one background refresh rebuilds the expensive hybrid Artist payload; a successful refresh atomically replaces the stale record. The existing 15-minute memory cache and in-flight de-duplication remain. Persistent Artist Details production commit is `5c9cf1e`.

Runtime acceptance proved the persistence behaviour across complete backend restarts. The original uncached Artist build took about 7 seconds; after persistence, a restart request completed in about 0.03 s and explicitly reported `cached:true, cacheSource:'disk'`. A controlled 48-hour-old embedded `createdAt` test returned stale data in about 0.11 s with `refreshing:true`, then background refresh replaced it with a fresh timestamp. The test artist was Coluche, TIDAL ID `1386`. **Do not call ID 1386 Tricky.** Tricky is a favourite artist and the current favourite-artists response identifies him as `{ id: '27444', name: 'TRICKY' }`.

Important API/diagnostic lesson: production `GET /api/tidal/favourite-artists` exposes its resolved list as top-level `artists`, not `items`. Internally `getFavouriteArtists()` uses `getOfficialLibrary('artists')`, whose internal value uses `items`, but `server.js` maps/decorates those to the public `artists` field. A 17 Sep diagnostic mistakenly inspected `j.items` and therefore falsely reported that Tricky was absent. Never infer collection membership from that failed diagnostic. The verified public endpoint returned `count:392` and `artists.length:392`; filtering that returned array locally found Tricky ID `27444`. This was local filtering of already-returned favourites, **not TIDAL text search**.

Official TIDAL catalogue text search remains unavailable for this developer integration. Do not try to solve name search by guessing TIDAL endpoints or IDs. User-entered/name-based search still uses HEOS; once an exact TIDAL ID is known, official TIDAL metadata can be used. Before any new TIDAL API probe, inspect the current official TIDAL OpenAPI/schema and existing repository implementation first. Do not repeat already-closed HEOS/TIDAL identity reconnaissance without new evidence.

### Current backend checkpoint

Backend repository `Gerry-Dollso/marantz-backend`, live branch `local-ai-development`, runtime `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP port 3100. The production code/cache work was clean and pushed through:

`54e5a99 — Add persistent TIDAL artwork cache and safe housekeeping`
`5c9cf1e — Add persistent TIDAL artist details cache`
`d672211 — Align artwork housekeeping helper with live logic`

Immediately before this documentation update, `git push origin local-ai-development && git status --short` pushed `5c9cf1e..d672211` successfully and status was blank. The Tricky correction required no source-code change.

### Current project position

Completed: Current Queue read-only viewer; Now Playing TIDAL favourite heart; TIDAL landing artwork/categories and canonical Mixes & Radio; richer Artist Page; persistent favourite Artist/Album artwork; persistent Artist Details stale-while-refresh cache. Now Playing Track Radio remains deliberately parked/back-burner. Do not reopen completed work merely to re-prove it.

The Pi Artist UI is implemented and active. The Pi repository remains `Gerry-Dollso/marantzPI`, branch `housekeeping-2026-08-21`, runtime `~/marantz-now-playing`, user service `marantz-display.service`. At the end of this phase the Pi had local Artist-page changes in `public/index.html`, `public/tidal-artist-ui.js` and `server.js`; the final small UI correction made only **SEE ALL ›** clickable. Before any future Pi commit/reset/merge, inspect its actual local Git status/diff first; do not assume it is clean and do not discard those tested local changes.

### Mandatory working method for the next chat

The user works primarily from Android phone/tablet using Termius and is not a software developer. Keep terminal commands **single-line, short, sequential and copy/paste safe**. Clearly label **HP** or **Pi** and read-only vs mutating. Wait for pasted output before the next command. A 👍🏻 means agree/continue and can also represent expected blank output; continue implementation after it rather than repeating the plan. A 👎🏻 means investigate. If pasted output visually ends in `(END)`, assume the user has already exited the pager and is back at the prompt.

Use **GitHub first** for repository inspection and substantial/interconnected edits. Use Termius for runtime evidence, deployment/testing and genuinely small bounded edits where the exact insertion is known. Never ask the user to paste large source files when GitHub can provide them. Never guess paths, API fields, ownership, service names, IDs or response shapes. Inspect first. For touched JavaScript run `node --check`; before restart/commit run `git diff --check` and inspect the exact diff. Restart only the affected service. Finish accepted work committed/pushed with blank `git status --short`.

Avoid multiline/escape-heavy shell editing and huge raw JSON in Termius. Prefer small Node summaries for runtime JSON. Avoid Bash history-expansion traps involving `!` in double-quoted commands. Avoid chained pager-producing Git commands; use `git --no-pager diff` and bounded output instead. Safety first, fastest safe method second.

HP backend service is a **system** service. Pi `marantz-display.service` is a **user** service. Never touch unrelated `marantz-mic-stream.service` during display/backend work. Credentials remain outside Git in `/etc/marantz-backend/tidal.env`; never print, move or commit them. Do not mutate TIDAL favourites/playlists, HEOS queue or AVR state during reconnaissance without explicit agreement.

Persistent runtime data belongs outside the repository. Current cache roots are `/var/lib/marantz-backend/artwork` and `/var/lib/marantz-backend/artist-details`, owned/writable by runtime user `gerry`. The HP OS/NVMe has ample space; the artwork snapshot used only about 56 MB. Do not move these caches to the media drive merely because it exists.


<!-- TASK3_TIDAL_LANDING_MIXES_2026_09_16 -->
## 2026-09-16 — TIDAL landing / Mixes & Radio accepted

Task 3 of the post-catalogue UI/control phase is production-accepted. The Pi TIDAL landing page now has six local line-icon shortcuts: Playlists, Artists, Albums, Tracks, Mixes & Radio and Genres. Genres restores the existing HEOS/TIDAL genre browse surface and live testing returned artwork correctly. Videos were deliberately omitted.

Mixes & Radio is no longer built from the incomplete recommendations endpoints. The backend walks the official TIDAL saved playlist collection, bulk-loads playlist metadata, preserves relationship order and selects resources with `playlistType === "MIX"`. This is the canonical discriminator: do not use names, hard-coded IDs, HEOS subtraction or the old recommendation list. The 2026-09-16 acceptance snapshot was 53 saved playlist references and 19 MIX resources with zero unresolved metadata IDs; counts are snapshots, not constants. The collection naturally included My New Arrivals, Artist Radio, Track Radio, history/listening mixes, My Most Listened and My Mix 1–8.

The backend returns official TIDAL playlist artwork directly and the Pi renders that artwork without the old per-MIX enrichment requests. Existing official playlist-detail and TIDAL-to-HEOS resolver paths remain the playback mechanism. Touchscreen acceptance passed TRICKY Artist Radio browse, Turnip Farm Track Radio browse/playback, My Mix 8 playback and Genres artwork.

Canonical checkpoints: backend production `d075c78`, backend cleanup `5da1641`, backend documentation head before this roll-up `4ad1725`; companion Pi production `e98c1e1`, cleanup `d94b55d`, documentation `2530d9c`. Detailed record: `docs/TIDAL_MIXES_RADIO_2026-09-16.md`.

Current Queue, Now Playing favourite heart and TIDAL landing/Mixes & Radio are complete. **Next active task: richer Artist Page.** Now Playing Track Radio was discussed and deliberately left as a later task.


## 2026-09-15 — Now Playing TIDAL favourite heart

Task 2 of the post-catalogue UI/control phase is production-accepted. The Pi Now Playing screen now shows a TIDAL favourite heart for a safely identified official TIDAL track and can add/remove that exact track through the HP backend and official TIDAL user-collection API. HEOS is not used to reconcile favourite membership or perform favourite writes.

Identity is deliberately split at the playback boundary. The Pi preserves a known official TIDAL track ID as `tidalTrackId` when playback was launched from our official-TIDAL UI and associates it with the resulting HEOS MID. If no preserved official ID exists, a live TIDAL HEOS MID may only be treated as a candidate: the HP validates exact official track metadata before membership/write use and fails closed if validation fails. This preserves the Sugarcubes/Birthday lesson: official personalised ID `34454218` and HEOS replacement MID `341262056` are different identities and must not be conflated.

Backend endpoints are `GET /api/tidal/favourite-track-status?id=...`, `POST /api/tidal/favourite-track?id=...` and `DELETE /api/tidal/favourite-track?id=...`. Mutations use the official `userCollectionTracks` relationship, OAuth `collection.write`, JSON:API payloads and a fresh idempotency key. Successful writes invalidate the canonical Favourite Tracks cache and playback-validation cache. The active rolling Favourite Tracks queue/session is not rewritten by a heart change; future collection use sees the refreshed canonical library.

The original synchronous post-write full Favourite Tracks rebuild made a heart write take about 34–35 seconds. Production commit `124fb49 — Remove favourite heart synchronous collection rebuild` removed that rebuild from the mutation response; controlled Aquarius tests reduced add/remove to roughly 0.28–0.37 seconds. A recent-mutation single-track status overlay then reduced the immediate post-write status check from about 34.7 seconds to about 0.20–0.21 seconds while leaving the full canonical collection path untouched. The overlay is checked only after exact official metadata validation and expires after two minutes so it cannot indefinitely mask a later external TIDAL change.

Controlled Aquarius (Boards of Canada, official ID `16024568`) acceptance passed both directions and restored the original not-favourite state. Add returned HTTP 200 in 0.282 s and immediate status returned favourite=true/recentMutation=true in 0.214 s. Remove returned HTTP 200 in 0.372 s and immediate status returned favourite=false/recentMutation=true in 0.202 s. A temporary TIDAL HTTP 429 during startup/prewarm was allowed to cool down rather than being hammered; subsequent requests recovered normally.

Backend checkpoints:

```text
43a3551 — Add official TIDAL favourite track mutations
124fb49 — Remove favourite heart synchronous collection rebuild
f051e2a — Add fast favourite track status overlay
6c7e2fe — Expire recent favourite status overlay
```

Companion Pi production checkpoint: `4e7743e — Add TIDAL favourite heart to Now Playing`. See `docs/TIDAL_FAVOURITE_HEART_2026-09-15.md` for the detailed handover and acceptance record.

## 2026-09-14 — Official catalogue migration complete; next UI/control phase

- The official-TIDAL catalogue migration is production-accepted for Favourite Tracks, Artists, Albums and ordinary My Music Playlists. Official TIDAL remains display/catalogue authority; HEOS remains playback transport and drill-in where required.
- Ordinary Playlists use the live exact-ID intersection of official userCollectionPlaylists and live HEOS Created by me/Favorited branches. Acceptance snapshot: 53 official references, 34 HEOS ordinary playlists (13 + 21), 19 official-only personalised Mix/Radio entries, zero HEOS-only. Counts are snapshots, not constants.
- Artists: 393 relationship references, 392 live resources; the one missing ID was directly 404-tested. Albums: 1,535 relationship IDs match HEOS; 1,482 rich resources resolve, leaving 53 unresolved metadata resources; only three sampled IDs were individually 404-tested.
- Companion Pi accepted alphabetical My Music Artists ordering and a narrowly gated swipe-back return from TIDAL-triggered Now Playing to the preserved browse screen. Other MarantzPi input screens remain swipe-trapped/no-op.
- Next planned phase: Current Queue view/editing, Now Playing favourite heart, TIDAL landing-card artwork cleanup, and richer artist pages with official metadata where available.

Current cleaned/pushed checkpoints:

```text
Backend: b83b443 — pre-handover clean checkpoint
Pi:      649b272 — Remove handover documentation updater (latest tested production cleanup before docs: 1758311)
```

## 2026-09-13 — Official TIDAL Favourite Tracks display and rolling playback accepted

- Completed the Favourite Tracks hybrid architecture: official TIDAL is catalogue/display authority and HEOS remains playback transport. `GET /api/tidal/favourite-tracks` returns the canonical 594 live tracks with rich official metadata and artwork.
- Reconciliation established that the 594 live official IDs match the de-duplicated HEOS My Music-Tracks IDs and order. The official relationship list contained 635 references with 41 stale relationships; separately, the HEOS browse returned 635 rows with 41 duplicate rows. Omitting the stale official relationships and de-duplicating HEOS by first occurrence produced the same 594 tracks in the same order, allowing the validated official IDs to be used directly as HEOS MIDs for this collection.
- Accepted rolling PLAY ALL / SHUFFLE ALL / PLAY FROM HERE instead of building all 594 HEOS queue rows at once: initial 10, low-water fewer than 5 ahead, replenish 5, persistent HEOS events, debounced qid/count reconciliation, bounded tail verification, fail-closed divergence and generation supersession.
- Fixed ordinary Favourite Tracks actions by preserving HEOS's required literal-space `My Music-Tracks` CID rather than passing `My%20Music-Tracks`. Before the fix HEOS returned `eid=14&text=cannot play`; after it, PLAY ONLY, ADD END, PLAY NEXT and PLAY NOW all passed live acceptance.
- End-to-end Pi acceptance also passed PLAY FROM HERE, PLAY ALL and SHUFFLE ALL, giving all seven Favourite Tracks actions a live tested checkpoint.
- Companion Pi migration replaced the old Tracks pager with one continuous 594-track official-TIDAL list showing artwork, title, artist and album while retaining the existing action menu and playback routes.
- Temporary migration/action/documentation helpers were removed after verification.

Backend production/checkpoint sequence:

```text
4d6da8c — Use rolling Favourite Tracks queue
abdf6ba — Remove Favourite Tracks rolling migration helpers
08a86ce — Fix Favourite Tracks ordinary actions
9ba3b6f — Remove Favourite Tracks action fix helper
```

Companion Pi production/documentation checkpoints:

```text
27be5d1 — Use official TIDAL Favourite Tracks UI
be2d52f — Remove Favourite Tracks documentation helpers
```

Next migration target is My Music Artists, Albums and Playlists: prefer official TIDAL for fast/rich catalogue display while retaining deterministic HEOS playback where required.

## 2026-09-04 — AVR TCP/23 recurrence isolated to AVR recovery

- A second spontaneous `UNKNOWN` source/status failure occurred during ordinary PHONO/vinyl listening, without voice/ReSpeaker activity.
- Both Pi and HP could establish TCP/23 connections to the SR8015 but received zero bytes for `SI?`; HEOS port 1255 remained healthy. Pi `/api/status` showed `power:unknown`, `input:UNKNOWN`, `inputCode:UNKNOWN` and `volume:null`.
- Pi TCP/23 sockets were transient/cycling rather than permanently stuck. Stopping `marantz-display.service` removed all Pi TCP/23 activity, but independent HP queries remained silent after more than a minute, showing Pi polling was not required to maintain the fault.
- With Pi polling still stopped, only the SR8015 was put into normal standby for about 10 seconds and powered back on. No HP, Pi or network-switch reboot/reset was performed.
- AVR-only standby/on restored TCP/23 immediately and stably: repeated HP `SI?` probes returned `SI8K`, correctly identifying the configured PHONO/Technics input. MarantzPi was restarted and normal display operation was confirmed.
- This materially weakens the 2 Sep external-switch and voice/ReSpeaker suspicions. Evidence now strongly localises the failure/recovery to the SR8015 or its internal network/control subsystem, but the trigger/root cause remains unproven.
- For the same signature in future, preserve evidence first; AVR-only normal standby/on is now the least-invasive proven recovery before broader resets or cold power cycling.

## 2026-09-02 — Personalised TIDAL PLAY FROM HERE

- Added personalised My Mix PLAY FROM HERE using the existing official-TIDAL-to-HEOS queue architecture. The request carries the personalised playlist ID plus the exact official selected track ID; it does not fall back to a generic HEOS container action.
- The backend validates the selected track ID, rejects PLAY FROM HERE combined with shuffle, confirms the track belongs to the freshly fetched personalised playlist and slices the queue from that exact position onward.
- Preserved deterministic playback safety: the selected first track must resolve and queue successfully or the request fails closed. It is never silently replaced by the following track. Later tracks keep the existing safe-skip behaviour used by the background queue builder.
- Preserved fast queue semantics: selected first track uses `aid=4`, the response returns promptly, remaining tracks build sequentially with `aid=3`, and generation checks cancel superseded builds.
- Companion Pi work added the My Mix action routing and fixed the shared action-button lifecycle so disabled/loading state is always cleared in `finally`, making PLAY FROM HERE and other shared actions reusable.
- Live acceptance confirmed the exact selected track starts, repeated PLAY FROM HERE works, selecting the final track produces a one-track tail, and NEXT after that final track does not start an unrelated item.
- A touchscreen Current Queue view is now a follow-up roadmap item: read-only first, showing current/upcoming tracks with available artwork/title/artist/album metadata, with queue editing considered separately later.

Backend implementation/checkpoint sequence includes:

```text
1b9934a — Add personalised TIDAL play from here
ad56d23 — Require selected My Mix track for play from here
9ac4924 — Remove strict play from here helper
```

Companion Pi functional checkpoint:

```text
041b035 — Make TIDAL track actions reusable
```

## 2026-09-02 — AVR/HEOS network-path incident and recovery

- Investigated a live failure where voice-started IDLES playback succeeded but MarantzPi Now Playing displayed `UNKNOWN`. HEOS metadata remained valid while AVR TCP/23 status was unavailable.
- Direct tests from both Pi and HP showed TCP/23 connections could establish but initially returned zero bytes to `SI?`; HEOS 1255 remained responsive.
- Isolated the application stack before blaming code: stopped `marantz-display.service` and `marantz-backend.service`, identified `marantz-ai.service` as the llama.cpp model server, checked both hosts for AVR connections, and rebooted both machines. The direct port-23 failure persisted.
- AVR ordinary reboot/power cycling, Network Control toggling and a dedicated Network Settings reset did not individually restore the port-23 response. A firmware update also occurred during troubleshooting; do not infer that firmware caused the incident.
- The Network Settings reset temporarily left all external HEOS music services `available:false` while local HEOS sources remained available, despite HEOS account sign-in still being shown in both the app and AVR web interface.
- Recovery followed a later cold wall-power cycle that included the AVR, Pi and the physical network switch serving the AVR. TIDAL/Internet Radio returned and literal byte capture proved clean CR-terminated Marantz TCP/23 status messages (`SINET`, `ZMON`, volume/mute/zone responses). Pi `/api/status` and touchscreen operation then returned to normal.
- No production source code was changed. The network switch/path is a serious suspect, but root cause remains unproven because several devices were cold-cycled together. Preserve and capture HEOS 1255, AVR TCP/23 bytes, Pi `/api/status`, Pi/HP socket state and switch state first if this recurs.

Current tested backend source checkpoint remains:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi source checkpoint remains:

```text
300be7a — Fix personalised TIDAL artwork loading
```


## 2026-09-01 — Lightweight personalised TIDAL artwork

- Added an independent 30-minute `personalisedArtworkCache` for landing-card covers.
- Added `getPersonalisedArtwork(playlistId)`, which first reuses the full personalised playlist cache when available; otherwise it fetches only the first official playlist page and stops after collecting up to four distinct cover URLs.
- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. Full personalised playlist pagination remains reserved for actual playlist detail/playback.
- This change addresses the observed TIDAL 429/temporary failure pattern caused by unnecessary full-playlist artwork enrichment under cold-cache activity without weakening resolver or playback safety.
- Verified the endpoint on My Mix 1 with four official artwork URLs and a warm-cache repeat.
- End-to-end Pi testing populated all ten personalised cards from a genuine cold backend cache after restarting `marantz-backend.service`.
- Historical note superseded: personalised PLAY FROM HERE was subsequently implemented and live-tested on 2 Sep 2026; see the later changelog entry above.

Checkpoint:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi checkpoint:

```text
300be7a — Fix personalised TIDAL artwork loading
```

Current tested backend source checkpoint:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

## 2026-08-31 — Fast personalised TIDAL playback and rich UI backend checkpoint

- Replaced whole-playlist pre-resolution with fast first-track playback followed by generation-controlled background queue construction. Live My Mix 1 testing returned in about **2.343 seconds**, began with Smashing Pumpkins, and completed **39/39 queued, 0 skipped** in the background.
- Added the background trusted user-playlist index for deterministic resolution of catalogue substitutions. The expensive Created by me playlist crawl is no longer in the request path; complete snapshots are built off-side and swapped atomically. Ambiguous requests fail promptly while the index warms.
- Closed The Sugarcubes — Birthday identity case without hard-coding the track. Official personalised track `34454218` is deterministically resolved to HEOS/TIDAL playable `341262056` / album `341262049` through trusted user-created playlist context, matching the already-proven TIDAL Share, TIDAL Connect artwork and Early Alternative evidence.
- Birthday no longer breaks real My Mix 1 queue construction; the tested 39-track mix completed with zero skips.
- Exposed official recommendation `description` values from `/api/tidal/personalised` for the Pi landing cards. Live uncached response returned all ten recommendation descriptions.
- Official TIDAL API remains the catalogue/UI metadata source and HEOS remains playback transport. Official search remains access-blocked for this developer app; do not regress frontend catalogue work to HEOS search to compensate.
- Direct TIDAL playback remains parked.

Key backend checkpoints:

```text
0a5238f — Integrate trusted TIDAL HEOS resolution
27440abc6fd244da499529425a16fb11b986657c — Build trusted index in background
614850d — Build personalised TIDAL queues in background
66f6345 — Expose personalised TIDAL descriptions
```

Current tested backend source checkpoint:

```text
66f6345 — Expose personalised TIDAL descriptions
```


## 2026-08-29 — Personalised TIDAL playback and Birthday replacement investigation

- Proved the official personalised My Mix UI and per-track resolved playback path on the Pi; Play Now, Play Next, Add to End and Play Only work. Play From Here remains deliberately unavailable for My Mixes pending a generic queue-tail builder.
- Added the first generic resolved personalised playlist Play All/Shuffle All backend path. Its first live My Mix 1 Play All test failed safely after about **52.3 seconds**, before queue mutation, on The Sugarcubes - Birthday at index 31 because the resolver returned a genuine catalogue ambiguity.
- Identified the performance limitation independently of the identity problem: the prototype pre-resolves every track sequentially and the resolver performs live HEOS album browsing even on its direct path. Full-playlist pre-resolution is therefore too slow for production.
- Established the Birthday identity discrepancy precisely. My Mix 1 exposes official track `34454218` / album `34454215` / ISRC `USEE18800001`, while two HEOS-visible Life's Too Good editions contain Birthday as `341262056` / album `341262049` and `526377765` / album `526377759`.
- Proved both HEOS candidates are genuine official TIDAL objects with STREAM availability and different ISRCs, so ISRC cannot identify the consumer-selected replacement in this case.
- Obtained three converging pieces of evidence for `341262056` / `341262049`: the official Android TIDAL Share action on the exact My Mix item returned track `341262056`; TIDAL Connect to the SR8015 used the exact artwork of album `341262049`; and the user's pre-existing Early Alternative TIDAL playlist appears through HEOS with Birthday MID `341262056`, album_id `341262049`, and the same artwork.
- TIDAL Connect exposed placeholder `mid=1` / `album_id=1` and left the normal stored HEOS queue intact, confirming that the Connect session cannot itself be used as a direct MID lookup.
- Current deterministic investigation: test whether official TIDAL media replacement functionality can expose the mapping from stored personalised object `34454218` to the consumer-playable object. Do not fall back to arbitrary fuzzy/newest/oldest selection without evidence.
- Guarded replacement-probe migration commit `777e2d8` failed safely because its source anchor matched zero times; it made no runtime-file change. Subsequent uncommitted local reconnaissance added `replaceMedia`, provenance and shares probes to `tidal-user-auth-recon.js`; review those edits before committing them.
- Do not repeat established HEOS playlist discovery. Early Alternative is already proven at `LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84` and contains Birthday as MID `341262056` / album `341262049`.

<!-- TIDAL_BIRTHDAY_HANDOVER_2026_08_29 -->
## 2026-08-29 — Personalised queue hard case and TIDAL replacement investigation

- Added production personalised playlist playback at `a30db56`: official playlist tracks are resolved to HEOS context before queue mutation, first successful item uses `aid=4`, later items use `aid=3`, and ambiguity fails closed.
- Live My Mix 1 Play All exposed two distinct issues. Full pre-resolution took about **52.326 seconds**, which is not acceptable for production UX, and the build failed safely at index 31 on The Sugarcubes — **Birthday** without changing playback.
- The developer API My Mix object is track `34454218`, album `34454215`, artist `3519103`, ISRC `USEE18800001`, duration `PT4M`. Direct official probing proved it is a genuine TIDAL resource but the observed response did not advertise STREAM availability.
- HEOS exposes two playable same-title/same-album candidates: `341262056` / album `341262049` and `526377765` / album `526377759`. Both are genuine official resources with STREAM availability but different ISRC/licensing metadata, proving ISRC cannot be used as a universal equivalence key.
- The official Android TIDAL app's Share action on the exact My Mix Birthday item returned track **341262056**. Sending the same item through TIDAL Connect produced album artwork exactly matching official album **341262049**. Connect itself reports placeholder `mid=1` / `album_id=1`, so Share supplies the exact track identity while Connect independently confirms the selected album edition.
- Independently browsed the user's existing **Early Alternative** playlist through HEOS. Birthday is already present there as MID **341262056**, album_id **341262049**, with the same artwork. This closes the question of whether the playlist is HEOS-visible and which edition it contains; do not repeat that reconnaissance.
- TIDAL Connect queue inspection showed the Connect session is transient/station-style and did not replace the existing normal HEOS queue.
- The active investigation is now whether official TIDAL APIs expose a deterministic replacement/media-substitution mapping from personalised object `34454218` to playable object `341262056`. Prefer TIDAL's own replacement semantics if accessible; do not choose among editions by arbitrary fuzzy tie-breakers.
- The first guarded replacement-probe migration failed safely because its exact anchor did not match and wrote nothing. Subsequent 29 Aug commits added read-only replacement/replaceMedia/metadata/provenance/shares reconnaissance helpers. Inspect their live results before creating further probes.
- Queue latency remains a separate problem even if replacement identity is solved: the reusable resolver performs live HEOS browsing on many tracks, so whole-playlist pre-resolution can take tens of seconds. Future generic Play All/Shuffle All/Play From Here machinery should start a safely resolved first item promptly and continue building in the background while retaining cancellation/fail-safe behaviour.
- Added `CURRENT_HANDOVER.md` as the short authoritative continuation document so a new chat does not restart closed investigations.

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-28 — HEOS resolver normalization and second-sample validation

- Diagnosed the remaining 16 Horsepower failure against the real HEOS album container. Official TIDAL track `35888116` / album `35888114` (`Sackcloth 'N' Ashes`) maps to HEOS `LIBALBUM-635299` / MID `635301` (`Sackcloth -N- Ashes`).
- Proved the resolver bug was general album normalization, not missing catalogue content: apostrophes survived the common normalizer, so `'N'` and `-N-` never converged. Added quote-delimited N-separator normalization in `cbcd4ac`; no artist-specific exception was added.
- Re-ran the read-only resolver after the fix against the then-current personalized recommendations. TIDAL had refreshed the mixes, so this was a new 26-track sample rather than the original fixed sample. Result: **26/26 resolved, 0 ambiguous, 0 unresolved, 0 errors**.
- In the fresh sample, 23/26 resolved through `direct-album-id+official-mid`; April Skies, Screen Shot and Black Soul Choir resolved through structured `artist-album-track` traversal.
- Preserve the earlier 23/26, 1 ambiguous, 2 unresolved result as a separate hard edge-case checkpoint. Do not claim that the one-line normalization change alone converted that exact sample to 26/26. Birthday and Rise remain valuable historical edge cases from that original sample.
- Closed the simple HEOS reverse-context experiment. Track search `scid=3` behaves as human-text search, not numeric MID lookup; numeric-ID searches produced no exact MID hits even for known-good controls. Browsing both `SEARCHED_TRACKS-` and `SEARCHED_TRACKS-Rise` returned the normal TIDAL root rather than a search-results container. Do not spend further time inventing synthetic `SEARCHED_TRACKS-*` CIDs.

Current tested resolver checkpoint:

```text
cbcd4ac — Fix HEOS album N-separator normalization
```

Checkpoint additions:

```text
e48613e — Add read-only HEOS reverse context probe
0817a62 — Add guarded HEOS album separator normalization migration
cbcd4ac — Fix HEOS album N-separator normalization
```

## 2026-08-28 — Persistent TIDAL user authorization and deterministic HEOS resolution

- Added persistent TIDAL user OAuth refresh-token authorization for the official user-scoped API. Access tokens remain short-lived in memory; the refresh token is stored outside Git in `/etc/marantz-backend/tidal-refresh-token` with owner `gerry:gerry` and mode `0600`.
- The backend can now restore a user session after restart by exchanging the persisted refresh token, and the `/api/tidal/oauth/status` response reports whether a refresh token is stored without exposing the token itself.
- Added a read-only recommendation-resolution batch probe over 26 tracks drawn from My Mix 1, My Daily Discovery and My New Arrivals.
- Added the read-only `ai/probe-tidal-heos-resolution.js` reconnaissance tool to resolve official recommendation metadata into playable HEOS context.
- The first metadata-only resolver pass achieved 18/26 resolved, 2 ambiguous and 6 unresolved. Follow-up deterministic identity checks improved this to **23/26 resolved, 1 ambiguous, 2 unresolved, 0 errors**.
- The key finding is narrower than universal ID equality: when a valid candidate HEOS context exposes a playable `mid` exactly equal to the official TIDAL track ID, that exact match is a deterministic identity signal. Phantogram remains the counterexample proving that official TIDAL track IDs cannot be blindly treated as HEOS MIDs.
- 22 of the 23 resolved tracks were confirmed as `direct-album-id+official-mid`; Ladytron and the other edge cases established that an exact official MID can disambiguate duplicate title matches inside a HEOS album container.
- `A Daisy Chain 4 Satan (Acid & Flowers Mix)` required only transport-name normalization: HEOS returned `Acid %26 Flowers Mix`, but the official track ID `113779406` matched the playable HEOS MID exactly.
- `Who Are You` on `Black Boy (Alternative)` resolved despite official metadata crediting Vince Staples while the HEOS track list credits Dahi, because the official track ID `536071631` matched the HEOS MID exactly.
- `That's Law` resolved despite the official artist being Frankie Pulitzer and the HEOS track credit being CZARFACE, because the official track ID `536793606` matched the HEOS MID exactly. Frankie Pulitzer is a collaborator on the release, not the HEOS primary artist credit.
- `Destroy Everything You Touch` resolved deterministically by choosing the HEOS candidate whose MID equals official track ID `214191276`.
- `Screen Shot` by Swans resolved through artist -> album -> track traversal where direct constructed album lookup was insufficient.
- Current remaining edge cases are The Sugarcubes `Birthday`, where two distinct HEOS albums both contain a track with the same title, and two unresolved catalogue/context cases from Public Image Ltd. and 16 Horsepower. These remain intentionally unresolved rather than guessed.
- Current architecture rule: official TIDAL metadata supplies canonical discovery identity; HEOS remains the playback transport. Prefer exact numeric identity when a proven HEOS context exposes a MID equal to the official track ID. Do not assume that arbitrary TIDAL artist or album IDs can be constructed into HEOS CIDs.
- Next investigation is reverse lookup from a playable HEOS MID/context toward canonical TIDAL metadata, while preserving read-only reconnaissance and not guessing undocumented cross-service mappings.

Current tested backend checkpoint:

```text
2ce9132 — Use deterministic TIDAL IDs in HEOS resolver probe
```

Checkpoint sequence:

```text
0a7776c — Add persistent TIDAL auth and paced recommendation probe
e2b45dd — Add read-only TIDAL HEOS resolution probe
a616299 — Refine read-only TIDAL HEOS resolution probe
2ce9132 — Use deterministic TIDAL IDs in HEOS resolver probe
```

## 2026-08-28 — Official TIDAL API reconnaissance

- Proved user OAuth Authorization Code + PKCE with read-only recommendation, user, collection and search scopes. The later persistent-auth checkpoint stores only the refresh token outside Git; no token is committed to repository source.
- Proved My Mix 1-8, My Daily Discovery and My New Arrivals resolve through official resources to real playlist contents and numeric track IDs.
- Proved artist radio resolves through the official artist radio relationship to playlist contents.
- Proved complete collection pagination: **393 artists, 1,535 albums, 634 tracks**, with zero 429 retries during the deliberately paced full benchmark.
- Most successful collection page fetches were roughly 120-160 ms excluding deliberate one-second pacing, supporting an API-first browse/cache design.
- Proved rich artist profile art, album cover art/artist relationships and nested track -> artist/album/cover-art metadata.
- Added `search.read` and tested official search root/relationship forms with both Interpol and a documented control query. The current developer app consistently receives `400 Invalid resource ID`; one rapid burst also received a 429. Search is therefore recorded as access-blocked/unavailable for this app rather than treated as a backend implementation success. `search.write` remains disabled because no search mutation is required.
- Current architecture direction is now proven end-to-end: official TIDAL API for browsing/discovery/metadata, HEOS/SR8015 for playback. The bridge requires metadata-based HEOS catalogue resolution rather than direct numeric-ID translation.
- Live Daily Discovery proof used Phantogram - When I'm Small. Official API returned track `111442201`, album `111442199` (Eyelid Movies), artist `3614038`. HEOS independently returned artist `LIBARTIST-3614038`, but its matching Eyelid Movies release was `LIBALBUM-111438012` and the matching track MID was `111438014`.
- Constructing `LIBALBUM-111442199` directly from the API album ID returned an empty HEOS container, so API album/track IDs must not be assumed to equal HEOS IDs without evidence. The later 26-track deterministic probe substantially strengthened the specific track-ID evidence where the HEOS context exposes the same MID.
- Following the real HEOS artist -> Albums hierarchy found the matching release and title. `browse/add_to_queue` with the HEOS-returned CID/MID succeeded with `aid=3`; queue inspection confirmed When I'm Small at qid 51. A subsequent `aid=1` test successfully started the track on the SR8015.
- Production rule: resolve official API metadata into a real HEOS catalogue context, then use HEOS-returned CID + MID for queue/playback. Numeric identity must be proven per identifier class and context rather than assumed globally.

Runtime reconnaissance checkpoints:

```text
050da79 — Add TIDAL search reconnaissance
153bc83 — Add parameterized TIDAL track metadata probe
```

## 2026-08-28 — TIDAL Favourite Tracks lifecycle cancellation

- Fixed a separate lifecycle/concurrency problem discovered after the 15-second queue timeout hardening: a long-running `/api/tidal/tracks/play-all` request could remain alive for minutes and continue issuing `aid=3` additions after the user had moved on to another TIDAL playback action.
- Added generation-controlled cancellation for Favourite Tracks queue builds. A newer Favourite Tracks build or newer TIDAL play/track-action/playlist playback invalidates the previous generation.
- The Favourite Tracks loop checks its generation before each HEOS addition and again after an in-flight addition completes, then exits cleanly when superseded.
- Added in-flight queue-command draining. A newer playback action waits for the single Favourite Tracks HEOS command already in progress to settle before issuing its own queue mutation, preventing the old and new operations from racing on HEOS.
- Cancelled Favourite Tracks builds return a clean cancellation result and do not run the old build's final shuffle-mode command against the newer playback.
- Live regression test used the then-current **634-track** Favourite Tracks collection. Shuffle All was started and allowed to build for roughly 10 seconds, then Albums -> Play Random was issued. The old builder logged `TIDAL FAVOURITE TRACK BUILD CANCELLED` after **10 queued tracks, 0 skips**, and no continuing Favourite Tracks command/error stream appeared afterwards.
- This directly fixes the earlier failure mode where a stale Favourite Tracks builder produced minutes of HEOS `eid=12 / syserrno=-2000` interference with later playback.

Current tested backend checkpoint:

```text
4504a08 — Cancel superseded TIDAL favourite queue builds
```

Migration/checkpoint sequence:

```text
e7d5ca7 — Add Favourite Tracks cancellation migration
4c3ef65 — Add Favourite Tracks cancellation drain migration
ce30dd4 — Fix Favourite Tracks drain migration anchor
4504a08 — Cancel superseded TIDAL favourite queue builds
```

## 2026-08-28 — TIDAL Favourite Tracks queue hardening

- Diagnosed the apparent unavailable-favourite problem as HEOS command latency rather than a catalogue problem. The shared `heosBrowse()` default is 5 seconds, but legitimate `browse/add_to_queue` operations can take longer.
- Kept the global HEOS timeout unchanged and gave only the full Favourite Tracks queue builder a 15-second per-track timeout.
- Added per-track failure isolation: one genuine failure is logged and skipped without aborting the remaining full-library queue build. The first successful track uses `aid=4`; subsequent successful tracks use `aid=3`.
- The earlier 5-second behaviour produced repeated false timeout skips and eventually `eid=12 / syserrno=-2000` errors while HEOS was still processing prior commands.
- Clean live Shuffle All verification after service restart grew the queue from 9 to 34 tracks with zero new skip messages.
- Sequential background queue construction remains intentional; do not replace it with concurrent bursts.

Tested backend checkpoint at this stage:

```text
848558a — Harden TIDAL favourite tracks queueing
```

## 2026-08-27 — Full TIDAL Favourite Tracks playback

- Replaced the practical limitations of the old 50-track/page favourite Tracks workflow with a full-library queue path backed by the new browse cache.
- Live HEOS browse of `My Music-Tracks` reported 576 favourite tracks.
- Added `GET /api/tidal/tracks/play-all?shuffle=0|1`.
- Play All starts the first favourite immediately with `aid=4` and appends the remaining favourites sequentially with `aid=3` in saved order.
- Shuffle All Fisher-Yates shuffles the complete favourite-track list first, starts the first random track, then appends the remainder in that already-randomised order. This is a genuine full-library shuffle rather than HEOS shuffling a partial 50-track queue.
- Playback begins before the full 576-item queue has finished building; queue construction continues quietly in the background. Live testing showed the queue growing past the former 50-track ceiling while playback remained uninterrupted.
- Sequential queue additions are deliberate. Do not replace them with a large burst of concurrent HEOS commands without proving that the AVR/HEOS command channel remains reliable.
- Live Shuffle All test produced an opening order including Joy Division, Blue Oyster Cult and Black Flag, confirming full-list randomisation before queue construction.

### Critical HEOS CID discovery

- `My Music-Tracks` must retain its literal space when sent to HEOS.
- Sending `My%20Music-Tracks` caused HEOS to interpret the container incorrectly and return the higher-level TIDAL root (`What's New`). Because the experimental loader reused the `My Music-Tracks|all` key, this incorrect response also poisoned the in-memory browse cache until the backend was restarted.
- Manual proof with literal spaces:
  - MID `484193` via `cid=My Music-Tracks&aid=4` created exactly one queue item: Morcheeba - Trigger Hippie.
  - MID `49258737` via `cid=My Music-Tracks&aid=3` correctly appended Sonic Youth - Teen Age Riot from beyond the old 50-track boundary.
- Preserve the established HEOS CID construction pattern `encodeURIComponent(cid).replace(/%20/g, ' ')` for these `My Music-*` commands.
- A guarded CID correction briefly introduced a syntactically valid self-reference (`const heosCid = heosCid...`); the diff review caught it before service restart and a narrow follow-up migration repaired it. This is a reminder that `node --check` cannot detect temporal-dead-zone/runtime reference errors.

Checkpoint sequence:

```text
0a966c2 — Add guarded favourite tracks play-all migration
b6e0230 — Fix favourite Tracks HEOS CID handling
2cec949 — Fix Favourite Tracks HEOS CID self reference
51c3135 — Add full TIDAL favourite tracks playback
```

Tested backend checkpoint at this stage:

```text
51c3135 — Add full TIDAL favourite tracks playback
```

## 2026-08-27 — Bounded TIDAL browse memory cache

- Added `tidal-browse-cache.js`, a memory-only bounded LRU cache around the read-only `/api/tidal/browse` route.
- Added stale-while-revalidate behaviour: cached browse data is returned immediately while an eligible HEOS refresh runs in the background.
- Hard-capped the cache at 64 entries with least-recently-used eviction. Nothing is persisted to disk, so this feature cannot accumulate cache files or gradually fill backend storage.
- Deduplicated refreshes so repeated requests for the same cache key cannot launch multiple simultaneous HEOS scans.
- Added stale fallback: if a forced refresh fails and a usable previous entry exists, the backend can continue returning the last known result within its configured maximum-stale window.
- Corrected the high-value library policy after live inspection established the actual HEOS CIDs as `My Music`, `My Music-Artists`, `My Music-Albums`, `My Music-Tracks` and `My Music-Playlists`.
- High-value library containers become eligible for background refresh after 15 seconds and may retain a stale fallback for up to 12 hours. Other recently browsed containers use a two-minute refresh threshold and two-hour maximum-stale window.
- Added diagnostic browse fields `cached`, `cacheAgeMs` and `refreshing`; the Pi does not need to depend on them.
- Live HP benchmark of `My Music-Artists` returned 392 artists: cold HEOS pagination took approximately 8.934 seconds; the immediate memory-cache hit took approximately 0.009 seconds.
- Verified stale-while-revalidate on the real MarantzPi touchscreen after the 15-second threshold.

Checkpoint sequence:

```text
f6b6f23 — Add guarded TIDAL browse cache migration
bada46d — Fix TIDAL browse cache library CIDs
60eefcc — Cache TIDAL browse containers in memory
```

## 2026-08-27 — TIDAL canonical metadata service for Pi navigation

- Added protected TIDAL developer credentials through `/etc/marantz-backend/tidal.env`, loaded by the systemd service and never stored in Git.
- Added isolated `tidal-metadata-client.js` with in-memory OAuth token caching/refresh and one retry after a 401.
- Added `GET /api/tidal/metadata/track-artists?mid=<TIDAL track id>`.
- Live Magazine test proved MID `1349014` resolves canonically to `LIBARTIST-64520` / Magazine, avoiding ambiguous name-only matching.

Checkpoint sequence:

```text
b8b703d — cached TIDAL metadata client
11d616f — guarded TIDAL metadata endpoint migration
ebb4b65 — Add TIDAL track artist metadata endpoint
```

## 2026-08-27 — TIDAL backend artist capability and queue actions

- Confirmed the native artist root exposes Tracks, Albums, EP n Singles, Other Albums and Similar.
- Confirmed Similar returns real `LIBARTIST-*` containers with artwork and Artist -> Tracks exposes playable MIDs.
- Verified direct TIDAL OpenAPI canonical artist/track metadata access. Biography text remains unavailable with current access and must not be guessed via undocumented endpoints.
- Added and live-tested the generic track queue endpoint supporting Play Now, Play Next, Add to End, Play Only and Play From Here.
- Play From Here paginates the full source container and reconstructs queue order from the selected MID onward.

Queue-action checkpoint:

```text
06edb34 — Add TIDAL track queue actions
```

## 2026-08-27 — TIDAL semantic contract, canonical ASR learning and voice pause

- Hardened learned artist handling so exact aliases still work while partial collisions do not rewrite genuine artist names.
- Preferred direction is trusted canonical Whisper vocabulary rather than accumulating one-off transcription hacks.
- Preserved the touchscreen confirmation path for uncertain new names.
- Established semantic separation between play artist/album/track and show/browse artist/albums/tracks/similar/info. Show/browse actions never start playback.
- Voice microphone/ASR tuning remains paused pending the Seeed Studio ReSpeaker USB Mic Array v2.0.

## 2026-08-26 — Guarded local AI integrated live

- Moved active development to `local-ai-development`.
- Built and validated the hybrid deterministic-safety + local-Qwen intent architecture.
- Preserved deterministic `/api/command` and TIDAL routing ahead of AI fallback.
- Added `MARANTZ_AI_FALLBACK=1` deployment gating.
- Production benchmark remained fail-closed with zero unsafe false positives across the principal validation sets.

Known checkpoint at the end of that stage: `c6505b0 — Allow full backend status time during source verification`.

## 2026-08-26 — Pre-local-AI documentation baseline

- Active branch before local-AI work was `tidal-voice-development`.
- Recorded `1477413 — Complete persistent TIDAL voice learning` as the known-good pre-AI functional checkpoint.
- Established the AI boundary: language interpretation may produce validated semantic intents; deterministic backend code remains responsible for execution.

## 2026-08-24 — Completed persistent TIDAL voice learning

- Preserved TIDAL title fallback context.
- Added persistent title and artist voice aliases.
- Required confirmation for uncertain new voice artists.
- Added persistent title/track learning endpoint support.
- Verified learned corrections survive service restarts.

Known-good functional checkpoint: `1477413 — Complete persistent TIDAL voice learning`.

## Voice-learning safety rule

Uncertain speech recognition must fail safely into search/confirmation rather than silently binding or playing a weak match. Future AI/ASR work must preserve this behaviour.

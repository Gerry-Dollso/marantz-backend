# Changelog

## 2026-09-01 — Lightweight personalised TIDAL artwork

- Added an independent 30-minute `personalisedArtworkCache` for landing-card covers.
- Added `getPersonalisedArtwork(playlistId)`, which first reuses the full personalised playlist cache when available; otherwise it fetches only the first official playlist page and stops after collecting up to four distinct cover URLs.
- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. Full personalised playlist pagination remains reserved for actual playlist detail/playback.
- This change addresses the observed TIDAL 429/temporary failure pattern caused by unnecessary full-playlist artwork enrichment under cold-cache activity without weakening resolver or playback safety.
- Verified the endpoint on My Mix 1 with four official artwork URLs and a warm-cache repeat.
- End-to-end Pi testing populated all ten personalised cards from a genuine cold backend cache after restarting `marantz-backend.service`.
- PLAY FROM HERE remains deliberately pending and is the next planned personalised queue-tail feature.

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

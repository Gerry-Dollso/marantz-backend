# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-28 — Persistent TIDAL user authorization and deterministic HEOS resolution

- Added persistent TIDAL user OAuth refresh-token authorization for the official user-scoped API. Access tokens remain short-lived in memory; the refresh token is stored outside Git in `/etc/marantz-backend/tidal-refresh-token` with owner `gerry:gerry` and mode `0600`.
- The backend can now restore a user session after restart by exchanging the persisted refresh token, and the `/api/tidal/oauth/status` response reports whether a refresh token is stored without exposing the token itself.
- Added a read-only recommendation-resolution batch probe over 26 tracks drawn from My Mix 1, My Daily Discovery and My New Arrivals.
- Added the read-only `ai/probe-tidal-heos-resolution.js` reconnaissance tool to resolve official recommendation metadata into playable HEOS context.
- The first metadata-only resolver pass achieved 18/26 resolved, 2 ambiguous and 6 unresolved. Follow-up deterministic identity checks improved this to **23/26 resolved, 1 ambiguous, 2 unresolved, 0 errors**.
- The key finding is stronger than the earlier Phantogram example: for the tested catalogue entries, the official TIDAL track ID itself is directly usable as the HEOS track `mid`, while album and artist context can still differ between the two catalogue views.
- 21 of the 23 resolved tracks were confirmed as `direct-album-id+official-mid`; Ladytron and the other edge cases established that an exact official MID can disambiguate duplicate title matches inside a HEOS album container.
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

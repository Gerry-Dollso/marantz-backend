# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

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

Current tested backend checkpoint:

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

# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-27 — Bounded TIDAL browse memory cache

- Added `tidal-browse-cache.js`, a memory-only bounded LRU cache around the read-only `/api/tidal/browse` route.
- Added stale-while-revalidate behaviour: cached browse data is returned immediately while an eligible HEOS refresh runs in the background.
- Hard-capped the cache at 64 entries with least-recently-used eviction. Nothing is persisted to disk, so this feature cannot accumulate cache files or gradually fill backend storage.
- Deduplicated refreshes so repeated requests for the same cache key cannot launch multiple simultaneous HEOS scans.
- Added stale fallback: if a forced refresh fails and a usable previous entry exists, the backend can continue returning the last known result within its configured maximum-stale window.
- Corrected the high-value library policy after live inspection established the actual HEOS CIDs as `My Music`, `My Music-Artists`, `My Music-Albums`, `My Music-Tracks` and `My Music-Playlists`.
- High-value library containers become eligible for background refresh after 15 seconds and may retain a stale fallback for up to 12 hours. Other recently browsed containers use a two-minute refresh threshold and two-hour maximum-stale window.
- Added diagnostic browse fields `cached`, `cacheAgeMs` and `refreshing`; the Pi does not need to depend on them.
- Playback/queue mutation operations remain outside the browse-response cache and continue to use authoritative HEOS operations.
- Live HP benchmark of `My Music-Artists` returned 392 artists: cold HEOS pagination took approximately 8.934 seconds; the immediate memory-cache hit took approximately 0.009 seconds.
- Verified the intended stale-while-revalidate behaviour on the real MarantzPi touchscreen after the 15-second threshold: Artists continued to display immediately while the HP refreshed the cached list in the background.

Checkpoint sequence:

```text
f6b6f23 — Add guarded TIDAL browse cache migration
bada46d — Fix TIDAL browse cache library CIDs
60eefcc — Cache TIDAL browse containers in memory
```

Current tested backend checkpoint:

```text
60eefcc — Cache TIDAL browse containers in memory
```

## 2026-08-27 — TIDAL canonical metadata service for Pi navigation

- Added a protected production credential path for the MarantzPi TIDAL developer application. The live systemd service loads `/etc/marantz-backend/tidal.env`; credentials remain outside Git and are exposed to Node only through `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` environment variables.
- Verified client-credentials OAuth from the live HP service environment. Tokens currently expire after 14,400 seconds.
- Added isolated `tidal-metadata-client.js` rather than embedding OAuth/token logic directly in `server.js`.
- The metadata client caches the bearer token in memory, refreshes shortly before expiry, and retries once after a 401 by reacquiring a token.
- Added the read-only endpoint `GET /api/tidal/metadata/track-artists?mid=<TIDAL track id>`.
- The endpoint validates the MID, calls official TIDAL OpenAPI `/v2/tracks/{id}?countryCode=GB&include=artists`, and returns canonical artist IDs/CIDs/names without exposing credentials or tokens.
- Live Magazine test proved track MID `1349014` (`Because You're Frightened`) resolves canonically to artist ID `64520` / `LIBARTIST-64520` / `Magazine`.
- This eliminated the unsafe fallback idea of taking the first exact-name HEOS/TIDAL search result; live search demonstrated that multiple distinct TIDAL artists can share the visible name `Magazine`.
- The Pi now consumes this endpoint for Now Playing artist-name navigation while playback continues untouched.

Checkpoint sequence:

```text
b8b703d — cached TIDAL metadata client
11d616f — guarded TIDAL metadata endpoint migration
ebb4b65 — Add TIDAL track artist metadata endpoint
```

## 2026-08-27 — TIDAL backend artist capability and queue actions

- Applied the guarded TIDAL semantic integration to the live `server.js` and committed the resulting live state as `4f3ac1e — Apply live TIDAL semantic integration`.
- Probed the live HEOS/TIDAL artist structure using IDLES (`LIBARTIST-4653420`) before designing a richer artist UI.
- Confirmed the native artist root exposes `Tracks`, `Albums`, `EP n Singles`, `Other Albums` and `Similar`.
- Confirmed Similar Artists returns real `LIBARTIST-*` containers with artwork and can therefore support recursive artist navigation on the Pi.
- Confirmed Artist -> Tracks returns playable song metadata including MID, artist, album ID and artwork.
- Confirmed EP/single and Other Albums containers expose album containers and artwork.

### Direct TIDAL OpenAPI findings

- Verified server-to-server OAuth client-credentials token acquisition works for the configured TIDAL developer application.
- Verified `/v2/artists/4653420?countryCode=GB&include=biography` returns the canonical artist name, popularity, external links and a biography relationship.
- Biography content is not currently usable with this developer access: `include=biography` returned an empty `included` array and `/v2/artistBiographies/4653420?countryCode=GB` returned `404 Resource not found`.
- Decision: treat biography text as unavailable for now. Do not design the artist UI around it or continue guessing undocumented/internal endpoints.

### Generic TIDAL track queue actions

Added and live-tested `GET /api/tidal/track/action?cid=<container>&mid=<track>&action=<action>` supporting Play Now, Play Next, Add to End, Play Only and Play From Here. `play-from-here` paginates the full HEOS container, slices from the selected MID and reconstructs the queue in order. Live IDLES testing proved correct continuation order. Queue-action checkpoint: `06edb34 — Add TIDAL track queue actions`.

## 2026-08-27 — TIDAL semantic contract, canonical ASR learning and voice pause

- Hardened learned artist handling so exact confirmed aliases still work while partial-name collisions do not rewrite genuine artist names.
- Established the preferred ASR-learning direction: teach Whisper trusted canonical music names rather than continually redefining transcription mistakes.
- Preserved the touchscreen search/confirmation mechanism for genuinely uncertain new artists and titles.
- Established semantic separation between play artist/album/track, legacy automatic title resolution, and show/browse artist/albums/tracks/similar/info. Critical invariant: show/browse actions never start playback.
- Further microphone/ASR tuning is intentionally paused pending arrival of a Seeed Studio ReSpeaker USB Mic Array v2.0 (107990193).
- Rich/Roon-like TIDAL browsing development may proceed independently while voice development is paused.

## 2026-08-26 — Guarded local AI integrated live

- Moved active development to `local-ai-development` for the local-AI/NLU milestone.
- Built and validated the hybrid intent architecture: deterministic safety gate; local Qwen classifier via llama.cpp `/v1/chat/completions`; validated intent router; execution only through existing semantic controls.
- Preserved deterministic `/api/command` and existing TIDAL routing ahead of AI fallback.
- Added `MARANTZ_AI_FALLBACK=1` deployment gating.
- Ported the benchmark classifier from Python to production JavaScript and verified matching blind-set results.
- Confirmed warm local Qwen classification around 0.7–0.8 seconds/request on the HP i7-6700.

Benchmark checkpoint: fresh adversarial blind 116/121 = 95.9% with 0 unsafe false positives; final validation 125/126 = 99.2% with 0 unsafe false positives; adversarial development 80/80; older holdout 48/50. Do not weaken safety merely to force historical benchmark scores to 100%.

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
- Verified learned corrections survive service restarts and provide a fast path on subsequent requests.

Known-good functional checkpoint: `1477413 — Complete persistent TIDAL voice learning`.

## Voice-learning safety rule

Uncertain speech recognition must fail safely into search/confirmation rather than silently binding or playing a weak match. Future AI/ASR work must preserve this behaviour.

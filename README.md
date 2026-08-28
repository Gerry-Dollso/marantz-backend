# marantz-backend

Companion media/orchestration backend for marantzPI. It runs on the HP EliteDesk media server and exposes HEOS/TIDAL library operations plus validated semantic control used by the Raspberry Pi touchscreen and voice listener.

## Current known-good state — 28 Aug 2026

Active deployed/development branch: `local-ai-development`.

Current tested functional checkpoint:

```text
2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe
```

The service is deployed at `/opt/marantz-backend` and runs as system service `marantz-backend.service`, HTTP port 3100. HEOS uses TCP 1255. The persistent local Qwen classifier is provided separately by `marantz-ai.service` on `127.0.0.1:8080`.

AI fallback is enabled on the HP through `MARANTZ_AI_FALLBACK=1`. Without that flag, unknown natural-language commands remain fail-closed and the deterministic command path is retained.

The TIDAL developer application client ID/secret are deployed outside Git in `/etc/marantz-backend/tidal.env`. `marantz-backend.service` loads that file through a systemd drop-in. Never commit these credentials or copy them into repository configuration.

## Architecture and safety boundary

The Raspberry Pi remains the touchscreen/display/controller. The HP backend is the central media/orchestration layer.

The command architecture is deliberately hybrid:

```text
voice/transcription
  -> deterministic command/TIDAL parsing first
  -> deterministic safety gate where AI fallback is needed
  -> local Qwen semantic classifier
  -> validated intent token
  -> deterministic action router
  -> existing semantic backend controls
  -> SR8015 / HEOS
```

AI never receives arbitrary shell, filesystem or AVR command access. Invalid/unknown interpretation fails closed. Safety has priority over command recall.

## Local AI classifier

Current HP model: `ggml-org/Qwen3-4B-GGUF:Q4_K_M`, served persistently by llama.cpp and classified through `/v1/chat/completions`.

Validated receiver intent vocabulary:

```text
power_on power_off
volume_up volume_down
mute unmute
source_phono source_cd source_tidal source_tv source_aux
play pause next previous
unknown
```

Production JS benchmark checkpoint:

```text
Fresh adversarial blind: 116/121 = 95.9%, 0 unsafe false positives
Final validation:       125/126 = 99.2%, 0 unsafe false positives
Adversarial development: 80/80 = 100%, 0 unsafe false positives
Older holdout:           48/50 = 96.0%, 0 unsafe false positives
```

Do not tune merely to make these historical scores 100%.

## AVR semantic controls

User-level control routes include power, source, volume, mute and transport. Source mappings remain backend policy. `phono` selects Smart Select 1 / the receiver's renamed 8K input, not the physical PHONO input.

Measured SR8015 `SI?` responses:

```text
phono -> SI8K
cd    -> SICD
tidal -> SINET
tv    -> SITV
aux   -> SIAUX1
```

## TIDAL browse memory cache

Read-only `/api/tidal/browse` responses are accelerated by `tidal-browse-cache.js`, a bounded in-memory LRU cache using stale-while-revalidate semantics.

The cache is memory-only, capped at 64 entries, and never writes browse data to disk. Least-recently-used entries are evicted when the cap is exceeded; a backend restart simply starts with an empty cache.

High-value HEOS CIDs are:

```text
My Music
My Music-Artists
My Music-Albums
My Music-Tracks
My Music-Playlists
```

These become eligible for background refresh after 15 seconds and may use the last known result for up to 12 hours if HEOS is unavailable. Other recently browsed containers use a two-minute refresh threshold and two-hour maximum stale window. Only one refresh per cache key may run at once.

On a cache hit, the backend returns the known result immediately and refreshes it in the background when due. Live testing of `My Music-Artists` returned 392 artists: cold HEOS pagination took about 8.934 seconds; the immediate cached request took about 0.009 seconds. The stale-while-revalidate path was then verified on the real touchscreen.

Cache diagnostics are included as `cached`, `cacheAgeMs` and `refreshing`; the Pi can ignore them.

Cache checkpoint sequence:

```text
f6b6f23 — Add guarded TIDAL browse cache migration
bada46d — Fix TIDAL browse cache library CIDs
60eefcc — Cache TIDAL browse containers in memory
```

## Full TIDAL Favourite Tracks playback

`My Music-Tracks` is treated as one full saved-track collection rather than a 50-track page for playback purposes. The live collection had grown to **634 favourite tracks** by the 28 Aug cancellation test.

The backend exposes:

```text
GET /api/tidal/tracks/play-all?shuffle=0|1
```

The route uses the full cached `My Music-Tracks|all` list, keeps only playable entries with a MID, and then builds the HEOS queue explicitly:

- `shuffle=0`: first favourite is sent with `aid=4`, then remaining MIDs are appended in saved order with `aid=3`.
- `shuffle=1`: the complete full-library list is Fisher-Yates shuffled first, then the first random track is started with `aid=4` and the remainder are appended in that shuffled order.
- Queue additions are deliberately sequential rather than concurrent because sequential HEOS command handling has proven reliable.
- Each `browse/add_to_queue` operation in this full-library builder has a dedicated 15-second HEOS timeout. The normal 5-second `heosBrowse()` default proved too short for some legitimate queue additions.
- A failed or timed-out favourite is logged and skipped individually; it no longer aborts the entire queue build. The first successful track receives `aid=4`; later successful tracks receive `aid=3`.
- Playback begins from the first selected track before the whole queue is finished; the remainder builds quietly behind playback.
- Long Favourite Tracks builds are generation-controlled. Starting a newer TIDAL play, track action or playlist playback supersedes the old build. The newer action waits for the single Favourite Tracks HEOS queue command already in flight to settle, then the old loop exits before issuing another command. A cancelled build does not run its final shuffle-mode operation against the newer playback.

Live diagnosis on 28 Aug 2026 showed that the earlier 5-second timeout produced false `TIDAL FAVOURITE TRACK SKIP` messages and eventually HEOS `eid=12 / syserrno=-2000` errors as commands accumulated. The 15-second timeout removed those false failures, but a separate lifecycle problem was then found: an abandoned full-library HTTP request could continue adding favourites for minutes and interfere with later playback.

The lifecycle fix was verified against that exact failure mode. A 634-track Shuffle All build was allowed to begin, then a newer Albums -> Play Random action was issued while it was active. The Favourite Tracks builder cancelled cleanly after 10 queued tracks with **0 skips**, logged `TIDAL FAVOURITE TRACK BUILD CANCELLED`, and did not continue issuing Favourite Tracks commands afterwards. The newer playback action took over without the previous minutes-long command stream.

### Critical HEOS CID rule

For this TIDAL container, HEOS requires the literal-space CID:

```text
My Music-Tracks
```

Do **not** send `My%20Music-Tracks` to HEOS for `browse/browse` or `browse/add_to_queue`.

Live testing proved that:

```text
browse/add_to_queue ... cid=My Music-Tracks&mid=484193&aid=4
```

created a one-track queue containing Morcheeba - Trigger Hippie, and appending MID `49258737` with `aid=3` correctly added Sonic Youth - Teen Age Riot from beyond the old 50-track boundary.

An earlier experimental route encoded the CID as `My%20Music-Tracks`. HEOS interpreted that differently and returned the wrong higher-level TIDAL container (`What's New`), which also poisoned the shared `My Music-Tracks|all` cache because the experimental loader reused the same key. A backend restart cleared that bad in-memory entry. Preserve the existing pattern:

```js
encodeURIComponent(cid).replace(/%20/g, ' ')
```

when constructing HEOS commands for these `My Music-*` CIDs.

Checkpoint sequence:

```text
0a966c2 — Add guarded favourite tracks play-all migration
b6e0230 — Fix favourite Tracks HEOS CID handling
2cec949 — Fix Favourite Tracks HEOS CID self reference
51c3135 — Add full TIDAL favourite tracks playback
c7f508a — Add per-track failure isolation migration
96fff02 — Add 15-second queue timeout migration
848558a — Harden TIDAL favourite tracks queueing
e7d5ca7 — Add Favourite Tracks cancellation migration
4c3ef65 — Add Favourite Tracks cancellation drain migration
ce30dd4 — Fix Favourite Tracks drain migration anchor
4504a08 — Cancel superseded TIDAL favourite queue builds
```

## TIDAL semantic contract

TIDAL voice semantics deliberately distinguish playback type and browsing/navigation intent. Do not collapse these paths back into one generic title search.

Examples:

```text
Play songs by IDLES                 -> play artist
Play the album TANGK by IDLES       -> play album only
Play the song Gift Horse by IDLES   -> play track only
Play Gift Horse by IDLES            -> legacy automatic title resolution
Show me IDLES                       -> artist overview
Show me albums by IDLES             -> albums view
Show me songs by IDLES              -> tracks view
Show me artists similar to IDLES    -> similar-artists view
Tell me about IDLES                 -> artist-info view
```

Critical invariant: SHOW/BROWSE actions must never start playback.

## TIDAL metadata client and canonical identity

`tidal-metadata-client.js` is the isolated official TIDAL OpenAPI metadata client. It uses the developer app client credentials from the service environment, caches the client-credentials bearer token in memory, refreshes one minute before expiry, and retries once after a 401 by clearing and reacquiring the token.

Current read-only metadata endpoint:

```text
GET /api/tidal/metadata/track-artists?mid=<TIDAL track id>
```

It resolves the playing TIDAL track to canonical artist IDs/CIDs/names. The Pi uses this for Now Playing artist navigation instead of fuzzy/name-only matching.

Metadata checkpoint sequence:

```text
b8b703d — add cached TIDAL metadata client
11d616f — add guarded metadata endpoint migration
ebb4b65 — Add TIDAL track artist metadata endpoint
```

## TIDAL artist/HEOS capability findings

Confirmed artist root structure:

```text
Artist root
  Tracks
  Albums
  EP n Singles
  Other Albums
  Similar
```

`Similar` returns real `LIBARTIST-*` containers with artwork. Artist Tracks returns playable songs with MID, artist, album ID and artwork.

Direct TIDAL OpenAPI access is proven for canonical artist and track metadata. Biography text is not currently usable with this developer access; do not design the artist UI around guessed or undocumented biography endpoints.

## TIDAL queue actions

Generic per-track queue endpoint:

```text
GET /api/tidal/track/action?cid=<container>&mid=<track>&action=<action>
```

Supported behaviour:

```text
play-now       -> aid=1
play-next      -> aid=2
add-end        -> aid=3
play-only      -> aid=4
play-from-here -> rebuild queue from selected track onward
```

Playlist and Artist -> Tracks behaviour has been live-tested. `play-from-here` paginates the source container and reconstructs the queue from the selected MID onward.

## Voice learning and ASR boundary

Runtime voice learning lives in `~/.local/state/marantz-backend/voice-aliases.json`; it is state, not repository source. Exact learned aliases still work, but canonical-name resolution must not allow partial collisions to rewrite genuine artist names.

Prefer teaching Whisper trusted canonical music vocabulary rather than accumulating one-off transcription substitutions. Keep the touchscreen search/confirmation path for uncertain names.

## Voice development status — PAUSED

Further ASR/microphone tuning is intentionally paused pending arrival of a Seeed Studio ReSpeaker USB Mic Array v2.0. Resume voice tuning on representative hardware rather than the temporary miniDSP UMIK-1.

## Official TIDAL API reconnaissance — 28 Aug 2026

User OAuth Authorization Code + PKCE is proven live with read-only scopes `recommendations.read`, `user.read`, `collection.read` and `search.read`. Access tokens remain memory-only. The refresh token is persisted securely outside Git at `/etc/marantz-backend/tidal-refresh-token` with mode `0600`, allowing the backend to restore TIDAL authorization automatically after restart without browser re-authorization.

Live official-API results support a hybrid architecture in which TIDAL OpenAPI supplies fast browsing/discovery/metadata while HEOS/SR8015 remains the playback engine:

- Personal recommendations are proven: My Mix 1-8, My Daily Discovery and My New Arrivals resolve to real playlist resources and numeric TIDAL track IDs.
- Artist radio is proven from artist relationship to playlist contents.
- Full user collections are proven through relationship pagination: 393 saved artists, 1,535 saved albums and 634 saved tracks at the test checkpoint. The 634 saved-track count independently matches the HEOS Favourite Tracks collection.
- Collection page fetches were generally about 120-160 ms before deliberate rate-limit pacing; official API browsing is therefore suitable for first-page render plus background collection fill/cache rather than waiting on multi-second HEOS cold browse.
- Rich metadata is proven: artist profile artwork, album artwork/artist metadata, and track -> artist + album -> cover art can be resolved through official relationships.
- Search reconnaissance is implemented and correctly requests `search.read`, but this developer app currently receives `400 Invalid resource ID` for both normal and documented-control queries on root and relationship search forms. One burst also produced a 429. Treat official search as unavailable/access-blocked for this app unless TIDAL enables catalogue-search access; do not enable `search.write` merely to work around it.

Search checkpoint:

```text
050da79 — Add TIDAL search reconnaissance
```

### Official API -> HEOS playback bridge — deterministic resolution proven

The end-to-end bridge from official personalized recommendations to HEOS is proven, but identifiers must be used with context rather than constructed blindly. The original Phantogram proof remains an important counterexample: official track ID `111442201` / album ID `111442199` resolved in HEOS as track MID `111438014` inside `LIBALBUM-111438012`. Therefore official API album/track IDs are **not universally interchangeable** with HEOS IDs.

A later read-only resolver probe tested 26 representative recommendation tracks across My Mix 1, My Daily Discovery and My New Arrivals without issuing any player, queue, source or volume commands. The final result was:

```text
23 resolved
1 ambiguous
2 unresolved
0 errors
```

Of the 23 resolved tracks, **22 resolved through `direct-album-id+official-mid`**. Swans - `Screen Shot` resolved through the artist -> album -> track fallback. The important deterministic rule is narrower than universal ID equality: **when a real candidate HEOS context exposes a playable MID exactly equal to the official TIDAL track ID, treat that as deterministic track identity.**

This rule remains valid even when HEOS and official TIDAL metadata display different primary artist credits. Vince Staples - `Who Are You` exposed official track ID / HEOS MID `536071631` while HEOS displayed Dahi. `That's Law` exposed official track ID / HEOS MID `536793606` while HEOS displayed CZARFACE rather than Frankie Pulitzer. Those metadata differences do not override an exact numeric track-identity match inside the expected catalogue context.

Other useful findings:

- My Life With The Thrill Kill Kult - `A Daisy Chain 4 Satan (Acid & Flowers Mix)` resolved once HEOS `%26` title encoding was normalized; official track ID and HEOS MID are both `113779406`.
- Ladytron - `Destroy Everything You Touch` became deterministic through the exact official-MID tie-break among otherwise matching candidates.
- The Sugarcubes - `Birthday` remains deliberately ambiguous because two HEOS album/track candidates satisfy the current metadata evidence and neither MID equals official track ID `34454218`.
- Public Image Ltd. - `Rise` remains unresolved because the current artist traversal exposes no matching HEOS album-title candidate.
- 16 Horsepower - `Black Soul Choir` remains unresolved; HEOS exposes album title `Sackcloth -N- Ashes` rather than official `Sackcloth 'N' Ashes`, and the current resolver has not yet established a unique playable track context.

Production bridge rule: use official TIDAL metadata as the discovery identity, resolve a real HEOS catalogue context, prefer an exact official-track-ID == HEOS-MID match when that context exposes one, and otherwise use validated metadata traversal. Ambiguous results must fail closed rather than selecting a plausible candidate.

Read-only resolver checkpoint sequence:

```text
e2b45dd — Add read-only TIDAL HEOS resolution probe
a616299 — Refine read-only TIDAL HEOS resolution probe
2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe
```

The next investigation is read-only reverse lookup: start from known TIDAL track IDs / HEOS MIDs, including the unresolved and ambiguous controls, and determine whether HEOS exposes a deterministic way to recover the required playable container/CID. Do not add playback commands until that identifier relationship is understood.

## Rich TIDAL browsing direction

Rich/Roon-like TIDAL UI/backend work can continue while voice development is paused. The Pi now has My Music root navigation, artist sections, playlist/artist queue controls, Now Playing artist/album navigation, full Favourite Tracks browsing, and full-library Play All/Shuffle All backed by the HP cache.

Prefer canonical TIDAL identifiers and proven HEOS containers. Do not design around guessed API availability.

## Development rules

- Before editing, confirm branch, working tree, paths, ownership and service state. Never guess them.
- The normal SSH client is Termius on Android; large multiline pastes are error-prone. Prefer safe GitHub-side edits, guarded migration helpers, and small sequential terminal commands.
- After JavaScript changes run relevant `node --check`, regression tests and `git diff --check` where applicable before restarting the service.
- State in advance when a test will physically change AVR power/source/volume/mute/playback. Prefer read-only tests when possible.
- Do not patch individual benchmark sentences. Fix reusable language/behaviour classes.
- Do not commit credentials, `.env`, logs, runtime alias state, private configuration or machine-specific secrets.
- Preserve known-good behaviour and fail closed when uncertain.

## Project scope

This repository is only for the marantzPI / HP backend system. Unrelated computers, repairs and emulation/Batocera projects are outside this architecture.

## Housekeeping

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, logs and environment files are ignored. One-off hard-coded diagnostic scripts should not be retained when equivalent tests can be run directly during troubleshooting.

# marantz-backend


## Architecture principles and future opportunities

The HP backend is intended to be an extensible local media/orchestration brain, not only a TIDAL/HEOS bridge. The persistent local AI service (`marantz-ai.service`, llama.cpp/Qwen) and additional local services may be reused wherever they provide a concrete benefit to MarantzPi/backend functionality.

Future development should be proactive: when a useful architectural improvement, backend package/service, diagnostic facility, cache, database, automation or AI capability would materially improve reliability or usability, propose it rather than waiting for the user to invent it. Explain the benefit and trade-offs first and obtain user approval before installing software or implementing the proposal.

Preserve the deterministic safety boundary. AI is appropriate for natural-language interpretation, conversational context, discovery, classification and diagnosis, but it must not invent TIDAL/HEOS identity or bypass deterministic validation. Playback identity, AVR commands, source changes, volume/mute operations and queue mutation must continue through validated deterministic/fail-closed paths.

Current future-opportunity backlog:

- Add a lightweight local event/history store, preferably SQLite initially, for playback history, source changes, validated command intents, resolver outcomes, failures and recovery events. This should support diagnostics and features such as recalling earlier playback without requiring journal-log reconstruction.
- Add a unified read-only health/diagnostic snapshot exposing AVR TCP/23 state, HEOS availability, TIDAL auth/cache state, queue/build state, Pi/backend connectivity, local AI service health and recent relevant errors. Keep diagnostic observation separate from mutating recovery actions.
- Expand local-AI command interpretation and conversational context so safe follow-ups such as "a bit more", "skip that one", "play the album instead" or "add the next three" can resolve against explicit recent context before deterministic execution.
- Use the local model for AI-assisted diagnostics over structured status/events/log summaries. The model may explain evidence and suggest checks; deterministic probes remain the source of truth.
- Explore music discovery over official TIDAL metadata, the user's Discogs-derived collection data and playback history, while preserving each source's ownership/identity rules.
- Consider lightweight local embeddings/semantic search only when a concrete retrieval use case justifies it. Prefer a small SQLite-integrated design before introducing a separate vector database.
- A future Pi/tablet assistant surface may expose text/voice requests that do not fit fixed controls, backed by the same validated backend intent/action boundary.

These are approved directions/opportunities, not permission to install or implement them automatically. Run each material change by the user first.

## 2026-09-01 — Lightweight personalised TIDAL artwork checkpoint

- Added a dedicated lightweight personalised artwork path so the touchscreen no longer loads complete My Mix playlists merely to construct landing-card collages.
- `getPersonalisedArtwork(playlistId)` returns up to four distinct official TIDAL cover URLs from the first playlist page only. It does not paginate for artwork.
- Artwork has its own 30-minute bounded in-memory cache. If the full personalised-playlist cache is already warm, artwork is derived from that cached track list with zero additional TIDAL API calls.
- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. The existing full `/api/tidal/personalised/playlist` path remains unchanged for opening and playing a Mix.
- The Pi now loads landing artwork sequentially and retries only a failed card once after two seconds, reducing cold-load request pressure instead of increasing concurrency.
- Runtime proof: all ten My Mix/My Daily Discovery/My New Arrivals cards populated with warm caches, then the backend service was restarted to clear in-memory caches and all ten populated again from a genuine cold backend cache.
- Temporary artwork migration helpers were removed after verification.

Current tested backend source checkpoint:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi checkpoint:

```text
300be7a — Fix personalised TIDAL artwork loading
```

Next planned personalised-playlist work is PLAY FROM HERE: replace the queue with the selected track followed by all subsequent tracks from the same Mix in original order. It is not implemented yet.

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
2c8ac84 — Add lightweight personalised TIDAL artwork
```

<!-- TIDAL_BIRTHDAY_HANDOVER_2026_08_29 -->
## Active handover — 29 Aug 2026

Before further TIDAL/HEOS reconnaissance, read [CURRENT_HANDOVER.md](CURRENT_HANDOVER.md). It records the active personalised-playlist Play All investigation, the proven Sugarcubes **Birthday** catalogue-replacement evidence, tests that must not be repeated, and the separate 52-second queue-resolution performance problem.

Critical current rule: the active hard case is **The Sugarcubes — Birthday**, official personalised track `34454218`, with strong consumer/HEOS evidence selecting playable track `341262056` / album `341262049`. The user's **Early Alternative** playlist has already been browsed through HEOS and already proves that exact MID/album/artwork combination. Do not re-test whether that playlist exists or is HEOS-visible. Interpol was a previous search/control artist and is not the active replacement case.

Current architecture remains: **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not regress new frontend/catalogue work back to HEOS browsing.

Companion media/orchestration backend for marantzPI. It runs on the HP EliteDesk media server and exposes HEOS/TIDAL library operations plus validated semantic control used by the Raspberry Pi touchscreen and voice listener.

## Current known-good state — 28 Aug 2026

Active deployed/development branch: `local-ai-development`.

Current tested functional checkpoint:

```text
cbcd4ac — Fix HEOS album N-separator normalization
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
- In the original fixed 26-track sample, The Sugarcubes - `Birthday` remained deliberately ambiguous because two HEOS album/track candidates satisfied the available metadata evidence and neither MID equalled official track ID `34454218`. Public Image Ltd. - `Rise` remained unresolved because that sample's artist traversal exposed no matching HEOS album-title candidate. Preserve these as useful hard edge cases rather than rewriting the historical result.
- 16 Horsepower - `Black Soul Choir` was subsequently diagnosed precisely: official track `35888116` / album `35888114` maps to HEOS `LIBALBUM-635299` / MID `635301`. The failure was a general album-normalization bug: `Sackcloth 'N' Ashes` retained quote characters while HEOS `Sackcloth -N- Ashes` did not. Commit `cbcd4ac` normalizes quote-delimited `'N'` as the same album separator as `-N-`/`N`; it is not a 16 Horsepower special case.
- After that fix, a fresh personalized 26-track sample resolved **26/26, with 0 ambiguous, 0 unresolved and 0 errors**. TIDAL had refreshed the personalized mixes, so this is a second sample rather than evidence that the one-line fix alone transformed the original 23/26 sample into 26/26. In the fresh sample, 23 tracks resolved through `direct-album-id+official-mid`; April Skies, Screen Shot and Black Soul Choir resolved through structured `artist-album-track` traversal.
- Read-only reverse-context reconnaissance also established that HEOS Track search (`scid=3`) is human-text search rather than numeric MID lookup. Browsing both bare `SEARCHED_TRACKS-` and the plausible `SEARCHED_TRACKS-Rise` form returned the normal four-item TIDAL root, not a search-results container. Treat that reverse-CID avenue as closed; do not invent further synthetic CID variants.

Production bridge rule: use official TIDAL metadata as the discovery identity, resolve a real HEOS catalogue context, prefer an exact official-track-ID == HEOS-MID match when that context exposes one, and otherwise use validated metadata traversal. Ambiguous results must fail closed rather than selecting a plausible candidate.

Read-only resolver checkpoint sequence:

```text
e2b45dd — Add read-only TIDAL HEOS resolution probe
a616299 — Refine read-only TIDAL HEOS resolution probe
2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe
e48613e — Add read-only HEOS reverse context probe
0817a62 — Add guarded HEOS album separator normalization migration
cbcd4ac — Fix HEOS album N-separator normalization
```

The simple reverse-context avenue is now closed: HEOS text search does not accept numeric MID as an identifier lookup, and the advertised `SEARCHED_TRACKS-` prefix did not expose a browsable results CID. Continue improving the structured resolver from proven catalogue evidence; keep ambiguity fail-closed and do not invent undocumented CID forms.

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


<!-- TIDAL_PERSONALISED_HANDOVER_2026_08_29 -->
## TIDAL personalised playback — current handover, 29 Aug 2026

This is the active TIDAL investigation. Do not restart earlier HEOS capability tests or substitute unrelated control tracks. The hard case is **The Sugarcubes - Birthday** from **My Mix 1**.

### Production direction

The intended architecture remains:

```text
Official TIDAL API = frontend/catalogue/discovery/metadata
        -> HP resolver/bridge
        -> HEOS = playback transport only
        -> SR8015
```

Shorthand: **TIDAL for what you see; HEOS for what you hear.** HEOS browsing should not become the new frontend/catalogue layer again. The generic official-TIDAL queue machinery should eventually underpin Play All, Shuffle All and Play From Here, and later My Music/playlist/collection migration.

### Personalised browse and track actions already proven

Official personalised endpoints and the Pi My Mixes UI are already working. My Mix 1-8, My Daily Discovery and My New Arrivals are visible from the official API. My Mix track Play Now, Play Next, Add to End and Play Only have been proven through the official-ID -> resolver -> HEOS path. Play From Here is intentionally blocked for My Mixes until the generic playlist-tail queue builder exists.

Do **not** re-test whether ordinary TIDAL user playlists are visible through HEOS: this is already proven. The user playlist **Early Alternative** is visible at HEOS CID `LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84`.

### Resolved personalised Play All / Shuffle All prototype

The backend currently has `GET /api/tidal/personalised/playlist/play?id=<id>&shuffle=0|1`. It pre-resolves every official track before touching the queue, then uses HEOS `aid=4` for the first resolved item and `aid=3` for the remainder, with generation cancellation.

The first live My Mix 1 Play All test **failed safely after about 52.3 seconds without changing playback**. It stopped at index 31 on The Sugarcubes - Birthday because the resolver correctly returned ambiguity. This exposed two separate problems:

1. Catalogue identity/replacement: the personalised API can expose an older/non-streaming catalogue object while TIDAL's consumer playback uses another playable edition.
2. Performance: pre-resolving an entire playlist through sequential live HEOS album browses is too slow. Even after identity is solved, a roughly 52-second pre-resolution delay is unacceptable.

Do not treat the 52-second result as a software regression. It is the current design limitation being investigated.

### Birthday evidence — preserve these exact identifiers

The My Mix 1 official API item is:

```text
The Sugarcubes - Birthday
official track: 34454218
official album: 34454215
artist:         3519103
ISRC:           USEE18800001
duration:       PT4M
availability:   no STREAM field advertised in the probe
```

This is a genuine TIDAL object; the 8-digit ID is not a parsing mistake. Its album is Life's Too Good, barcode `603497981250`.

HEOS exposes at least two same-title playable album editions:

```text
LIBALBUM-341262049 -> Birthday MID 341262056
LIBALBUM-526377759 -> Birthday MID 526377765
```

Official probes show both are genuine TIDAL objects and both advertise `STREAM,DJ` availability, but they have different ISRCs. Therefore ISRC does not solve this case:

```text
341262056 / album 341262049 / ISRC GBBTF9200071 / 3:59 / STREAM,DJ
526377765 / album 526377759 / ISRC ISC108800503 / 3:59 / STREAM,DJ
```

The important evidence selecting **341262056 / 341262049** is independent and repeated:

- Playing the exact Birthday item from My Mix 1 in the official Android TIDAL app and using Share produced TIDAL track ID **341262056**.
- Sending that exact My Mix item to the SR8015 through TIDAL Connect made HEOS Now Playing use artwork path `4fe177f8/64f1/4b2b/8db7/92c43cb3a5fa`, exactly matching official album **341262049**. TIDAL Connect itself exposed placeholder `mid=1` / `album_id=1`, so the artwork proves the album edition; the Share result supplies the exact track ID.
- Browsing the user's existing ordinary TIDAL playlist **Early Alternative** through HEOS returned Birthday with **MID 341262056**, **album_id 341262049**, and the same `4fe177f8...` artwork.

Therefore three independent consumer/playback observations converge on 341262056/341262049. Do not go back to proving that Early Alternative exists or that Birthday is in it; those facts are established.

A separate read-only queue check during TIDAL Connect showed the pre-existing normal HEOS queue unchanged. TIDAL Connect was a transient station-style playback session and did not replace that stored queue.

### Active replacement investigation

The current hypothesis is that the personalised API stores/returns catalogue object `34454218`, while TIDAL consumer playback substitutes a currently streamable equivalent, here `341262056`. This is strongly supported by the observations above but must not be promoted to a general resolver rule until the API mechanism is proven.

The next useful question is specifically whether the official TIDAL API exposes the substitution through its media-replacement facilities (for example a `replacement` relationship or `replaceMedia` behaviour). Do not invent fuzzy tie-breakers such as newest, oldest or arbitrary popularity while this deterministic avenue remains under investigation.

The first guarded migration `ai/add-tidal-replacement-probe.js` was committed as `777e2d8` but its anchor was too brittle and it **failed safely before modifying `tidal-user-auth-recon.js`** with `Expected probeTrackMetadata anchor exactly once; found 0`. At that point `git diff` was clean.

A later chat then made **uncommitted local reconnaissance edits** to `tidal-user-auth-recon.js` adding probes for playlist `replaceMedia`, track provenance/providers/owners, and track shares. These edits must be reviewed before commit; do not assume they are accepted production code. The playlist `replaceMedia` probe is directly relevant to the active replacement question, while provenance/shares are exploratory and should not distract from the Birthday replacement test.

### Queue design after identity investigation

The likely production direction, not yet implemented, is to avoid blocking playback on full-playlist pre-resolution: resolve/start the first safe playable item promptly with `aid=4`, then resolve and append remaining items in the background with `aid=3`, retaining generation cancellation and safely skipping unresolved/ambiguous items rather than guessing. This machinery should be generic enough for Play All, Shuffle All and Play From Here.

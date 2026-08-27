# marantz-backend

Companion media/orchestration backend for marantzPI. It runs on the HP EliteDesk media server and exposes HEOS/TIDAL library operations plus validated semantic control used by the Raspberry Pi touchscreen and voice listener.

## Current known-good state — 27 Aug 2026

Active deployed/development branch: `local-ai-development`.

Current tested functional checkpoint:

```text
ebb4b65 — Add TIDAL track artist metadata endpoint
```

The service is deployed at `/opt/marantz-backend` and runs as system service `marantz-backend.service`, HTTP port 3100. HEOS uses TCP 1255. The persistent local Qwen classifier is provided separately by `marantz-ai.service` on `127.0.0.1:8080`.

AI fallback is enabled on the HP through `MARANTZ_AI_FALLBACK=1`. Without that flag, unknown natural-language commands remain fail-closed and the deterministic command path is retained.

The TIDAL developer application client ID/secret are deployed outside Git in the protected environment file:

```text
/etc/marantz-backend/tidal.env
```

`marantz-backend.service` loads that file through a systemd drop-in. Never commit these credentials or copy them into repository configuration. The backend reads them only through `process.env.TIDAL_CLIENT_ID` and `process.env.TIDAL_CLIENT_SECRET`.

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

AI never receives arbitrary shell, filesystem or AVR command access. Invalid/unknown interpretation fails closed. Safety has priority over command recall: a missed legitimate command is preferable to an unsafe false positive.

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

Do not tune merely to make these historical scores 100%. The 121-case blind set is now a historical stress-test record.

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

AI source actions verify these measured values after execution. AUX retains Speaker Preset 1 behaviour.

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

Current semantic regression suites:

```bash
node ai/test-tidal-semantic-contract.js
node ai/test-tidal-semantic-router.js
node ai/test-tidal-live-adapter.js
node ai/test-tidal-title-type.js
```

These verify that artist/album/track playback remain distinct, explicit album requests resolve only albums, explicit track requests resolve only tracks, legacy auto-title resolution remains available, browse intents fail closed until their Pi UI handlers exist, and unrelated receiver commands are untouched.

The guarded migration `ai/apply-tidal-semantic-integration.js` integrated this layer into live `server.js`. On the HP it created `server.js.before-tidal-semantic-integration` as a local safety backup. The resulting live integration was committed as:

```text
4f3ac1e — Apply live TIDAL semantic integration
```

## TIDAL metadata client and canonical identity

`tidal-metadata-client.js` is the isolated official TIDAL OpenAPI metadata client. It uses the developer app client credentials from the service environment, caches the client-credentials bearer token in memory, refreshes one minute before expiry, and retries once after a 401 by clearing and reacquiring the token.

Current read-only metadata endpoint:

```text
GET /api/tidal/metadata/track-artists?mid=<TIDAL track id>
```

It validates the MID as numeric, requests `/v2/tracks/{id}?countryCode=GB&include=artists`, and returns only canonical track/artist identity information such as:

```json
{
  "ok": true,
  "trackId": "1349014",
  "title": "Because You're Frightened",
  "artists": [
    {
      "id": "64520",
      "cid": "LIBARTIST-64520",
      "name": "Magazine"
    }
  ]
}
```

Live testing proved this resolves the playing track to the correct canonical artist even when TIDAL search returns multiple different artists with the same visible name. The Pi now uses this endpoint for Now Playing artist-name navigation rather than fuzzy/name-only matching.

Metadata checkpoint sequence:

```text
b8b703d — add cached TIDAL metadata client
11d616f — add guarded metadata endpoint migration
ebb4b65 — Add TIDAL track artist metadata endpoint
```

## TIDAL artist/HEOS capability findings

The rich artist work must be built around data proven available in the live system rather than assumed fields.

Confirmed through the existing HEOS/TIDAL browse API for IDLES (`LIBARTIST-4653420`):

```text
Artist root
  Tracks
  Albums
  EP n Singles
  Other Albums
  Similar
```

`Similar` returns real artist containers (`LIBARTIST-*`) with names and artwork. `Tracks` returns playable songs with MID, artist, album ID and artwork. Albums/EPs/Other Albums return album containers and artwork. These are suitable foundations for the richer artist UI.

Direct TIDAL OpenAPI client-credentials access is also proven for artist and track metadata. `/v2/artists/{id}` returns canonical name, popularity and external links. Track `include=artists` returns canonical artist relationships and is now used in production for Pi navigation.

However, biography text is not currently usable by this app: `include=biography` returned an empty `included` array, and a direct request to `/v2/artistBiographies/4653420` returned `404 Resource not found`. Treat biography content as unavailable with the current developer access rather than designing the UI around it or guessing undocumented endpoints.

## TIDAL queue actions

The backend exposes a generic track queue action endpoint:

```text
GET /api/tidal/track/action?cid=<container>&mid=<track>&action=<action>
```

Supported actions map to HEOS queue semantics:

```text
play-now       -> aid=1
play-next      -> aid=2
add-end        -> aid=3
play-only      -> aid=4
play-from-here -> rebuild queue from selected track onward
```

`play-from-here` browses the full source container using HEOS pagination, finds the selected MID, replaces the queue with that track, and appends all following playable tracks. This was live-tested against `LIBARTIST-Tracks-4653420`: selecting Dancer started Dancer and Next advanced to I'm Scum, proving that ordering from the selected point is preserved.

All five actions were live-tested against the actual HEOS player and behaved as intended. The existing `/api/tidal/playlist/play` endpoint was also verified to accept `LIBARTIST-Tracks-*` containers for both Play All and Shuffle All, so no separate artist-play-all backend path is required.

Queue-action checkpoint:

```text
06edb34 — Add TIDAL track queue actions
```

## Voice learning and ASR boundary

Runtime voice learning lives in `~/.local/state/marantz-backend/voice-aliases.json`; it is state, not repository source.

Earlier learning stored misheard aliases such as `chaos -> Kyuss`. Exact learned aliases still work, but canonical-name resolution was hardened so partial collisions do not rewrite genuine names: e.g. `Chaos UK` must not become Kyuss. Ambiguous canonical collisions fail closed.

The important architectural direction is to improve speech recognition with trusted canonical music vocabulary rather than accumulating hard-coded mistake substitutions such as `Kang = TANGK` or `guest horse = Gift Horse`.

The separate `marantz-voice` repository builds a Whisper initial prompt from canonical artist names confirmed in the backend alias state while deliberately excluding the misheard alias strings. This changed a troublesome live IDLES test from repeated variants such as Adolph/Adels/idols to the correct transcription `Play IDLES`, followed by successful artist playback.

Do not undo the touchscreen confirmation/search workflow for genuinely uncertain new artists or titles. Safe matching or user confirmation remains required.

## Voice development status — PAUSED

Further ASR/microphone tuning is deliberately paused as of 27 Aug 2026.

The temporary microphone is a miniDSP UMIK-1 measurement microphone. A Seeed Studio ReSpeaker USB Mic Array v2.0, part 107990193, has been ordered for the final far-field voice front end. Resume voice tuning only after it arrives so the ASR is tuned against representative hardware rather than the temporary UMIK-1.

When voice development resumes, first compare identical phrases on the new microphone, including IDLES, TANGK and Gift Horse. Then investigate extending trusted prompt vocabulary beyond artists to saved TIDAL albums/tracks without creating dangerous alias collisions or excessive prompt size.

The voice listener backend HTTP timeout is 20 seconds because valid TIDAL album operations can exceed the former 10-second client timeout even when playback succeeds.

## Rich TIDAL browsing direction

Rich/Roon-like TIDAL UI/backend work can continue while voice development is paused.

The first functional artist-navigation phase is now proven: the Pi exposes Tracks, Albums, EP n Singles, Other Albums and Similar, Artist -> Tracks has list-style playback/queue controls, and Now Playing can jump directly to the canonical artist or album while playback continues.

Desired richer artist experience still includes:

- artist artwork/header;
- songs/popular tracks;
- albums/EPs/singles;
- similar/related artists;
- available artist metadata such as popularity/external links where useful;
- biography only if a reliable accessible source is established later;
- room for additional metadata later.

Prefer a canonical artist data model keyed by TIDAL artist CID. The new metadata client should be extended for additional official TIDAL relationships when useful rather than reintroducing name-guessing. Do not design around guessed API availability. The existing show/browse semantic contract was intentionally created so future voice navigation can target these views without redesigning playback semantics.

## Development rules

- Before editing, confirm branch, working tree, paths, ownership and service state. Never guess them.
- The normal SSH client is Termius on Android; large multiline pastes are error-prone. Prefer safe GitHub-side edits, guarded migration helpers, and small sequential terminal commands for pull, syntax checks, service operations and hardware tests.
- After JavaScript changes run relevant `node --check`, regression tests and `git diff --check` where applicable before restarting the service.
- State in advance when a test will physically change AVR power/source/volume/mute/playback. Prefer read-only tests when possible.
- Do not patch individual benchmark sentences. Fix reusable language/behaviour classes.
- Do not commit credentials, `.env`, logs, runtime alias state, private configuration or machine-specific secrets. TIDAL client credentials remain in `/etc/marantz-backend/tidal.env` only.
- Preserve known-good behaviour and fail closed when uncertain.

## Project scope

This repository is only for the marantzPI / HP backend system. Unrelated computers, repairs and emulation/Batocera projects are outside this architecture.

## Housekeeping

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, logs and environment files are ignored. One-off hard-coded diagnostic scripts should not be retained when equivalent tests can be run directly during troubleshooting.

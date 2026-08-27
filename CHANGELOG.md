# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-27 — TIDAL semantic contract, canonical ASR learning and voice pause

- Hardened learned artist handling so exact confirmed aliases still work while partial-name collisions do not rewrite genuine artist names. `Chaos UK`, for example, must not be rewritten through the learned `chaos -> Kyuss` alias. Ambiguous canonical collisions fail closed.
- Established the preferred ASR-learning direction: teach Whisper trusted canonical music names rather than continually redefining transcription mistakes.
- The separate `marantz-voice` listener now builds a Whisper initial prompt from canonical artist names in the backend voice-learning state while excluding the incorrect alias strings themselves.
- Live prompting corrected repeated IDLES recognition failures. A live `Play IDLES` test transcribed correctly and successfully started IDLES artist playback.
- Preserved the existing touchscreen search/confirmation mechanism for genuinely uncertain new artists and titles.
- Explicitly rejected future one-off hacks such as `Kang = TANGK` or `guest horse = Gift Horse`; future work should expand trusted vocabulary generically from the user's confirmed/saved TIDAL data.

### TIDAL semantic separation

Added and regression-tested a semantic contract that keeps these requests distinct:

- play artist;
- play album;
- play track;
- legacy automatic title resolution;
- show/browse artist overview;
- show albums;
- show tracks;
- show similar artists;
- show artist information.

Critical invariant: show/browse actions never start playback.

Added/validated regression suites:

```text
ai/test-tidal-semantic-contract.js
ai/test-tidal-semantic-router.js
ai/test-tidal-live-adapter.js
ai/test-tidal-title-type.js
```

The suites confirm explicit album requests only resolve albums, explicit track requests only resolve tracks, legacy auto-title resolution remains available, future browse intents fail closed when no Pi UI handler exists, and unrelated receiver commands remain untouched.

Added the guarded live adapter and migration, culminating in repository checkpoint:

```text
064fd53 — Add guarded TIDAL semantic integration migration
```

Live verification showed:

- `Show me IDLES` -> show/artist/overview -> `not-supported-yet`, with no playback side effect.
- An explicit IDLES TANGK album request successfully started the correct album even when ASR rendered the title as `Tank` in one test.
- An explicit track request stayed on the track path and produced safe `search-required` behaviour when recognition/matching was insufficient rather than falling into an album/random substitution.

### Voice transport timing

- Increased the marantz-voice backend HTTP timeout from 10 seconds to 20 seconds after a correct album command successfully started playback but the listener reported a timeout before the backend response completed.

### Voice development paused

Further microphone/ASR tuning is intentionally paused pending arrival of a **Seeed Studio ReSpeaker USB Mic Array v2.0 (107990193)**. The temporary miniDSP UMIK-1 is a measurement microphone and should not become the acoustic reference around which the final speech pipeline is tuned.

When development resumes, compare the same troublesome phrases on the ReSpeaker first (`IDLES`, `TANGK`, `Gift Horse`) and then investigate trusted artist/album/track vocabulary derived from confirmed/saved TIDAL data.

Rich/Roon-like TIDAL browsing development may proceed independently while voice development is paused. The existing show/browse semantic contract should be preserved for that work.

## 2026-08-26 — Guarded local AI integrated live

- Moved active development to `local-ai-development` for the local-AI/NLU milestone.
- Built and validated the hybrid intent architecture: deterministic safety gate; local Qwen classifier via llama.cpp `/v1/chat/completions`; validated intent router; execution only through existing semantic controls.
- Preserved deterministic `/api/command` and existing TIDAL routing ahead of AI fallback.
- Added `MARANTZ_AI_FALLBACK=1` deployment gating.
- Ported the benchmark classifier from Python to production JavaScript and verified matching blind-set results.
- Confirmed warm local Qwen classification around 0.7–0.8 seconds/request on the HP i7-6700.

### Benchmark checkpoint

```text
Fresh adversarial blind: 116/121 = 95.9%
  unsafe false positives: 0
  missed legitimate commands: 4
  wrong-action substitutions: 1

Final validation: 125/126 = 99.2%
  unsafe false positives: 0
  missed legitimate commands: 1
  wrong-action substitutions: 0

Adversarial development: 80/80 = 100.0%
  unsafe false positives: 0

Older holdout: 48/50 = 96.0%
  unsafe false positives: 0
```

The remaining 125/126 validation miss was conservative `Go over to CD -> unknown`. Do not weaken safety merely to force benchmark scores to 100%. The 121-case blind dataset is now historical and must not be relabelled after seeing model output.

### Live hardware verification

Verified live behaviour included natural volume reduction, safe rejection of deferred/question/reported-speech commands, and successful AI `source_phono` execution with post-action verification.

Measured SR8015 source responses:

```text
PHONO -> SI8K
CD    -> SICD
TIDAL -> SINET
TV    -> SITV
AUX   -> SIAUX1
```

A source-verification attempt initially falsely timed out because full `/api/status` included a slower HEOS request; the source itself changed correctly. Verification timing was extended accordingly.

Known checkpoint at the end of that stage:

```text
c6505b0 — Allow full backend status time during source verification
```

### Workflow rule reinforced

Repository work should normally be performed directly in GitHub. Android Termius large multiline pastes are error-prone. Terminal instructions should stay small and sequential, with the HP primarily used for pull, syntax checks, service operations and real-hardware validation.

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

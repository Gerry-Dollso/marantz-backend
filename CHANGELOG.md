# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-26 — Guarded local AI integrated live

- Moved active development to `local-ai-development` for the local-AI/NLU milestone.
- Built and validated the hybrid intent architecture:
  - deterministic safety gate first;
  - local Qwen semantic classifier through llama.cpp `/v1/chat/completions`;
  - narrow deterministic post-AI correction where justified;
  - validated intent-to-action router;
  - execution only through existing backend semantic controls.
- Preserved the existing deterministic `/api/command` parser as the first path. AI is consulted only when that parser reaches exact `Unknown command`.
- Preserved the existing TIDAL artist/album/title voice-routing and learning behaviour ahead of the AI fallback.
- Added `MARANTZ_AI_FALLBACK=1` deployment gating. Without the flag, the new AI fallback remains inert and the previous deterministic behaviour is retained.
- Ported the proven benchmark classifier from Python into production JavaScript.
- Verified the production JavaScript classifier exactly matched the Python blind-set result before any live integration.
- Added a separately dry-tested intent action router so `unknown` and invalid intents execute nothing.
- Confirmed the local Qwen service is persistent on `127.0.0.1:8080`; warm classification remained roughly 0.7–0.8 seconds/request on the HP i7-6700.

### Benchmark checkpoint

After generalizing the safety gate by language class rather than sentence-specific patches:

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
  missed legitimate commands: 0
  wrong-action substitutions: 0

Older holdout: 48/50 = 96.0%
  unsafe false positives: 0
  missed legitimate commands: 2
  wrong-action substitutions: 0
```

- The remaining 125/126 validation miss is the conservative CD request `Go over to CD` -> `unknown`.
- Deliberately did not weaken safety merely to force benchmark scores to 100%.
- The 121-case blind dataset is now a historical stress-test record and must not be relabelled after seeing model output.

### Safety-gate expansion discovered by blind testing

The fresh 121-case blind run initially exposed 27 unsafe false positives. These clustered into reusable language classes rather than random failures.

The deterministic gate was generalized to cover:

- reported speech;
- hypothetical/conditional statements;
- broader negation/avoidance wording;
- broader future/deferred timing;
- broader state/observation language;
- selected unrelated-device descriptions that superficially resemble audio commands.

After that revision the blind set reached 116/121 with zero unsafe false positives while the older validation/regression sets retained zero unsafe false positives.

### Live hardware verification

Live integration was enabled only after dry-run classifier and action-router tests passed.

Verified live behaviour included:

- `its a bit loud in here` -> AI `volume_down` -> existing semantic volume control reduced the AVR by 0.5 dB.
- `mute this in a while` -> `Unknown command`; AVR mute state remained unchanged.
- `do you think this is too loud` -> `Unknown command`; AVR volume remained unchanged.
- `he just said turn it down` -> `Unknown command`; AVR volume remained unchanged.
- `lets listen to a record` -> AI `source_phono`; source changed successfully and post-action verification passed.

The live SR8015 source responses were measured rather than guessed:

```text
PHONO -> SI8K
CD    -> SICD
TIDAL -> SINET
TV    -> SITV
AUX   -> SIAUX1
```

- Added AI source-action verification against these measured values.
- AUX retains its existing Speaker Preset 1 handling.
- An initial source-verification attempt falsely timed out because it queried the full `/api/status` endpoint with too short a timeout; the source itself had changed correctly. Extended the verification read timeout to accommodate the existing HEOS now-playing request before retrying.
- Current live checkpoint after that fix:

```text
c6505b0 — Allow full backend status time during source verification
```

### Workflow rule reinforced

Repository work should normally be performed directly in GitHub. The HP operator uses Android Termius, where large multiline pastes are error-prone. Terminal instructions should therefore stay small and sequential, with the HP primarily used for `git pull`, syntax checks, service operations and real-hardware validation.

## 2026-08-26 — Pre-local-AI documentation baseline

- Confirmed active branch as `tidal-voice-development` before beginning local-AI development.
- Recorded `1477413` (`Complete persistent TIDAL voice learning`) as the known-good functional checkpoint before local-AI work.
- Documented the HP backend as the intended home for the local-AI/NLU layer.
- Established the AI boundary: language interpretation may produce validated semantic intents, but deterministic backend code remains responsible for execution.
- Explicitly kept unrelated computer repair and Batocera/emulation projects outside the architecture.

## 2026-08-24 — Completed persistent TIDAL voice learning

- Preserved TIDAL title fallback context.
- Added persistent title voice-alias storage and lookup.
- Added persistent artist voice aliases.
- Required confirmation for uncertain new voice artists.
- Added persistent title/track learning endpoint support.
- Completed the backend half of touchscreen-confirmed TIDAL voice learning.
- Verified learned artist and track corrections survive service restarts and provide a fast path on subsequent requests.

Known-good functional checkpoint:

```text
1477413 — Complete persistent TIDAL voice learning
```

## Voice-learning safety rule

Uncertain speech recognition must fail safely into search/confirmation rather than silently binding or playing a weak match. Future local-AI work must preserve this behaviour.

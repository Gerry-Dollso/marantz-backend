# marantz-backend

Companion media/orchestration backend for marantzPI. It runs on the HP EliteDesk media server and exposes HEOS/TIDAL library operations plus validated semantic control used by the Raspberry Pi touchscreen and voice listener.

## Current known-good state

Active deployed/development branch:

```text
local-ai-development
```

Current live local-AI checkpoint:

```text
c6505b0 — Allow full backend status time during source verification
```

The service is deployed at `/opt/marantz-backend` on the media server and runs as the system service:

```text
marantz-backend.service
```

It listens on HTTP port 3100 and communicates with HEOS on TCP port 1255. The persistent local Qwen classifier is provided separately by `marantz-ai.service` on `127.0.0.1:8080`.

On the current HP deployment the AI command fallback is enabled through the systemd drop-in environment variable:

```text
MARANTZ_AI_FALLBACK=1
```

The repository code remains fail-closed: if that variable is absent, the existing deterministic `/api/command` behaviour is used and unknown natural-language commands do not reach AI execution.

## Architecture

The Raspberry Pi remains the touchscreen/display/controller. This HP backend is the central media/orchestration layer for operations that should not live in the touchscreen process.

Current responsibilities include:

- HEOS/TIDAL library search and browse operations proxied from marantzPI.
- Semantic AVR control for power, source, volume, mute and transport.
- TIDAL artist, album and track voice requests.
- Safe voice-search fallback when an artist/title cannot be matched confidently.
- Persistent voice aliases for speech-recognition errors.
- Persistent artist and title/track learning confirmed from the marantzPI touchscreen.
- Guarded local-AI interpretation of natural Marantz/home-audio commands.

The live local-AI command flow is deliberately hybrid:

```text
voice/transcription
  -> existing deterministic command parser first
  -> only on exact Unknown command: deterministic safety gate
  -> local Qwen semantic classifier
  -> validated intent token
  -> narrow deterministic post-AI correction where justified
  -> intent-to-action router
  -> existing semantic backend controls
  -> SR8015 / HEOS
```

The AI does not receive arbitrary shell, filesystem or receiver command access. It may only select from the validated intent vocabulary and those intents map onto existing deterministic control functions.

If AI fails, returns an invalid token, returns `unknown`, or the safety gate rejects the phrase, the command fails closed as `Unknown command` and no AI action is executed.

## Local AI classifier

Current model used on the HP:

```text
ggml-org/Qwen3-4B-GGUF:Q4_K_M
```

It runs persistently through llama.cpp `llama-server`. Classification uses `/v1/chat/completions`; do not regress it to raw `/completion` without evidence, because applying the Qwen chat template was a major accuracy improvement during development.

Current validated intent vocabulary:

```text
power_on
power_off
volume_up
volume_down
mute
unmute
source_phono
source_cd
source_tidal
source_tv
source_aux
play
pause
next
previous
unknown
```

The deterministic safety gate rejects non-immediate/non-command language such as negations, questions, observations, future/deferred statements, hypotheticals, reported speech and recognised unrelated-device descriptions. Safety is intentionally prioritised over forcing every phrase into an action.

## AI benchmark checkpoint

The benchmark/evaluation implementation was ported from Python to production JavaScript and the production JS classifier matched the Python result exactly on the fresh adversarial blind set.

Current regression results after the generalized safety gate:

```text
Fresh adversarial blind set: 116/121 = 95.9%
  unsafe false positives: 0
  missed legitimate commands: 4
  wrong-action substitutions: 1

Final validation set: 125/126 = 99.2%
  unsafe false positives: 0
  missed legitimate commands: 1
  wrong-action substitutions: 0

Adversarial development set: 80/80 = 100.0%
  unsafe false positives: 0
  missed legitimate commands: 0
  wrong-action substitutions: 0

Older holdout: 48/50 = 96.0%
  unsafe false positives: 0
  missed legitimate commands: 2
  wrong-action substitutions: 0
```

Do not tune merely to make these scores read 100%. A conservative missed legitimate command is preferable to an unsafe false positive. The 121-case blind set must remain untouched as a historical stress-test record now that its results have influenced development.

## Live AI verification completed

The production JS classifier was first exercised in dry-run mode with no receiver actions, then the intent action router was separately dry-tested before integration.

Live hardware tests have confirmed both sides of the guarded path:

- Natural immediate request `its a bit loud in here` reached the AI fallback, classified as `volume_down`, and changed receiver volume by the existing 0.5 dB semantic step.
- Deferred `mute this in a while` returned `Unknown command` and left mute state unchanged.
- Opinion/question `do you think this is too loud` returned `Unknown command` and left volume unchanged.
- Reported speech `he just said turn it down` returned `Unknown command` and left volume unchanged.
- Natural source request `lets listen to a record` classified as `source_phono`, changed the source, and passed live source verification before reporting success.

Existing deterministic commands still run before AI. Existing TIDAL artist/album/title handling remains before the fallback and has not been replaced.

## Semantic control API

The backend provides user-level intentions rather than exposing arbitrary receiver commands:

- `POST /api/control/power?state=on|standby`
- `POST /api/control/source?source=phono|cd|heos|tidal|tv|aux`
- `POST /api/control/volume?action=up|down`
- `POST /api/control/volume?action=set&value=<dB>`
- `POST /api/control/mute?state=on|off|toggle`
- `POST /api/control/transport?action=play|pause|next|previous`

Source mappings remain backend policy. `phono` recalls Smart Select 1, which selects the receiver's renamed 8K input rather than the physical PHONO input.

Measured live SR8015 `SI?` responses captured on 26 Aug 2026 are:

```text
phono -> SI8K
cd    -> SICD
tidal -> SINET
tv    -> SITV
aux   -> SIAUX1
```

AI-driven source actions use these measured values for post-action verification. AUX retains the pre-existing Speaker Preset 1 behaviour.

## TIDAL / voice integration

The backend supports the Pi's TIDAL browse/play routes and the voice-search/learning flow. Persistent learned aliases are runtime state and must not be replaced with guessed hard-coded corrections simply to make a test pass.

The voice-learning design deliberately requires safe matching or user confirmation for uncertain new artists/titles. Preserve that safety property when adding or extending AI interpretation.

## Development rules

Before editing, confirm branch, working tree, file locations and service state. Do not guess ownership, paths or service scope.

The normal SSH workflow is Termius on Android, where large multi-line pastes can be corrupted. Prefer safe GitHub-side repository edits. Give the HP operator small sequential commands for pull, syntax checks, service operations and hardware testing. Do not ask for large manual file pastes through Termius unless there is a specific reason.

After backend JavaScript changes, at minimum run the relevant `node --check` commands and `git diff --check` where applicable before restarting `marantz-backend.service`.

For hardware tests, explicitly state in advance when a command will physically change AVR power, source, volume, mute or playback. Prefer read-only status checks when a hardware change is not necessary.

Do not commit credentials, `.env` files, logs, runtime alias state, private configuration or machine-specific secrets.

## Project scope

This repository is only for the marantzPI / HP backend system. Unrelated computers, repairs, emulation/Batocera systems and other projects are outside this architecture and must not be used as assumptions for hardware, storage, networking or software decisions.

## Housekeeping policy

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, log and environment files are ignored by Git. One-off hard-coded diagnostic scripts should not be retained when equivalent tests can be run directly during troubleshooting.

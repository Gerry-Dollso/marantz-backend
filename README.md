# marantz-backend

Companion media/orchestration backend for marantzPI. It runs on the HP EliteDesk media server and exposes HEOS/TIDAL library operations plus validated semantic control used by the Raspberry Pi touchscreen and voice listener.

## Current known-good state

Active deployed/development branch:

```text
tidal-voice-development
```

Known-good functional checkpoint before this documentation update:

```text
1477413 — Complete persistent TIDAL voice learning
```

The service is deployed at `/opt/marantz-backend` on the media server and runs as the system service:

```text
marantz-backend.service
```

It listens on HTTP port 3100 and communicates with HEOS on TCP port 1255.

## Architecture

The Raspberry Pi remains the touchscreen/display/controller. This HP backend is the central media/orchestration layer for operations that should not live in the touchscreen process.

Current responsibilities include:

- HEOS/TIDAL library search and browse operations proxied from marantzPI.
- Semantic AVR control for power, source, volume, mute and transport.
- TIDAL artist, album and track voice requests.
- Safe voice-search fallback when an artist/title cannot be matched confidently.
- Persistent voice aliases for speech-recognition errors.
- Persistent artist and title/track learning confirmed from the marantzPI touchscreen.

The next development phase is local-AI language understanding. The local model should interpret natural language into a small validated semantic intent. It must not replace the deterministic control layer or receive unrestricted shell/filesystem/receiver access.

Target flow:

```text
voice -> transcription -> local AI/NLU -> validated semantic intent -> existing backend -> SR8015/HEOS
```

The existing deterministic parser remains a known-good fallback while AI behaviour is developed and benchmarked.

## Semantic control API

The backend provides user-level intentions rather than exposing arbitrary receiver commands:

- `POST /api/control/power?state=on|standby`
- `POST /api/control/source?source=phono|cd|heos|tidal|tv|aux`
- `POST /api/control/volume?action=up|down`
- `POST /api/control/volume?action=set&value=<dB>`
- `POST /api/control/mute?state=on|off|toggle`
- `POST /api/control/transport?action=play|pause|next|previous`

Source mappings remain backend policy. For example, `phono` recalls Smart Select 1, which selects the receiver's renamed 8K input rather than the physical PHONO input.

## TIDAL / voice integration

The backend supports the Pi's TIDAL browse/play routes and the voice-search/learning flow. Persistent learned aliases are runtime state and must not be replaced with guessed hard-coded corrections simply to make a test pass.

The voice-learning design deliberately requires safe matching or user confirmation for uncertain new artists/titles. Preserve that safety property when adding AI interpretation.

## Development rules

Before editing, confirm branch, working tree, file locations and service state. Do not guess ownership, paths or service scope.

The normal SSH workflow is Termius on Android, where large multi-line pastes can be corrupted. Prefer small sequential commands with verification, or safe GitHub-side edits when appropriate.

After backend JavaScript changes, at minimum run the relevant syntax checks and `git diff --check` before restarting `marantz-backend.service`.

Do not commit credentials, `.env` files, logs, runtime alias state, private configuration or machine-specific secrets.

## Project scope

This repository is only for the marantzPI / HP backend system. Unrelated computers, repairs, emulation/Batocera systems and other projects are outside this architecture and must not be used as assumptions for hardware, storage, networking or software decisions.

## Housekeeping policy

Temporary `server.js.before-*`, `server.js.phase-*`, `*.backup-*`, log and environment files are ignored by Git. One-off hard-coded diagnostic scripts should not be retained when equivalent tests can be run directly during troubleshooting.

# Marantz backend — developer / takeover guide

This repository is the HP EliteDesk backend for the MarantzPi system. It is intended to become the heavier, persistent **home-server brain** behind the Raspberry Pi touchscreen: AVR/HEOS integration, TIDAL/library services, voice/wake-word handling and the forthcoming constrained AI orchestration layer.

This README is a handover document. It records facts and project rules that should be checked here rather than rediscovered or guessed.

## Hardware / OS baseline

Known backend host:

- HP EliteDesk 800 G2 Mini 65W
- Intel i7-6700
- Debian 13 minimal, headless
- hostname: **`media-server`**
- administered primarily over SSH from an Android phone using Termius
- current backend LAN address used by marantzPI: **`192.168.50.145`**

The machine is intended to host additional home-server duties over time (media/library data, caches, backups, Soulseek, GitHub mirror/logs, automation and AI services), so new Marantz features should coexist cleanly rather than assuming the server is single-purpose.

## Repository / branch

- Repository: `Gerry-Dollso/marantz-backend`
- Active branch: **`main`**
- Current code is intentionally small and direct; do not invent a framework migration merely to add the AI layer.

The exact production checkout directory and systemd service name are **not encoded in this repository at the time of writing**. Verify them on `media-server` before deployment instead of guessing. Once they are intentionally standardised, update this README.

## Current network/API facts

`server.js` currently contains these installation-specific values:

- SR8015 host: **`192.168.50.220`**
- AVR Telnet/control port: **23**
- HEOS CLI port: **1255**
- HEOS player ID: **`48723103`**
- backend HTTP port: **3100**
- TIDAL HEOS service ID used by browse/search: **10**

The Raspberry Pi v3 code currently calls this server at `192.168.50.145:3100`.

These are known working environment values, not generic examples. If the network or HEOS player changes, update them deliberately and test both repositories together.

## Receiver/source facts that must not be guessed

Current receiver: **Marantz SR8015**.

The user's source label **PHONO does not mean the SR8015 native PHONO input**. The external phono stage is connected to the receiver's **8K input**, which has been renamed PHONO in the installation.

Tested/intended source-selection mapping:

- PHONO → `MSSMART1`
- CD → `MSSMART2`
- HEOS/TIDAL → `MSSMART3`
- TV → `MSSMART4`
- AUX/projector → `SIAUX1`

`server.js` also exposes lower-level `/api/avr/input` commands. Do not confuse those direct input commands with the higher-level `/api/source` Smart Select behaviour. For user-facing control, preserve the established installation semantics unless intentionally redesigning them.

## Current responsibilities in `server.js`

The server uses Node's built-in `http` and `net` modules and currently provides deterministic control functions for:

- AVR power, input, volume and mute status/control;
- Smart Select/source control;
- HEOS now-playing status;
- HEOS play/pause/next/previous;
- TIDAL search via HEOS;
- TIDAL library/container browsing with pagination;
- artist → albums browsing;
- album → tracks browsing;
- TIDAL/HEOS playback operations.

Before changing any HEOS browse logic, remember that HEOS may initially return `command under process`; `heosBrowse()` deliberately waits for a useful final response/payload instead of assuming the first response is the result.

## Voice / wake-word work already present

`voice-training/` currently contains:

- `hey_marantz_colab.ipynb` — Colab training workflow for the **“Hey Marantz”** wake word.
- `hey_marantz_outputs.zip` — trained wake-word outputs added 22 Aug 2026.

Treat trained model artifacts as versioned assets. Do not overwrite a known model without preserving the old version/commit and recording why the replacement is better.

## Coding rules learned during this project

1. **Verify before guessing.** IPs, ports, player IDs, receiver source names, branches, paths, users, ownership and service names must come from the host/repository or this documentation.
2. **Prefer GitHub-side edits for substantial safe changes.** Administration is often through Termius on an Android phone; large multi-line terminal pastes have repeatedly been corrupted or made difficult to verify. Use GitHub commits for sizeable text/code edits where practical, then pull on the server.
3. **Keep SSH commands small and sequential.** Avoid giant heredocs and long multi-command pastes on the phone. Run one logical step, inspect the result, then continue.
4. **Syntax-check before restarting/deploying.** At minimum run `node --check server.js` for backend JS changes.
5. **Test deterministic APIs before layering AI on top.** If an AVR/HEOS action does not work reliably via its explicit endpoint, fix that action first; do not ask the AI layer to compensate for it.
6. **Commit known-good milestones before risky work.** Especially before modifying AVR/HEOS protocol handling, TIDAL browsing or voice/AI runtime code.
7. **Do one conceptual change at a time.** Network protocol changes, API changes, AI intent parsing, wake-word detection and UI integration should be independently testable.
8. **Do not duplicate Pi responsibilities unnecessarily.** The HP should do heavier/persistent work; the Pi should remain a responsive touchscreen/control edge.
9. **Do not put secrets into Git.** If future AI providers, tokens or credentials are introduced, use environment/config files excluded by `.gitignore` and document only variable names/setup steps.
10. **Document every new external dependency.** The current server is dependency-light. If Python, a model runtime, vector database, speech stack or Node package is added, record version, install command, model path and service ownership here.

## AI architecture rule

The forthcoming AI model must sit **above a constrained deterministic action layer**, not directly above sockets or the shell.

Recommended pattern:

`wake word / text → speech-to-text (if voice) → intent/model → validated action + arguments → deterministic backend function → AVR/HEOS/service`

The model should choose from an allow-listed schema such as `set_source`, `set_volume`, `pause`, `play`, `search_tidal`, `play_album`, etc. Each action must validate arguments and enforce sensible bounds before reaching the receiver.

Do **not** give the language model a tool that accepts arbitrary AVR strings, arbitrary HEOS URIs or shell commands. This makes testing and recovery far harder and allows hallucinated protocol commands to reach real hardware.

For initially destructive or disruptive actions (for example power-off, very large volume changes, deleting library data, changing server configuration), add explicit policy/confirmation handling outside the language model.

## Suggested module boundary before the AI grows

`server.js` is already large enough that the next phase should avoid adding all AI code inline. A safe refactor can extract existing tested functionality without changing behaviour, for example:

- `lib/avr.js` — SR8015 transport and validated receiver actions
- `lib/heos.js` — HEOS transport/browse/playback
- `lib/tidal.js` — TIDAL-specific browse/search abstractions
- `lib/actions.js` — allow-listed high-level actions shared by HTTP and AI
- `ai/` — intent/model integration only
- `voice/` — wake-word/STT pipeline only

Do this incrementally with regression tests/manual endpoint checks; do not rewrite the working server wholesale just to obtain this layout.

## Cross-repository testing

Changes to backend endpoints used by marantzPI must be tested end-to-end on the touchscreen. The Pi's active development branch is currently **`v3-development`** in `Gerry-Dollso/marantzPI`.

At minimum verify the affected subset of:

- `/api/status`;
- source/Smart Select behaviour;
- mute/volume/power;
- HEOS transport controls;
- TIDAL search;
- paginated TIDAL library browse;
- artist albums / album tracks;
- playback from the Pi UI;
- correct now-playing state after playback begins.

## Before every backend development session

From the actual production checkout (verify its location first):

```bash
git status
git branch --show-current
git pull
node --check server.js
```

Before restarting any service, verify its real name and whether it is a user or system service. Do not copy the Pi's `marantz-display.service` commands onto the HP; they are different machines with different roles.

See `CHANGELOG.md` for the consolidated backend history.

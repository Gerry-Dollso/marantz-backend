# Changelog

This changelog records significant backend milestones and maintenance-relevant project history. Use `git log` for the complete commit-by-commit history.

## Unreleased / next phase

### 2026-08-25 — takeover documentation and AI preparation

- Added a developer/takeover README before beginning the AI model phase.
- Recorded the HP/Debian baseline, live SR8015/HEOS network facts, source semantics, Termius editing limitations and cross-repository workflow.
- Established the architectural rule that AI must call validated allow-listed actions rather than arbitrary AVR/HEOS commands or shell commands.
- Documented a safe incremental module boundary for future AVR, HEOS, TIDAL, voice and AI code.

## 2026-08-22 — “Hey Marantz” wake word

- `a879b56` — added the trained **Hey Marantz** model outputs.
- `a9d2c0d` — added the Hey Marantz Google Colab training notebook/workflow.
- Voice training assets are stored under `voice-training/`.

## 2026-08-18 — TIDAL library integration

- `7bfb6e1` — completed TIDAL library browsing and playback.
- Backend supports HEOS/TIDAL browsing, including paginated container retrieval where required.
- Added/established TIDAL search, artist-album browsing, album-track browsing and playback paths used by the Pi UI.

## Earlier backend control foundation

- Established direct SR8015 AVR control over TCP port 23.
- Established HEOS CLI communication over TCP port 1255.
- Added deterministic status/control endpoints for power, mute, volume, input, Smart Select/source and HEOS transport.
- Established live installation values currently present in code: SR8015 `192.168.50.220`, HEOS player ID `48723103`, HTTP port `3100`.
- Established Smart Select semantics shared with marantzPI: PHONO/1, CD/2, HEOS/3, TV/4; AUX uses AUX1.

## Maintenance notes

- Add entries for tested behavioural milestones, model replacements, API contract changes and important infrastructure changes.
- If a network address, player ID, source mapping, model path or service arrangement changes, record both the old and new value and the date.
- If a feature is reverted, add an explicit reversion entry rather than silently leaving an older entry looking current.

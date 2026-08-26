# Changelog

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-26 — Pre-local-AI documentation baseline

- Confirmed active branch as `tidal-voice-development`.
- Recorded `1477413` (`Complete persistent TIDAL voice learning`) as the known-good functional checkpoint before documentation-only updates.
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

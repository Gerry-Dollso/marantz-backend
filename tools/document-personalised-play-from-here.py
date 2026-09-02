#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}')
    path.write_text(text.replace(old, new, 1))

handover = Path('CURRENT_HANDOVER.md')
changelog = Path('CHANGELOG.md')

replace_once(
    handover,
    'Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; richer contextual voice follow-ups; AI-assisted diagnosis from structured evidence; discovery across TIDAL metadata, Discogs-derived collection data and playback history; and, only when justified by a concrete retrieval need, lightweight local embeddings/semantic search. These are roadmap items, not yet implemented features.',
    'Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; a Current Queue view/control surface (read-only first, with current/upcoming tracks and available artwork/metadata, then optional play/remove/reorder/clear controls later); richer contextual voice follow-ups; AI-assisted diagnosis from structured evidence; discovery across TIDAL metadata, Discogs-derived collection data and playback history; and, only when justified by a concrete retrieval need, lightweight local embeddings/semantic search. These are roadmap items, not yet implemented features.'
)

replace_once(
    handover,
    'Backend source checkpoint: `2c8ac84 — Add lightweight personalised TIDAL artwork`.\n\nPi source checkpoint: `300be7a — Fix personalised TIDAL artwork loading`.',
    'Backend tested functional source checkpoint: `ad56d23 — Require selected My Mix track for play from here`.\n\nBackend clean repository checkpoint after migration-helper removal: `9ac4924 — Remove strict play from here helper`.\n\nPi tested functional source checkpoint: `041b035 — Make TIDAL track actions reusable`.\n\nPi current repository/documentation checkpoint: `0769f88 — Remove Play From Here documentation helper`.'
)

replace_once(
    handover,
    'Personalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY. PLAY FROM HERE remains deliberately unavailable for My Mixes for now. The next implementation should replace the current queue with the selected personalised track followed by every later track from the same Mix in original order, preserving existing deterministic resolution, background queue-building and generation-cancellation safety.',
    'Personalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END, PLAY FROM HERE and PLAY ONLY. PLAY FROM HERE sends the personalised playlist ID plus the exact official selected track ID, rejects shuffle, verifies the selected track belongs to the fetched Mix, slices the queue from that exact position and preserves the existing deterministic resolver, first-track `aid=4`, background `aid=3` builder and generation-cancellation safety. The selected first track is strict/fail-closed: if it cannot resolve or queue safely, the request fails rather than silently starting the following track; later unresolved tracks retain the normal safe-skip background behaviour. Live touchscreen acceptance confirmed exact selected-track starts, repeated PLAY FROM HERE use, and the final-track boundary where NEXT does not start an unrelated track. The Pi shared track-action lifecycle now clears disabled/loading state in `finally`, so these actions remain reusable.'
)

section = '''## 2026-09-02 — Personalised TIDAL PLAY FROM HERE\n\n- Added personalised My Mix PLAY FROM HERE using the existing official-TIDAL-to-HEOS queue architecture. The request carries the personalised playlist ID plus the exact official selected track ID; it does not fall back to a generic HEOS container action.\n- The backend validates the selected track ID, rejects PLAY FROM HERE combined with shuffle, confirms the track belongs to the freshly fetched personalised playlist and slices the queue from that exact position onward.\n- Preserved deterministic playback safety: the selected first track must resolve and queue successfully or the request fails closed. It is never silently replaced by the following track. Later tracks keep the existing safe-skip behaviour used by the background queue builder.\n- Preserved fast queue semantics: selected first track uses `aid=4`, the response returns promptly, remaining tracks build sequentially with `aid=3`, and generation checks cancel superseded builds.\n- Companion Pi work added the My Mix action routing and fixed the shared action-button lifecycle so disabled/loading state is always cleared in `finally`, making PLAY FROM HERE and other shared actions reusable.\n- Live acceptance confirmed the exact selected track starts, repeated PLAY FROM HERE works, selecting the final track produces a one-track tail, and NEXT after that final track does not start an unrelated item.\n- A touchscreen Current Queue view is now a follow-up roadmap item: read-only first, showing current/upcoming tracks with available artwork/title/artist/album metadata, with queue editing considered separately later.\n\nBackend implementation/checkpoint sequence includes:\n\n```text\n1b9934a — Add personalised TIDAL play from here\nad56d23 — Require selected My Mix track for play from here\n9ac4924 — Remove strict play from here helper\n```\n\nCompanion Pi functional checkpoint:\n\n```text\n041b035 — Make TIDAL track actions reusable\n```\n\n'''

replace_once(changelog, '# Changelog\n\n', '# Changelog\n\n' + section)

print('Updated backend CURRENT_HANDOVER and CHANGELOG for completed personalised PLAY FROM HERE')

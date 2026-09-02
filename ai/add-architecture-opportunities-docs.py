from pathlib import Path

readme = Path("README.md")
handover = Path("CURRENT_HANDOVER.md")

readme_text = readme.read_text(encoding="utf-8")
handover_text = handover.read_text(encoding="utf-8")

readme_anchor = "# marantz-backend\n"
handover_anchor = "## Current direction\n"
readme_marker = "## Architecture principles and future opportunities"
handover_marker = "## Proactive architecture roadmap"

if readme_marker in readme_text or handover_marker in handover_text:
    raise SystemExit("architecture roadmap already present; no change made")
if readme_text.count(readme_anchor) != 1:
    raise SystemExit(f"expected one README heading, found {readme_text.count(readme_anchor)}; no change made")
if handover_text.count(handover_anchor) != 1:
    raise SystemExit(f"expected one handover Current direction heading, found {handover_text.count(handover_anchor)}; no change made")

readme_section = """

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
"""

handover_section = """

## Proactive architecture roadmap

The HP is deliberately an extensible local brain. `marantz-ai.service` (persistent llama.cpp/Qwen) is available beyond the current voice/intent classifier when AI genuinely improves the system. Future chats/developers should proactively identify and propose useful backend services, packages, diagnostics, storage, automation and AI capabilities rather than waiting for the user to suggest them, but must explain and obtain approval before installation or implementation.

Maintain the safety boundary: AI may interpret language/context, assist discovery and explain diagnostics; deterministic/fail-closed code remains authoritative for TIDAL-to-HEOS identity, AVR control and playback/queue mutation.

Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; richer contextual voice follow-ups; AI-assisted diagnosis from structured evidence; discovery across TIDAL metadata, Discogs-derived collection data and playback history; and, only when justified by a concrete retrieval need, lightweight local embeddings/semantic search. These are roadmap items, not yet implemented features.
"""

readme.write_text(readme_text.replace(readme_anchor, readme_anchor + readme_section, 1), encoding="utf-8")
handover.write_text(handover_text.replace(handover_anchor, handover_anchor + handover_section, 1), encoding="utf-8")
print("Inserted guarded architecture roadmap into README.md and CURRENT_HANDOVER.md")

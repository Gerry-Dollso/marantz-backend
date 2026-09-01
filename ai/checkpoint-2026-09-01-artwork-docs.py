#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
readme_path = root / 'README.md'
changelog_path = root / 'CHANGELOG.md'
handover_path = root / 'CURRENT_HANDOVER.md'
readme = readme_path.read_text()
changelog = changelog_path.read_text()
handover = handover_path.read_text()

readme_heading = '## 2026-09-01 — Lightweight personalised TIDAL artwork checkpoint\n'
readme_section = """## 2026-09-01 — Lightweight personalised TIDAL artwork checkpoint\n\n- Added a dedicated lightweight personalised artwork path so the touchscreen no longer loads complete My Mix playlists merely to construct landing-card collages.\n- `getPersonalisedArtwork(playlistId)` returns up to four distinct official TIDAL cover URLs from the first playlist page only. It does not paginate for artwork.\n- Artwork has its own 30-minute bounded in-memory cache. If the full personalised-playlist cache is already warm, artwork is derived from that cached track list with zero additional TIDAL API calls.\n- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. The existing full `/api/tidal/personalised/playlist` path remains unchanged for opening and playing a Mix.\n- The Pi now loads landing artwork sequentially and retries only a failed card once after two seconds, reducing cold-load request pressure instead of increasing concurrency.\n- Runtime proof: all ten My Mix/My Daily Discovery/My New Arrivals cards populated with warm caches, then the backend service was restarted to clear in-memory caches and all ten populated again from a genuine cold backend cache.\n- Temporary artwork migration helpers were removed after verification.\n\nCurrent tested backend source checkpoint:\n\n```text\n2c8ac84 — Add lightweight personalised TIDAL artwork\n```\n\nCompanion Pi checkpoint:\n\n```text\n300be7a — Fix personalised TIDAL artwork loading\n```\n\nNext planned personalised-playlist work is PLAY FROM HERE: replace the queue with the selected track followed by all subsequent tracks from the same Mix in original order. It is not implemented yet.\n\n"""
if readme_heading in readme:
    raise SystemExit('README artwork section already exists')
anchor = '## 2026-08-31 — Fast personalised TIDAL playback and rich UI backend checkpoint\n'
if readme.count(anchor) != 1:
    raise SystemExit(f'Expected one README anchor, found {readme.count(anchor)}')
readme = readme.replace(anchor, readme_section + anchor, 1)
readme = readme.replace('Current tested backend source checkpoint:\n\n```text\n66f6345 — Expose personalised TIDAL descriptions\n```', 'Current tested backend source checkpoint:\n\n```text\n2c8ac84 — Add lightweight personalised TIDAL artwork\n```', 1)

change_heading = '## 2026-09-01 — Lightweight personalised TIDAL artwork\n'
change_section = """## 2026-09-01 — Lightweight personalised TIDAL artwork\n\n- Added an independent 30-minute `personalisedArtworkCache` for landing-card covers.\n- Added `getPersonalisedArtwork(playlistId)`, which first reuses the full personalised playlist cache when available; otherwise it fetches only the first official playlist page and stops after collecting up to four distinct cover URLs.\n- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. Full personalised playlist pagination remains reserved for actual playlist detail/playback.\n- This change addresses the observed TIDAL 429/temporary failure pattern caused by unnecessary full-playlist artwork enrichment under cold-cache activity without weakening resolver or playback safety.\n- Verified the endpoint on My Mix 1 with four official artwork URLs and a warm-cache repeat.\n- End-to-end Pi testing populated all ten personalised cards from a genuine cold backend cache after restarting `marantz-backend.service`.\n- PLAY FROM HERE remains deliberately pending and is the next planned personalised queue-tail feature.\n\nCheckpoint:\n\n```text\n2c8ac84 — Add lightweight personalised TIDAL artwork\n```\n\nCompanion Pi checkpoint:\n\n```text\n300be7a — Fix personalised TIDAL artwork loading\n```\n\nCurrent tested backend source checkpoint:\n\n```text\n2c8ac84 — Add lightweight personalised TIDAL artwork\n```\n\n"""
if change_heading in changelog:
    raise SystemExit('CHANGELOG artwork section already exists')
change_anchor = '## 2026-08-31 — Fast personalised TIDAL playback and rich UI backend checkpoint\n'
if changelog.count(change_anchor) != 1:
    raise SystemExit(f'Expected one CHANGELOG anchor, found {changelog.count(change_anchor)}')
changelog = changelog.replace(change_anchor, change_section + change_anchor, 1)

old_handover_header = '# Current handover — 31 Aug 2026\n'
if handover.count(old_handover_header) != 1:
    raise SystemExit('Unexpected CURRENT_HANDOVER heading')
handover = handover.replace(old_handover_header, '# Current handover — 1 Sep 2026\n', 1)
old_checkpoints = """Backend source checkpoint: `66f6345 — Expose personalised TIDAL descriptions`.\n\nPi source checkpoint: `a65f1b5 — Add rich personalised TIDAL landing cards`.\n\nThe Pi landing page for My Mix 1-8, My Daily Discovery and My New Arrivals renders official TIDAL names/descriptions immediately, then progressively fills each card with a 2x2 collage from up to four distinct official album covers using limited concurrency. Personalised track rows show official artwork, title, artist and album.\n"""
new_checkpoints = """Backend source checkpoint: `2c8ac84 — Add lightweight personalised TIDAL artwork`.\n\nPi source checkpoint: `300be7a — Fix personalised TIDAL artwork loading`.\n\nThe Pi landing page for My Mix 1-8, My Daily Discovery and My New Arrivals renders official TIDAL names/descriptions immediately, then progressively fills each card with a 2x2 collage from up to four distinct official album covers. Landing artwork now uses a dedicated first-page-only backend endpoint with an independent 30-minute cache. Pi enrichment is sequential and a failed card receives one delayed retry. End-to-end testing populated all ten cards from a genuinely cold backend cache. Personalised track rows show official artwork, title, artist and album.\n"""
if handover.count(old_checkpoints) != 1:
    raise SystemExit('Unexpected CURRENT_HANDOVER checkpoint block')
handover = handover.replace(old_checkpoints, new_checkpoints, 1)
old_contract = """`/api/tidal/personalised` returns the ten current personalised recommendation resources with `id`, `name`, `kind` and official TIDAL `description`. The playlist detail endpoint returns canonical tracks with id, title, artist/artistId, album/albumId, duration, explicit, ISRC and official artwork.\n\nThe Pi uses the existing playlist detail endpoint progressively for landing-card artwork rather than blocking the initial recommendation listing or adding a separate preview endpoint. Measured Pi-side playlist calls were roughly 24-26 ms during testing.\n\nPersonalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY. PLAY FROM HERE remains deliberately unavailable for My Mixes for now.\n"""
new_contract = """`/api/tidal/personalised` returns the ten current personalised recommendation resources with `id`, `name`, `kind` and official TIDAL `description`. The full playlist detail endpoint returns canonical tracks with id, title, artist/artistId, album/albumId, duration, explicit, ISRC and official artwork.\n\nLanding-card artwork uses the separate `GET /api/tidal/personalised/artwork?id=<playlistId>` endpoint. On a cold artwork/full-playlist cache it fetches only the first official playlist page and returns up to four distinct artwork URLs; it does not paginate. Artwork has an independent 30-minute cache, and a warm full-playlist cache can satisfy it with no additional TIDAL request. The Pi loads these requests sequentially and retries only a failed card once after two seconds.\n\nPersonalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY. PLAY FROM HERE remains deliberately unavailable for My Mixes for now. The next implementation should replace the current queue with the selected personalised track followed by every later track from the same Mix in original order, preserving existing deterministic resolution, background queue-building and generation-cancellation safety.\n"""
if handover.count(old_contract) != 1:
    raise SystemExit('Unexpected CURRENT_HANDOVER personalised contract')
handover = handover.replace(old_contract, new_contract, 1)

readme_path.write_text(readme)
changelog_path.write_text(changelog)
handover_path.write_text(handover)
Path(__file__).unlink()
print('Updated backend README/CHANGELOG/HANDOVER checkpoint and removed migration helper')

'use strict';

const fs = require('fs');
const path = 'CURRENT_HANDOVER.md';
let text = fs.readFileSync(path, 'utf8');

function replaceExact(before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing ${label} anchor`);
  if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`Ambiguous ${label} anchor`);
  text = text.replace(before, after);
}

replaceExact('# Current handover — 14 Sep 2026', '# Current handover — 15 Sep 2026', 'handover date');

replaceExact(
`## Immediate next-chat work — agreed order\n\nThe next chat should start from the clean checkpoints above and tackle these in order. Do not begin by changing production code; inspect the relevant current source and establish the read-only contract first.\n\n1. **Current Queue:** add a link/control on the Pi Now Playing screen to a live Current Queue view. The user ultimately wants to inspect, select, edit and reorder/sort tracks. Start read-only: establish the exact HEOS queue rows/count/qid/mid behaviour and how current/upcoming rows map to available artwork/title/artist/album metadata. The backend already issues HEOS \`player/get_queue\` internally for rolling Favourite Tracks verification and selected-item handling, but there is no general user-facing queue endpoint/control surface yet. Before adding remove/move/clear/play-selected commands, account for the accepted Favourite Tracks rolling session and personalised background queue builders so UI edits cannot race them or silently violate fail-closed queue ownership.\n\n2. **Now Playing favourite heart:**`,
`## Current Queue — production accepted 15 Sep 2026\n\nThe read-only Current Queue stage is complete and live-tested on the Pi. Permanent checkpoints are Pi \`41e8ab0 — Add read-only Current Queue API\` and \`1796f6c — Add read-only Current Queue UI\`. The HP backend was deliberately not changed for this feature.\n\nThe Pi now exposes read-only \`GET /api/queue\`, reusing its existing HEOS queue reader and a current-media query. The normalized response contains physical queue count plus qid, mid, albumId, song, artist, album, imageUrl and current-row state. The Now Playing QUEUE button opens a dedicated CURRENT QUEUE screen; the current row is highlighted as NOW PLAYING. The UI refreshes \`/api/queue\` every 5 seconds only while open, stops on BACK, preserves manual scroll position during refresh, and centres the current row only on initial open. Live acceptance confirmed the highlight advances automatically on a natural track transition.\n\nThe key contract is **physical HEOS queue, not source/canonical length**. Favourite Tracks rolling playback was observed with 10 physical rows initially and 15 after the backend appended its next five-track batch. A user-created Chill Mix containing 125 source tracks exposed only 50 physical HEOS rows at that moment. My Mix 2 exposed 24 rows initially and later 40. Therefore the queue header reports exactly what HEOS currently materialises; never label a physical count as a source total or fabricate the unmaterialised remainder.\n\nHEOS queue rows already provide artwork, title, artist, album, qid, mid and album_id, so the HP official TIDAL API is not required for this basic queue viewer. Current-media qid/mid matched the corresponding physical row throughout live tests. Retained queue/current-position state while the AVR is off or after leaving NET is intentional MarantzPi resume behaviour and must not be treated as stale merely because receiver power is off.\n\nQueue viewing and queue mutation remain separate stages. No play-selected, remove, reorder, sort or clear controls were added. The user is currently satisfied with viewing and does not consider editing a priority. If mutation is revisited later, separately prove its interaction with ordinary HEOS playback, Favourite Tracks rolling playback and personalised/background queue builders; do not complicate or regress the accepted read-only viewer.\n\n## Immediate next-chat work — agreed order\n\nCurrent Queue is complete. Continue in this order, using GitHub for repository inspection and Termius only for runtime evidence/deployment checks that GitHub cannot provide. Do not begin production changes before the relevant read-only contract is understood.\n\n1. **Now Playing favourite heart:**`,
'Current Queue roadmap');

replaceExact('3. **TIDAL landing/home artwork:**', '2. **TIDAL landing/home artwork:**', 'roadmap numbering 1');
replaceExact('4. **Richer artist page:**', '3. **Richer artist page:**', 'roadmap numbering 2');

replaceExact(
`Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; a Current Queue view/control surface (read-only first, with current/upcoming tracks and available artwork/metadata, then optional play/remove/reorder/clear controls later); richer contextual voice follow-ups;`,
`Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; optional Current Queue mutation controls only if the user later wants them and only after separate queue-owner safety work; richer contextual voice follow-ups;`,
'future roadmap');

replaceExact(
`Pi final documentation-cleaned/pushed head: \`649b272 — Remove handover documentation updater\`; latest tested production cleanup before documentation-only commits: \`1758311 — Remove TIDAL swipe return migration helper\`. Latest tested production UI checkpoints are \`36bd317 — Restore TIDAL browse with Now Playing swipe\` and \`84170a5 — Sort TIDAL Artists alphabetically\`.`,
`Pi current tested/pushed production head before this documentation update: \`1796f6c — Add read-only Current Queue UI\`; its paired API checkpoint is \`41e8ab0 — Add read-only Current Queue API\`. Earlier tested UI checkpoints remain \`36bd317 — Restore TIDAL browse with Now Playing swipe\` and \`84170a5 — Sort TIDAL Artists alphabetically\`.`,
'Pi checkpoints');

fs.writeFileSync(path, text);
console.log('Updated CURRENT_HANDOVER.md for accepted Current Queue work');

const fs = require('fs');

const path = 'docs/TIDAL_FAVOURITE_TRACKS_2026-09-07.md';
const start = '## Current checkpoint / next implementation step\n';
const end = 'Temporary migration/recon helpers are implementation tools, not production architecture, and should be removed after their findings/changes are safely committed and documented.\n\nDo not modify/delete the user\'s TIDAL favourites as part of this work; the 594-track consumer collection appears correct and the malformed 635-row representation is visible independently in HEOS.';

const replacement = `## Current checkpoint / next implementation step

The backend **Favourite Tracks display and canonical playback stages are complete and production-validated**. The current backend branch contains:

- canonical official loader/cache with accepted pacing;
- non-blocking startup prewarm;
- fast read-only \`/api/tidal/favourite-tracks\` endpoint serving the canonical 594 official tracks with rich TIDAL metadata;
- reusable read-only official↔HEOS library bridge;
- confirmed 594/594 exact ID-set and order invariant for the captured \`My Music-Tracks\` library;
- HEOS raw 635-row representation retained only as playback/correlation/diagnostic context, not display authority;
- canonical PLAY ALL, SHUFFLE ALL and PLAY FROM HERE using the production-accepted rolling queue architecture;
- initial 10-track playable buffer, fewer-than-5 low-water threshold and 5-track replenishment batches;
- persistent debounced HEOS event reconciliation with bounded-tail identity/qid validation and fail-closed external-queue detection;
- explicit rolling-session generation supersession for new queue-replacing Favourite Tracks actions.

Display source checkpoint: \`6f6ab2f\` (\`Add fast Favourite Tracks library endpoint\`). Rolling playback source checkpoint: \`4d6da8c\` (\`Use rolling Favourite Tracks queue\`). Spent rolling migration/fix helpers were removed in cleanup commit \`abdf6ba\`.

The next implementation stage is the **MarantzPi TRACKS UI migration**:

1. change the Pi Favourite Tracks / TRACKS display to consume \`/api/tidal/favourite-tracks\` instead of the slow/raw HEOS \`My Music-Tracks\` browse representation;
2. display the continuous canonical 594-track official-TIDAL list using rich official metadata/artwork, without restoring the old HEOS-driven pager;
3. preserve the existing TRACKS affordances, including PLAY ALL, SHUFFLE ALL and the per-track action menu;
4. keep official TIDAL metadata as display authority while HEOS remains deterministic playback transport;
5. preserve the literal-space \`My Music-Tracks\` HEOS context and the accepted rolling playback architecture; do not route Favourite Tracks through the separate My-Mix replacement resolver;
6. runtime-test the Pi screen for fast opening, complete continuous-list behaviour, artwork/metadata, individual actions, PLAY ALL, SHUFFLE ALL and PLAY FROM HERE before declaring the TRACKS migration complete.

Temporary migration/recon helpers are implementation tools, not production architecture, and should be removed after their findings/changes are safely committed and documented.

Do not modify/delete the user's TIDAL favourites as part of this work; the 594-track consumer collection appears correct and the malformed 635-row representation is visible independently in HEOS.`;

const original = fs.readFileSync(path, 'utf8');
const startCount = original.split(start).length - 1;
const endCount = original.split(end).length - 1;
if (startCount !== 1) throw new Error(`Expected exactly one checkpoint start, found ${startCount}`);
if (endCount !== 1) throw new Error(`Expected exactly one checkpoint end, found ${endCount}`);
const startIndex = original.indexOf(start);
const endIndex = original.indexOf(end, startIndex);
if (endIndex < 0) throw new Error('Checkpoint end not found after start');
const afterEnd = endIndex + end.length;
const updated = original.slice(0, startIndex) + replacement + original.slice(afterEnd);
fs.writeFileSync(path, updated);
console.log('Applied guarded Favourite Tracks checkpoint documentation fix');

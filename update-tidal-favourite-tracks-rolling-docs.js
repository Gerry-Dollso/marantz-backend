const fs = require('fs');

const path = 'docs/TIDAL_FAVOURITE_TRACKS_2026-09-07.md';
const anchor = '## Current checkpoint / next implementation step';
const replacement = `## Rolling canonical playback — production acceptance 2026-09-08

The canonical playback migration is now complete and runtime-accepted. Production source checkpoint: \`4d6da8c\` (\`Use rolling Favourite Tracks queue\`). Spent rolling migration/fix helpers were removed in cleanup commit \`abdf6ba\`.

### Why the original full-queue builder was rejected

The first canonical PLAY ALL implementation attempted to add all 594 official tracks to HEOS serially in one long-running request. Runtime testing showed that this was structurally unsafe: Battleflag started, but natural transition to the next track failed while the backend continued issuing hundreds of \`add_to_queue\` commands. Disconnecting the HTTP client did not stop that backend builder.

Read-only and controlled HEOS tests then established that bounded individual additions are healthy once continuous queue mutation stops. A native \`My Music-Tracks\` container add also proved that HEOS itself can play through the canonical first tracks, but HEOS ignores an attempted \`range\` parameter on container \`add_to_queue\`, so native paged container additions cannot be used to build the canonical 594-track logical queue.

### Accepted rolling design

The production solution keeps the canonical official-TIDAL sequence in backend session state and feeds HEOS only a small playable window:

- initial buffer: **10 tracks**;
- low-water threshold: **fewer than 5 tracks ahead**;
- replenishment batch: **5 tracks**;
- persistent HEOS change-event connection rather than continuous polling;
- \`player_now_playing_changed\` / queue events are debounced and followed by state reconciliation rather than trusted as one-event-per-track signals;
- current qid and total HEOS queue count determine tracks ahead;
- reconciliation validates a bounded recent queue tail against the expected canonical MIDs and qids before appending;
- external queue divergence fails closed and stops the rolling session instead of appending to an unknown/foreign queue;
- consumed queue rows are retained in v1, avoiding qid renumbering/removal complexity;
- new queue-replacing sessions supersede the previous generation explicitly;
- the HTTP request returns after the initial playable buffer; the desired rolling session continues server-side independently of the request connection;
- HEOS shuffle remains off. SHUFFLE ALL shuffles the canonical 594-track list once in the backend and rolls through that fixed shuffled order.

The bounded-tail check deliberately avoids fetching/comparing the whole accumulated HEOS queue as playback progresses.

### Runtime acceptance — PLAY ALL

Production PLAY ALL returned after exactly the initial 10 canonical tracks with \`rolling:true\`, \`total:594\`, no skips, and Battleflag (MID \`487926786\`) started correctly. HEOS independently reported \`count=10\` and the exact canonical qid 1–10 sequence.

At qid 6 (Theme), the event-driven low-water check automatically replenished **10 → 15**. Qids 11–15 were verified as the exact next canonical tracks: Dead Souls, Backwater, Dirty Boots, Natural Blues and Simple Things. Playback naturally crossed the original-buffer boundary into Dead Souls and then Backwater. At qid 11 the second automatic replenishment correctly advanced **15 → 20**.

A live supersession test then started PLAY ALL again while generation 1 was active. The backend logged generation 1 stopped with reason \`new-session\` and generation 2 started with a fresh 10-track buffer; Battleflag restarted correctly. This proves the old rolling generation does not remain in control when a new queue-replacing Favourite Tracks session starts.

### Runtime acceptance — SHUFFLE ALL

Production SHUFFLE ALL returned \`shuffle:true\`, \`rolling:true\`, \`total:594\` and only 10 initial tracks. The first shuffled MID \`126953\` started Road to Nowhere by Talking Heads as expected. The first ten HEOS qids were captured as the fixed shuffled-session reference.

At shuffled qid 6 (Enemy of My Enemy), automatic replenishment advanced **10 → 15**. The appended qids 11–15 were Blank Generation, Rebellion (Lies), Battleflag, Wear It So Well and Vaporizer. Playback then crossed naturally into the replenished section and reached Battleflag at qid 13. A second low-water event at qid 11 correctly replenished **15 → 20**. This confirms that replenishment follows the one fixed backend shuffle rather than reshuffling each batch.

### Runtime acceptance — PLAY FROM HERE

Favourite Tracks PLAY FROM HERE now uses the same rolling mechanism. Starting from canonical position 5, Dirge (MID \`501665\`), returned an initial 10-track buffer with \`rolling:true\` and \`total:590\` (positions 5–594 inclusive). HEOS qids 1–10 exactly matched canonical positions 5–14.

At local qid 6 (Jane Says), automatic replenishment advanced **10 → 15**. The appended qids 11–15 were exactly Simple Things, God Bless, Mountain Song, Post Houmous and Unreal. This confirms PLAY FROM HERE preserves the selected canonical tail rather than reverting to the raw 635-row HEOS representation.

### Accepted playback conclusion

PLAY ALL, SHUFFLE ALL and PLAY FROM HERE are now production-runtime accepted on the canonical official 594-track Favourite Tracks collection. The rolling architecture removes the long continuous HEOS mutation that caused the failed full-queue attempt while preserving deterministic official-TIDAL identity/order and HEOS playback transport.

Do not revert these routes to raw 635-row HEOS Favourite Tracks browsing or to a single long-running 594-command queue build.

## Current checkpoint / next implementation step`;

const original = fs.readFileSync(path, 'utf8');
const count = original.split(anchor).length - 1;
if (count !== 1) {
  throw new Error(`Expected exactly one checkpoint anchor, found ${count}`);
}
if (original.includes('## Rolling canonical playback — production acceptance 2026-09-08')) {
  throw new Error('Rolling playback documentation already present');
}
const updated = original.replace(anchor, replacement);
fs.writeFileSync(path, updated);
console.log('Applied guarded Favourite Tracks rolling playback documentation update');

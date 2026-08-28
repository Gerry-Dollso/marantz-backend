'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function replaceOnce(file, before, after) {
  const p = path.join(root, file);
  const text = fs.readFileSync(p, 'utf8');
  if (!text.includes(before)) throw new Error(`${file}: expected anchor not found`);
  if (text.includes(after)) throw new Error(`${file}: documentation already applied`);
  fs.writeFileSync(p, text.replace(before, after));
  console.log(`Updated ${file}`);
}

replaceOnce(
  'README.md',
  '## Current known-good state — 27 Aug 2026',
  '## Current known-good state — 28 Aug 2026'
);

replaceOnce(
  'README.md',
  '51c3135 — Add full TIDAL favourite tracks playback',
  '848558a — Harden TIDAL favourite tracks queueing'
);

replaceOnce(
  'README.md',
  '- Queue additions are deliberately sequential rather than concurrent because sequential HEOS command handling has proven reliable.\n- Playback begins from the first selected track before the whole 576-track queue is finished; the remainder builds quietly behind playback.',
  '- Queue additions are deliberately sequential rather than concurrent because sequential HEOS command handling has proven reliable.\n- Each `browse/add_to_queue` operation in this full-library builder has a dedicated 15-second HEOS timeout. The normal 5-second `heosBrowse()` default proved too short for some legitimate queue additions.\n- A failed or timed-out favourite is logged and skipped individually; it no longer aborts the entire queue build. The first successful track receives `aid=4`; later successful tracks receive `aid=3`.\n- Playback begins from the first selected track before the whole 576-track queue is finished; the remainder builds quietly behind playback.\n\nLive diagnosis on 28 Aug 2026 showed that the earlier 5-second timeout produced false `TIDAL FAVOURITE TRACK SKIP` messages and eventually HEOS `eid=12 / syserrno=-2000` errors as commands accumulated. After restarting onto the 15-second per-track timeout, a clean Shuffle All test grew from 9 to 34 queued tracks with zero new skip messages. Preserve the longer timeout locally for this queue builder rather than increasing the global HEOS timeout.'
);

replaceOnce(
  'README.md',
  '51c3135 — Add full TIDAL favourite tracks playback\n```',
  '51c3135 — Add full TIDAL favourite tracks playback\nc7f508a — Add per-track failure isolation migration\n96fff02 — Add 15-second queue timeout migration\n848558a — Harden TIDAL favourite tracks queueing\n```'
);

const changelogPath = path.join(root, 'CHANGELOG.md');
let changelog = fs.readFileSync(changelogPath, 'utf8');
const heading = '## 2026-08-28 — TIDAL Favourite Tracks queue hardening';
if (changelog.includes(heading)) throw new Error('CHANGELOG.md: documentation already applied');
const anchor = '## 2026-08-27 — Full TIDAL Favourite Tracks playback';
if (!changelog.includes(anchor)) throw new Error('CHANGELOG.md: expected anchor not found');
const entry = [
  heading,
  '',
  '- Diagnosed the apparent unavailable-favourite problem as HEOS command latency rather than a catalogue problem. The shared `heosBrowse()` default is 5 seconds, but legitimate `browse/add_to_queue` operations can take longer.',
  '- Kept the global HEOS timeout unchanged and gave only the full Favourite Tracks queue builder a 15-second per-track timeout.',
  '- Added per-track failure isolation: one genuine failure is logged and skipped without aborting the remaining full-library queue build. The first successful track uses `aid=4`; subsequent successful tracks use `aid=3`.',
  '- The earlier 5-second behaviour produced repeated false timeout skips and eventually `eid=12 / syserrno=-2000` errors while HEOS was still processing prior commands.',
  '- Clean live Shuffle All verification after service restart grew the queue from 9 to 34 tracks with zero new skip messages.',
  '- Sequential background queue construction remains intentional; do not replace it with concurrent bursts.',
  '',
  'Current tested backend checkpoint:',
  '',
  '```text',
  '848558a — Harden TIDAL favourite tracks queueing',
  '```',
  '',
  ''
].join('\n');
changelog = changelog.replace(anchor, entry + anchor);
fs.writeFileSync(changelogPath, changelog);
console.log('Updated CHANGELOG.md');

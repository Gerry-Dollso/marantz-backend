'use strict';

const fs = require('fs');
const path = require('path');

const readmePath = path.resolve(__dirname, '..', 'README.md');
let text = fs.readFileSync(readmePath, 'utf8');

const startHeading = '### Official API -> HEOS playback bridge — proven live';
const endHeading = '## Rich TIDAL browsing direction';
const alreadyHeading = '### Official API -> HEOS playback bridge — deterministic resolution proven';

if (text.includes(alreadyHeading)) {
  console.log('README bridge section is already updated; no changes made.');
  process.exit(0);
}

const start = text.indexOf(startHeading);
const end = text.indexOf(endHeading, start + startHeading.length);

if (start === -1) {
  throw new Error('Expected old bridge heading was not found; refusing to edit README.md');
}
if (end === -1 || end <= start) {
  throw new Error('Expected Rich TIDAL browsing heading was not found after bridge section; refusing to edit README.md');
}
if (text.indexOf(startHeading, start + 1) !== -1) {
  throw new Error('Old bridge heading occurs more than once; refusing to edit README.md');
}

const replacement = `### Official API -> HEOS playback bridge — deterministic resolution proven

The end-to-end bridge from official personalized recommendations to HEOS is proven, but identifiers must be used with context rather than constructed blindly. The original Phantogram proof remains an important counterexample: official track ID \`111442201\` / album ID \`111442199\` resolved in HEOS as track MID \`111438014\` inside \`LIBALBUM-111438012\`. Therefore official API album/track IDs are **not universally interchangeable** with HEOS IDs.

A later read-only resolver probe tested 26 representative recommendation tracks across My Mix 1, My Daily Discovery and My New Arrivals without issuing any player, queue, source or volume commands. The final result was:

\`\`\`text
23 resolved
1 ambiguous
2 unresolved
0 errors
\`\`\`

Of the 23 resolved tracks, **22 resolved through \`direct-album-id+official-mid\`**. Swans - \`Screen Shot\` resolved through the artist -> album -> track fallback. The important deterministic rule is narrower than universal ID equality: **when a real candidate HEOS context exposes a playable MID exactly equal to the official TIDAL track ID, treat that as deterministic track identity.**

This rule remains valid even when HEOS and official TIDAL metadata display different primary artist credits. Vince Staples - \`Who Are You\` exposed official track ID / HEOS MID \`536071631\` while HEOS displayed Dahi. \`That's Law\` exposed official track ID / HEOS MID \`536793606\` while HEOS displayed CZARFACE rather than Frankie Pulitzer. Those metadata differences do not override an exact numeric track-identity match inside the expected catalogue context.

Other useful findings:

- My Life With The Thrill Kill Kult - \`A Daisy Chain 4 Satan (Acid & Flowers Mix)\` resolved once HEOS \`%26\` title encoding was normalized; official track ID and HEOS MID are both \`113779406\`.
- Ladytron - \`Destroy Everything You Touch\` became deterministic through the exact official-MID tie-break among otherwise matching candidates.
- The Sugarcubes - \`Birthday\` remains deliberately ambiguous because two HEOS album/track candidates satisfy the current metadata evidence and neither MID equals official track ID \`34454218\`.
- Public Image Ltd. - \`Rise\` remains unresolved because the current artist traversal exposes no matching HEOS album-title candidate.
- 16 Horsepower - \`Black Soul Choir\` remains unresolved; HEOS exposes album title \`Sackcloth -N- Ashes\` rather than official \`Sackcloth 'N' Ashes\`, and the current resolver has not yet established a unique playable track context.

Production bridge rule: use official TIDAL metadata as the discovery identity, resolve a real HEOS catalogue context, prefer an exact official-track-ID == HEOS-MID match when that context exposes one, and otherwise use validated metadata traversal. Ambiguous results must fail closed rather than selecting a plausible candidate.

Read-only resolver checkpoint sequence:

\`\`\`text
e2b45dd — Add read-only TIDAL HEOS resolution probe
a616299 — Refine read-only TIDAL HEOS resolution probe
2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe
\`\`\`

The next investigation is read-only reverse lookup: start from known TIDAL track IDs / HEOS MIDs, including the unresolved and ambiguous controls, and determine whether HEOS exposes a deterministic way to recover the required playable container/CID. Do not add playback commands until that identifier relationship is understood.

`;

text = text.slice(0, start) + replacement + text.slice(end);
fs.writeFileSync(readmePath, text);
console.log('README bridge section updated successfully.');

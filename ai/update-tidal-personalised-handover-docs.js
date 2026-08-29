'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readmeFile = path.join(root, 'README.md');
const changelogFile = path.join(root, 'CHANGELOG.md');

let readme = fs.readFileSync(readmeFile, 'utf8');
let changelog = fs.readFileSync(changelogFile, 'utf8');

const marker = '<!-- TIDAL_PERSONALISED_HANDOVER_2026_08_29 -->';

const readmeSection = `

${marker}
## TIDAL personalised playback — current handover, 29 Aug 2026

This is the active TIDAL investigation. Do not restart earlier HEOS capability tests or substitute unrelated control tracks. The hard case is **The Sugarcubes - Birthday** from **My Mix 1**.

### Production direction

The intended architecture remains:

\`\`\`text
Official TIDAL API = frontend/catalogue/discovery/metadata
        -> HP resolver/bridge
        -> HEOS = playback transport only
        -> SR8015
\`\`\`

Shorthand: **TIDAL for what you see; HEOS for what you hear.** HEOS browsing should not become the new frontend/catalogue layer again. The generic official-TIDAL queue machinery should eventually underpin Play All, Shuffle All and Play From Here, and later My Music/playlist/collection migration.

### Personalised browse and track actions already proven

Official personalised endpoints and the Pi My Mixes UI are already working. My Mix 1-8, My Daily Discovery and My New Arrivals are visible from the official API. My Mix track Play Now, Play Next, Add to End and Play Only have been proven through the official-ID -> resolver -> HEOS path. Play From Here is intentionally blocked for My Mixes until the generic playlist-tail queue builder exists.

Do **not** re-test whether ordinary TIDAL user playlists are visible through HEOS: this is already proven. The user playlist **Early Alternative** is visible at HEOS CID \`LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84\`.

### Resolved personalised Play All / Shuffle All prototype

The backend currently has \`GET /api/tidal/personalised/playlist/play?id=<id>&shuffle=0|1\`. It pre-resolves every official track before touching the queue, then uses HEOS \`aid=4\` for the first resolved item and \`aid=3\` for the remainder, with generation cancellation.

The first live My Mix 1 Play All test **failed safely after about 52.3 seconds without changing playback**. It stopped at index 31 on The Sugarcubes - Birthday because the resolver correctly returned ambiguity. This exposed two separate problems:

1. Catalogue identity/replacement: the personalised API can expose an older/non-streaming catalogue object while TIDAL's consumer playback uses another playable edition.
2. Performance: pre-resolving an entire playlist through sequential live HEOS album browses is too slow. Even after identity is solved, a roughly 52-second pre-resolution delay is unacceptable.

Do not treat the 52-second result as a software regression. It is the current design limitation being investigated.

### Birthday evidence — preserve these exact identifiers

The My Mix 1 official API item is:

\`\`\`text
The Sugarcubes - Birthday
official track: 34454218
official album: 34454215
artist:         3519103
ISRC:           USEE18800001
duration:       PT4M
availability:   no STREAM field advertised in the probe
\`\`\`

This is a genuine TIDAL object; the 8-digit ID is not a parsing mistake. Its album is Life's Too Good, barcode \`603497981250\`.

HEOS exposes at least two same-title playable album editions:

\`\`\`text
LIBALBUM-341262049 -> Birthday MID 341262056
LIBALBUM-526377759 -> Birthday MID 526377765
\`\`\`

Official probes show both are genuine TIDAL objects and both advertise \`STREAM,DJ\` availability, but they have different ISRCs. Therefore ISRC does not solve this case:

\`\`\`text
341262056 / album 341262049 / ISRC GBBTF9200071 / 3:59 / STREAM,DJ
526377765 / album 526377759 / ISRC ISC108800503 / 3:59 / STREAM,DJ
\`\`\`

The important evidence selecting **341262056 / 341262049** is independent and repeated:

- Playing the exact Birthday item from My Mix 1 in the official Android TIDAL app and using Share produced TIDAL track ID **341262056**.
- Sending that exact My Mix item to the SR8015 through TIDAL Connect made HEOS Now Playing use artwork path \`4fe177f8/64f1/4b2b/8db7/92c43cb3a5fa\`, exactly matching official album **341262049**. TIDAL Connect itself exposed placeholder \`mid=1\` / \`album_id=1\`, so the artwork proves the album edition; the Share result supplies the exact track ID.
- Browsing the user's existing ordinary TIDAL playlist **Early Alternative** through HEOS returned Birthday with **MID 341262056**, **album_id 341262049**, and the same \`4fe177f8...\` artwork.

Therefore three independent consumer/playback observations converge on 341262056/341262049. Do not go back to proving that Early Alternative exists or that Birthday is in it; those facts are established.

A separate read-only queue check during TIDAL Connect showed the pre-existing normal HEOS queue unchanged. TIDAL Connect was a transient station-style playback session and did not replace that stored queue.

### Active replacement investigation

The current hypothesis is that the personalised API stores/returns catalogue object \`34454218\`, while TIDAL consumer playback substitutes a currently streamable equivalent, here \`341262056\`. This is strongly supported by the observations above but must not be promoted to a general resolver rule until the API mechanism is proven.

The next useful question is specifically whether the official TIDAL API exposes the substitution through its media-replacement facilities (for example a \`replacement\` relationship or \`replaceMedia\` behaviour). Do not invent fuzzy tie-breakers such as newest, oldest or arbitrary popularity while this deterministic avenue remains under investigation.

The first guarded migration \`ai/add-tidal-replacement-probe.js\` was committed as \`777e2d8\` but its anchor was too brittle and it **failed safely before modifying \`tidal-user-auth-recon.js\`** with \`Expected probeTrackMetadata anchor exactly once; found 0\`. At that point \`git diff\` was clean.

A later chat then made **uncommitted local reconnaissance edits** to \`tidal-user-auth-recon.js\` adding probes for playlist \`replaceMedia\`, track provenance/providers/owners, and track shares. These edits must be reviewed before commit; do not assume they are accepted production code. The playlist \`replaceMedia\` probe is directly relevant to the active replacement question, while provenance/shares are exploratory and should not distract from the Birthday replacement test.

### Queue design after identity investigation

The likely production direction, not yet implemented, is to avoid blocking playback on full-playlist pre-resolution: resolve/start the first safe playable item promptly with \`aid=4\`, then resolve and append remaining items in the background with \`aid=3\`, retaining generation cancellation and safely skipping unresolved/ambiguous items rather than guessing. This machinery should be generic enough for Play All, Shuffle All and Play From Here.
`;

const changelogSection = `
## 2026-08-29 — Personalised TIDAL playback and Birthday replacement investigation

- Proved the official personalised My Mix UI and per-track resolved playback path on the Pi; Play Now, Play Next, Add to End and Play Only work. Play From Here remains deliberately unavailable for My Mixes pending a generic queue-tail builder.
- Added the first generic resolved personalised playlist Play All/Shuffle All backend path. Its first live My Mix 1 Play All test failed safely after about **52.3 seconds**, before queue mutation, on The Sugarcubes - Birthday at index 31 because the resolver returned a genuine catalogue ambiguity.
- Identified the performance limitation independently of the identity problem: the prototype pre-resolves every track sequentially and the resolver performs live HEOS album browsing even on its direct path. Full-playlist pre-resolution is therefore too slow for production.
- Established the Birthday identity discrepancy precisely. My Mix 1 exposes official track \`34454218\` / album \`34454215\` / ISRC \`USEE18800001\`, while two HEOS-visible Life's Too Good editions contain Birthday as \`341262056\` / album \`341262049\` and \`526377765\` / album \`526377759\`.
- Proved both HEOS candidates are genuine official TIDAL objects with STREAM availability and different ISRCs, so ISRC cannot identify the consumer-selected replacement in this case.
- Obtained three converging pieces of evidence for \`341262056\` / \`341262049\`: the official Android TIDAL Share action on the exact My Mix item returned track \`341262056\`; TIDAL Connect to the SR8015 used the exact artwork of album \`341262049\`; and the user's pre-existing Early Alternative TIDAL playlist appears through HEOS with Birthday MID \`341262056\`, album_id \`341262049\`, and the same artwork.
- TIDAL Connect exposed placeholder \`mid=1\` / \`album_id=1\` and left the normal stored HEOS queue intact, confirming that the Connect session cannot itself be used as a direct MID lookup.
- Current deterministic investigation: test whether official TIDAL media replacement functionality can expose the mapping from stored personalised object \`34454218\` to the consumer-playable object. Do not fall back to arbitrary fuzzy/newest/oldest selection without evidence.
- Guarded replacement-probe migration commit \`777e2d8\` failed safely because its source anchor matched zero times; it made no runtime-file change. Subsequent uncommitted local reconnaissance added \`replaceMedia\`, provenance and shares probes to \`tidal-user-auth-recon.js\`; review those edits before committing them.
- Do not repeat established HEOS playlist discovery. Early Alternative is already proven at \`LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84\` and contains Birthday as MID \`341262056\` / album \`341262049\`.

`;

if (!readme.includes(marker)) {
  readme += readmeSection;
}

if (!changelog.includes('## 2026-08-29 — Personalised TIDAL playback and Birthday replacement investigation')) {
  const heading = '# Changelog\n';
  if (!changelog.startsWith(heading)) {
    throw new Error('Unexpected CHANGELOG.md heading');
  }
  changelog = heading + '\n' + changelogSection + changelog.slice(heading.length).replace(/^\n/, '');
}

fs.writeFileSync(readmeFile, readme);
fs.writeFileSync(changelogFile, changelog);
console.log('Updated README.md and CHANGELOG.md with 29 Aug personalised TIDAL handover.');

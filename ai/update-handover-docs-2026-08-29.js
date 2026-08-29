'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readmePath = path.join(root, 'README.md');
const changelogPath = path.join(root, 'CHANGELOG.md');
const handoverPath = path.join(root, 'CURRENT_HANDOVER.md');
const marker = '<!-- TIDAL_BIRTHDAY_HANDOVER_2026_08_29 -->';

let readme = fs.readFileSync(readmePath, 'utf8');
let changelog = fs.readFileSync(changelogPath, 'utf8');

const readmeAnchor = '# marantz-backend\n\n';
if (!readme.includes(readmeAnchor)) throw new Error('README title anchor not found');
if (!readme.includes(marker)) {
  const section = `${marker}\n## Active handover — 29 Aug 2026\n\nBefore further TIDAL/HEOS reconnaissance, read [CURRENT_HANDOVER.md](CURRENT_HANDOVER.md). It records the active personalised-playlist Play All investigation, the proven Sugarcubes **Birthday** catalogue-replacement evidence, tests that must not be repeated, and the separate 52-second queue-resolution performance problem.\n\nCritical current rule: the active hard case is **The Sugarcubes — Birthday**, official personalised track \`34454218\`, with strong consumer/HEOS evidence selecting playable track \`341262056\` / album \`341262049\`. The user's **Early Alternative** playlist has already been browsed through HEOS and already proves that exact MID/album/artwork combination. Do not re-test whether that playlist exists or is HEOS-visible. Interpol was a previous search/control artist and is not the active replacement case.\n\nCurrent architecture remains: **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not regress new frontend/catalogue work back to HEOS browsing.\n\n`;
  readme = readme.replace(readmeAnchor, readmeAnchor + section);
}

const changelogAnchor = '# Changelog\n\n';
if (!changelog.includes(changelogAnchor)) throw new Error('CHANGELOG title anchor not found');
if (!changelog.includes(marker)) {
  const section = `${marker}\n## 2026-08-29 — Personalised queue hard case and TIDAL replacement investigation\n\n- Added production personalised playlist playback at \`a30db56\`: official playlist tracks are resolved to HEOS context before queue mutation, first successful item uses \`aid=4\`, later items use \`aid=3\`, and ambiguity fails closed.\n- Live My Mix 1 Play All exposed two distinct issues. Full pre-resolution took about **52.326 seconds**, which is not acceptable for production UX, and the build failed safely at index 31 on The Sugarcubes — **Birthday** without changing playback.\n- The developer API My Mix object is track \`34454218\`, album \`34454215\`, artist \`3519103\`, ISRC \`USEE18800001\`, duration \`PT4M\`. Direct official probing proved it is a genuine TIDAL resource but the observed response did not advertise STREAM availability.\n- HEOS exposes two playable same-title/same-album candidates: \`341262056\` / album \`341262049\` and \`526377765\` / album \`526377759\`. Both are genuine official resources with STREAM availability but different ISRC/licensing metadata, proving ISRC cannot be used as a universal equivalence key.\n- The official Android TIDAL app's Share action on the exact My Mix Birthday item returned track **341262056**. Sending the same item through TIDAL Connect produced album artwork exactly matching official album **341262049**. Connect itself reports placeholder \`mid=1\` / \`album_id=1\`, so Share supplies the exact track identity while Connect independently confirms the selected album edition.\n- Independently browsed the user's existing **Early Alternative** playlist through HEOS. Birthday is already present there as MID **341262056**, album_id **341262049**, with the same artwork. This closes the question of whether the playlist is HEOS-visible and which edition it contains; do not repeat that reconnaissance.\n- TIDAL Connect queue inspection showed the Connect session is transient/station-style and did not replace the existing normal HEOS queue.\n- The active investigation is now whether official TIDAL APIs expose a deterministic replacement/media-substitution mapping from personalised object \`34454218\` to playable object \`341262056\`. Prefer TIDAL's own replacement semantics if accessible; do not choose among editions by arbitrary fuzzy tie-breakers.\n- The first guarded replacement-probe migration failed safely because its exact anchor did not match and wrote nothing. Subsequent 29 Aug commits added read-only replacement/replaceMedia/metadata/provenance/shares reconnaissance helpers. Inspect their live results before creating further probes.\n- Queue latency remains a separate problem even if replacement identity is solved: the reusable resolver performs live HEOS browsing on many tracks, so whole-playlist pre-resolution can take tens of seconds. Future generic Play All/Shuffle All/Play From Here machinery should start a safely resolved first item promptly and continue building in the background while retaining cancellation/fail-safe behaviour.\n- Added \`CURRENT_HANDOVER.md\` as the short authoritative continuation document so a new chat does not restart closed investigations.\n\n`;
  changelog = changelog.replace(changelogAnchor, changelogAnchor + section);
}

fs.writeFileSync(readmePath, readme);
fs.writeFileSync(changelogPath, changelog);
console.log('Updated README.md and CHANGELOG.md with current TIDAL handover.');

const fs = require('fs');
const crypto = require('crypto');

const README = 'README.md';
const CHANGELOG = 'CHANGELOG.md';
const EXPECTED = {
  [README]: 'db7855fd3af2f409ef5f12d4d50783857839a7d0',
  [CHANGELOG]: '9eae84cd6f507c83b42b79858118fb229488b51d'
};

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  return crypto.createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}
function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Expected exactly one ${label}`);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

let readme = fs.readFileSync(README, 'utf8');
let changelog = fs.readFileSync(CHANGELOG, 'utf8');
for (const [file, expected] of Object.entries(EXPECTED)) {
  const text = file === README ? readme : changelog;
  const actual = gitBlobSha(text);
  if (actual !== expected) throw new Error(`${file} guard failed: expected ${expected}, got ${actual}`);
}

const readmeAnchor = '## 2026-09-01 — Lightweight personalised TIDAL artwork checkpoint\n';
const readmeSection = `## 2026-09-13 — Official Favourite Tracks catalogue and rolling playback checkpoint\n\n- The backend now treats official TIDAL user-library relationships as the catalogue/display authority for Favourite Tracks. \`GET /api/tidal/favourite-tracks\` exposes the canonical **594 live tracks** with official artwork, title, artist, album and IDs; stale official relationships are omitted.\n- Reconciliation proved the official 594-track set/order matches the de-duplicated live HEOS My Music-Tracks representation after removing 41 stale/duplicate rows. Official IDs can therefore be used directly as HEOS MIDs for this validated collection.\n- Full Favourite Tracks playback uses the accepted rolling queue architecture: initial 10 tracks, replenish 5 when fewer than 5 remain ahead, persistent HEOS event handling, debounced qid/count reconciliation, bounded tail verification, fail-closed external-queue divergence and generation supersession.\n- PLAY ALL follows canonical saved order. SHUFFLE ALL shuffles the canonical 594-track order once in the backend and keeps HEOS shuffle disabled. PLAY FROM HERE rolls the canonical tail beginning at the selected official track.\n- Ordinary Favourite Tracks actions PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY continue through HEOS \`browse/add_to_queue\`. Live testing proved HEOS requires the literal-space CID \`My Music-Tracks\`; sending \`My%20Music-Tracks\` causes \`eid=14&text=cannot play\`. Preserve the literal-space conversion for this container.\n- End-to-end Pi acceptance passed all seven actions: PLAY FROM HERE, PLAY ALL, SHUFFLE ALL, PLAY ONLY, ADD END, PLAY NEXT and PLAY NOW.\n- The companion Pi now renders the complete 594-track collection as one continuous rich official-TIDAL list with no HEOS pager. HEOS remains playback transport.\n\nCurrent tested backend source checkpoint:\n\n\`\`\`text\n08a86ce — Fix Favourite Tracks ordinary actions\n\`\`\`\n\nCurrent backend cleanup checkpoint:\n\n\`\`\`text\n9ba3b6f — Remove Favourite Tracks action fix helper\n\`\`\`\n\nCompanion Pi documentation/cleanup checkpoint:\n\n\`\`\`text\nbe2d52f — Remove Favourite Tracks documentation helpers\n\`\`\`\n\nNext TIDAL UI migration target: move My Music Artists, Albums and Playlists from the older HEOS browse-led display path to fast/rich official TIDAL catalogue data where deterministic playback identity can be preserved.\n\n`;
if (!readme.includes(readmeAnchor)) throw new Error('README insertion anchor missing');
readme = readme.replace(readmeAnchor, readmeSection + readmeAnchor);

const oldFavouriteIntro = '`My Music-Tracks` is treated as one full saved-track collection rather than a 50-track page for playback purposes. The live collection had grown to **634 favourite tracks** by the 28 Aug cancellation test.\n';
const newFavouriteIntro = '`My Music-Tracks` is treated as one full saved-track collection rather than a 50-track page. The current accepted architecture uses **594 canonical live official TIDAL Favourite Tracks** for display and rolling playback. The older 634-track/full-queue-builder notes below describe the 28 Aug development history and are retained as historical context; they are not the current production queue architecture.\n';
readme = replaceOnce(readme, oldFavouriteIntro, newFavouriteIntro, 'Favourite Tracks historical intro');

const changelogAnchor = '## 2026-09-04 — AVR TCP/23 recurrence isolated to AVR recovery\n';
const changelogSection = `## 2026-09-13 — Official TIDAL Favourite Tracks display and rolling playback accepted\n\n- Completed the Favourite Tracks hybrid architecture: official TIDAL is catalogue/display authority and HEOS remains playback transport. \`GET /api/tidal/favourite-tracks\` returns the canonical 594 live tracks with rich official metadata and artwork.\n- Reconciliation established that the 594 live official IDs match the de-duplicated HEOS My Music-Tracks IDs and order after stale/duplicate removal, allowing the validated official IDs to be used directly as HEOS MIDs for this collection.\n- Accepted rolling PLAY ALL / SHUFFLE ALL / PLAY FROM HERE instead of building all 594 HEOS queue rows at once: initial 10, low-water fewer than 5 ahead, replenish 5, persistent HEOS events, debounced qid/count reconciliation, bounded tail verification, fail-closed divergence and generation supersession.\n- Fixed ordinary Favourite Tracks actions by preserving HEOS's required literal-space \`My Music-Tracks\` CID rather than passing \`My%20Music-Tracks\`. Before the fix HEOS returned \`eid=14&text=cannot play\`; after it, PLAY ONLY, ADD END, PLAY NEXT and PLAY NOW all passed live acceptance.\n- End-to-end Pi acceptance also passed PLAY FROM HERE, PLAY ALL and SHUFFLE ALL, giving all seven Favourite Tracks actions a live tested checkpoint.\n- Companion Pi migration replaced the old Tracks pager with one continuous 594-track official-TIDAL list showing artwork, title, artist and album while retaining the existing action menu and playback routes.\n- Temporary migration/action/documentation helpers were removed after verification.\n\nBackend production/checkpoint sequence:\n\n\`\`\`text\n4d6da8c — Use rolling Favourite Tracks queue\nabdf6ba — Remove Favourite Tracks rolling migration helpers\n08a86ce — Fix Favourite Tracks ordinary actions\n9ba3b6f — Remove Favourite Tracks action fix helper\n\`\`\`\n\nCompanion Pi production/documentation checkpoints:\n\n\`\`\`text\n27be5d1 — Use official TIDAL Favourite Tracks UI\nbe2d52f — Remove Favourite Tracks documentation helpers\n\`\`\`\n\nNext migration target is My Music Artists, Albums and Playlists: prefer official TIDAL for fast/rich catalogue display while retaining deterministic HEOS playback where required.\n\n`;
if (!changelog.includes(changelogAnchor)) throw new Error('CHANGELOG insertion anchor missing');
changelog = changelog.replace(changelogAnchor, changelogSection + changelogAnchor);

fs.writeFileSync(README, readme);
fs.writeFileSync(CHANGELOG, changelog);
console.log(`README.md: ${gitBlobSha(readme)}`);
console.log(`CHANGELOG.md: ${gitBlobSha(changelog)}`);
console.log('Favourite Tracks backend documentation update applied.');

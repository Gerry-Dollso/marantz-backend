const fs = require('fs');

function prependAfterTitle(path, title, section) {
  const s = fs.readFileSync(path, 'utf8');
  if (s.includes('## 2026-09-15 — Now Playing TIDAL favourite heart')) return;
  if (!s.startsWith(title + '\n')) throw new Error(`${path}: title guard failed`);
  fs.writeFileSync(path, title + '\n\n' + section.trim() + '\n\n' + s.slice(title.length + 2));
}

const section = `## 2026-09-15 — Now Playing TIDAL favourite heart

Task 2 of the post-catalogue UI/control phase is production-accepted. The Pi Now Playing screen now shows a TIDAL favourite heart for a safely identified official TIDAL track and can add/remove that exact track through the HP backend and official TIDAL user-collection API. HEOS is not used to reconcile favourite membership or perform favourite writes.

Identity is deliberately split at the playback boundary. The Pi preserves a known official TIDAL track ID as \`tidalTrackId\` when playback was launched from our official-TIDAL UI and associates it with the resulting HEOS MID. If no preserved official ID exists, a live TIDAL HEOS MID may only be treated as a candidate: the HP validates exact official track metadata before membership/write use and fails closed if validation fails. This preserves the Sugarcubes/Birthday lesson: official personalised ID \`34454218\` and HEOS replacement MID \`341262056\` are different identities and must not be conflated.

Backend endpoints are \`GET /api/tidal/favourite-track-status?id=...\`, \`POST /api/tidal/favourite-track?id=...\` and \`DELETE /api/tidal/favourite-track?id=...\`. Mutations use the official \`userCollectionTracks\` relationship, OAuth \`collection.write\`, JSON:API payloads and a fresh idempotency key. Successful writes invalidate the canonical Favourite Tracks cache and playback-validation cache. The active rolling Favourite Tracks queue/session is not rewritten by a heart change; future collection use sees the refreshed canonical library.

The original synchronous post-write full Favourite Tracks rebuild made a heart write take about 34–35 seconds. Production commit \`124fb49 — Remove favourite heart synchronous collection rebuild\` removed that rebuild from the mutation response; controlled Aquarius tests reduced add/remove to roughly 0.28–0.37 seconds. A recent-mutation single-track status overlay then reduced the immediate post-write status check from about 34.7 seconds to about 0.20–0.21 seconds while leaving the full canonical collection path untouched. The overlay is checked only after exact official metadata validation and expires after two minutes so it cannot indefinitely mask a later external TIDAL change.

Controlled Aquarius (Boards of Canada, official ID \`16024568\`) acceptance passed both directions and restored the original not-favourite state. Add returned HTTP 200 in 0.282 s and immediate status returned favourite=true/recentMutation=true in 0.214 s. Remove returned HTTP 200 in 0.372 s and immediate status returned favourite=false/recentMutation=true in 0.202 s. A temporary TIDAL HTTP 429 during startup/prewarm was allowed to cool down rather than being hammered; subsequent requests recovered normally.

Backend checkpoints:

\`\`\`text
43a3551 — Add official TIDAL favourite track mutations
124fb49 — Remove favourite heart synchronous collection rebuild
f051e2a — Add fast favourite track status overlay
6c7e2fe — Expire recent favourite status overlay
\`\`\`

Companion Pi production checkpoint: \`4e7743e — Add TIDAL favourite heart to Now Playing\`. See \`docs/TIDAL_FAVOURITE_HEART_2026-09-15.md\` for the detailed handover and acceptance record.
`;

prependAfterTitle('README.md', '# marantz-backend', section);
prependAfterTitle('CHANGELOG.md', '# Changelog', section);

let h = fs.readFileSync('CURRENT_HANDOVER.md', 'utf8');
if (!h.includes('## Now Playing TIDAL favourite heart — production accepted 15 Sep 2026')) {
  const marker = '## Immediate next-chat work — agreed order';
  const i = h.indexOf(marker);
  if (i < 0) throw new Error('CURRENT_HANDOVER.md marker guard failed');
  const handover = `## Now Playing TIDAL favourite heart — production accepted 15 Sep 2026\n\nTask 2 is complete. The Pi production checkpoint is \`4e7743e\`; backend production is pushed through \`6c7e2fe\`. The heart uses official TIDAL collection membership/writes only. Preserve known official \`tidalTrackId\` across our own TIDAL playback launch; otherwise treat HEOS \`tidalMid\` only as a candidate and require exact official metadata validation. Never use HEOS to reconcile favourite membership.\n\nThe write path no longer waits for the ~35 s canonical Favourite Tracks rebuild. Successful official mutation invalidates the canonical cache and records a two-minute single-track recent-mutation overlay. Status validates the official track first, then may answer from that overlay; expired entries fall through to the canonical collection. Full Favourite Tracks endpoints and rolling playback remain canonical and are not patched by the overlay. Controlled Aquarius add/remove tests passed at ~0.3 s writes and ~0.2 s immediate status checks, and Aquarius was restored to not-favourite.\n\nPi UI acceptance: heart is in the Now Playing progress area at right, \`bottom:48px\`; one SVG geometry is used for both states; non-favourite is grey outline \`rgba(255,255,255,0.45)\`; favourite is solid/stroked \`#ff3b3b\`. Heart sync is driven by the existing \`render(data)\` status cycle with no second \`/api/status\` poller.\n\n`;
  h = h.slice(0, i) + handover + h.slice(i);
}
const oldNext = `Current Queue is complete. Continue in this order, using GitHub for repository inspection and Termius only for runtime evidence/deployment checks that GitHub cannot provide. Do not begin production changes before the relevant read-only contract is understood.\n\n1. **Now Playing favourite heart:** show whether the current canonical TIDAL track is in the user's collection and allow add/remove only after a read-only membership path and official mutation contract are proven. Never assume the currently playing HEOS MID is always the canonical official TIDAL ID: personalised/replacement cases such as The Sugarcubes — Birthday prove those identities can differ. Recon must be read-only and must never add/remove a real favourite. If mutation is later accepted, refresh/invalidate the relevant Favourite Tracks cache only after confirmed success.\n\n2. **TIDAL landing/home artwork:**`;
const newNext = `Current Queue and the Now Playing favourite heart are complete. Resume with **Task 3** next; do not reopen either completed task without new evidence. Use GitHub for repository inspection and Termius only for runtime evidence/deployment checks that GitHub cannot provide.\n\n1. **TIDAL landing/home artwork:**`;
if (h.includes(oldNext)) h = h.replace(oldNext, newNext);
h = h.replace('3. **Richer artist page:**', '2. **Richer artist page:**');
fs.writeFileSync('CURRENT_HANDOVER.md', h);
console.log('Updated backend README, CHANGELOG and CURRENT_HANDOVER for accepted Task 2');

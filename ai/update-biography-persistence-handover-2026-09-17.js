'use strict';

const fs = require('fs');

const files = ['README.md', 'CHANGELOG.md', 'CURRENT_HANDOVER.md'];

const oldBlock = `### Persistent caches and known caveat

Existing persistent roots remain \`/var/lib/marantz-backend/artwork\`, \`/var/lib/marantz-backend/artist-details\`, plus new \`/var/lib/marantz-backend/artist-top-tracks\`. Artwork list performance was fixed by batching touch-index writes; accepted timings were about **0.0189 s for Artists** and **0.0466 s for Albums**. The Pi binary artwork proxy regression was also fixed and touchscreen-confirmed for both lists.

**Biography persistence is still outstanding.** The lazy biography resolver currently has a 7-day RAM cache, but there is not yet a dedicated persistent biography disk store. Newly refreshed core Artist Details records contain \`biography:null\`. The agreed next backend cleanup is to persist biography separately (prefer the existing store pattern, e.g. \`/var/lib/marantz-backend/artist-biographies/<artistId>.json\`, atomic writes, stale handling) before calling the Artist architecture complete. Do not falsely claim biography persistence is already preserved.`;

const newBlock = `### Persistent caches — backend architecture accepted

Persistent roots are now \`/var/lib/marantz-backend/artwork\`, \`/var/lib/marantz-backend/artist-details\`, \`/var/lib/marantz-backend/artist-top-tracks\` and \`/var/lib/marantz-backend/artist-biographies\`. Artwork list performance was fixed by batching touch-index writes; accepted timings were about **0.0189 s for Artists** and **0.0466 s for Albums**. The Pi binary artwork proxy regression was also fixed and touchscreen-confirmed for both lists.

Biography is now lazy **and persistently cached**. \`tidal-artist-biography-store.js\` stores one versioned JSON record per numeric Artist ID under \`/var/lib/marantz-backend/artist-biographies/<artistId>.json\`, using atomic temp-file/rename writes, **7-day freshness** and a **30-day maximum stale window**. The existing RAM cache and in-flight de-duplication remain. Fresh disk values survive a complete backend restart; stale-but-usable biographies return immediately while one background refresh replaces the record. Null biography results can also be persisted so repeatedly unresolved artists do not continually repeat expensive external lookups. The MusicBrainz -> Wikidata -> Wikipedia resolution logic itself was not changed.

Runtime acceptance used **TRICKY, TIDAL ID 27444**. A forced cold biography refresh took **6.642 s** and wrote a version-1 persistent record with a Wikipedia biography. After a complete \`marantz-backend.service\` restart, the normal biography request took **0.015 s**, proving disk persistence. The record was then deliberately aged to 8 days old, the backend restarted to clear RAM, and the stale request returned in **0.016 s**. Background refresh subsequently replaced the deliberately old \`2026-09-09T15:44:19.297Z\` timestamp with fresh \`2026-09-17T15:47:07.667Z\`, with the Wikipedia biography intact. This proves restart persistence and stale-while-refresh end to end.

Biography persistence production checkpoints: \`6103aa3 — Add persistent Artist biography store\` and \`aa8f276 — Persist Artist biographies across restarts\`. Both touched JavaScript files passed \`node --check\` and \`git diff --check\`; runtime acceptance passed as above. At the completion of this test, local HEAD and \`origin/local-ai-development\` both reported \`aa8f276\` with a blank working-tree status. The remaining Artist phase work is now the Pi UI/full-list redesign and real 8-inch touchscreen acceptance, not further biography persistence.`;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(oldBlock)) throw new Error(file + ': expected biography caveat block not found');
  fs.writeFileSync(file, text.replace(oldBlock, newBlock));
}

console.log('Updated README.md, CHANGELOG.md and CURRENT_HANDOVER.md with accepted biography persistence');

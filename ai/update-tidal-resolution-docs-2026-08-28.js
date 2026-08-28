'use strict';

// Guarded documentation migration for the 28 Aug TIDAL -> HEOS resolver findings.
// Edits README.md and CHANGELOG.md only. No runtime/backend code is touched.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readmePath = path.join(root, 'README.md');
const changelogPath = path.join(root, 'CHANGELOG.md');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Guard failed: ${label} anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Guard failed: ${label} anchor is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let readme = fs.readFileSync(readmePath, 'utf8');
readme = replaceOnce(
  readme,
  `Current tested functional checkpoint:\n\n\`\`\`text\n2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe\n\`\`\``,
  `Current tested functional checkpoint:\n\n\`\`\`text\ncbcd4ac — Fix HEOS album N-separator normalization\n\`\`\``,
  'README checkpoint'
);
readme = replaceOnce(
  readme,
  `- The Sugarcubes - \`Birthday\` remains deliberately ambiguous because two HEOS album/track candidates satisfy the current metadata evidence and neither MID equals official track ID \`34454218\`.\n- Public Image Ltd. - \`Rise\` remains unresolved because the current artist traversal exposes no matching HEOS album-title candidate.\n- 16 Horsepower - \`Black Soul Choir\` remains unresolved; HEOS exposes album title \`Sackcloth -N- Ashes\` rather than official \`Sackcloth 'N' Ashes\`, and the current resolver has not yet established a unique playable track context.`,
  `- In the original fixed 26-track sample, The Sugarcubes - \`Birthday\` remained deliberately ambiguous because two HEOS album/track candidates satisfied the available metadata evidence and neither MID equalled official track ID \`34454218\`. Public Image Ltd. - \`Rise\` remained unresolved because that sample's artist traversal exposed no matching HEOS album-title candidate. Preserve these as useful hard edge cases rather than rewriting the historical result.\n- 16 Horsepower - \`Black Soul Choir\` was subsequently diagnosed precisely: official track \`35888116\` / album \`35888114\` maps to HEOS \`LIBALBUM-635299\` / MID \`635301\`. The failure was a general album-normalization bug: \`Sackcloth 'N' Ashes\` retained quote characters while HEOS \`Sackcloth -N- Ashes\` did not. Commit \`cbcd4ac\` normalizes quote-delimited \`'N'\` as the same album separator as \`-N-\`/\`N\`; it is not a 16 Horsepower special case.\n- After that fix, a fresh personalized 26-track sample resolved **26/26, with 0 ambiguous, 0 unresolved and 0 errors**. TIDAL had refreshed the personalized mixes, so this is a second sample rather than evidence that the one-line fix alone transformed the original 23/26 sample into 26/26. In the fresh sample, 23 tracks resolved through \`direct-album-id+official-mid\`; April Skies, Screen Shot and Black Soul Choir resolved through structured \`artist-album-track\` traversal.\n- Read-only reverse-context reconnaissance also established that HEOS Track search (\`scid=3\`) is human-text search rather than numeric MID lookup. Browsing both bare \`SEARCHED_TRACKS-\` and the plausible \`SEARCHED_TRACKS-Rise\` form returned the normal four-item TIDAL root, not a search-results container. Treat that reverse-CID avenue as closed; do not invent further synthetic CID variants.`,
  'README edge cases'
);
readme = replaceOnce(
  readme,
  `e2b45dd — Add read-only TIDAL HEOS resolution probe\na616299 — Refine read-only TIDAL HEOS resolution probe\n2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe`,
  `e2b45dd — Add read-only TIDAL HEOS resolution probe\na616299 — Refine read-only TIDAL HEOS resolution probe\n2ce9132 — Use deterministic TIDAL ID matching in HEOS resolver probe\ne48613e — Add read-only HEOS reverse context probe\n0817a62 — Add guarded HEOS album separator normalization migration\ncbcd4ac — Fix HEOS album N-separator normalization`,
  'README checkpoint sequence'
);
readme = replaceOnce(
  readme,
  `The next investigation is read-only reverse lookup: start from known TIDAL track IDs / HEOS MIDs, including the unresolved and ambiguous controls, and determine whether HEOS exposes a deterministic way to recover the required playable container/CID. Do not add playback commands until that identifier relationship is understood.`,
  `The simple reverse-context avenue is now closed: HEOS text search does not accept numeric MID as an identifier lookup, and the advertised \`SEARCHED_TRACKS-\` prefix did not expose a browsable results CID. Continue improving the structured resolver from proven catalogue evidence; keep ambiguity fail-closed and do not invent undocumented CID forms.`,
  'README next investigation'
);

let changelog = fs.readFileSync(changelogPath, 'utf8');
const changelogAnchor = `## 2026-08-28 — Persistent TIDAL user authorization and deterministic HEOS resolution\n`;
const changelogInsert = `## 2026-08-28 — HEOS resolver normalization and second-sample validation\n\n- Diagnosed the remaining 16 Horsepower failure against the real HEOS album container. Official TIDAL track \`35888116\` / album \`35888114\` (\`Sackcloth 'N' Ashes\`) maps to HEOS \`LIBALBUM-635299\` / MID \`635301\` (\`Sackcloth -N- Ashes\`).\n- Proved the resolver bug was general album normalization, not missing catalogue content: apostrophes survived the common normalizer, so \`'N'\` and \`-N-\` never converged. Added quote-delimited N-separator normalization in \`cbcd4ac\`; no artist-specific exception was added.\n- Re-ran the read-only resolver after the fix against the then-current personalized recommendations. TIDAL had refreshed the mixes, so this was a new 26-track sample rather than the original fixed sample. Result: **26/26 resolved, 0 ambiguous, 0 unresolved, 0 errors**.\n- In the fresh sample, 23/26 resolved through \`direct-album-id+official-mid\`; April Skies, Screen Shot and Black Soul Choir resolved through structured \`artist-album-track\` traversal.\n- Preserve the earlier 23/26, 1 ambiguous, 2 unresolved result as a separate hard edge-case checkpoint. Do not claim that the one-line normalization change alone converted that exact sample to 26/26. Birthday and Rise remain valuable historical edge cases from that original sample.\n- Closed the simple HEOS reverse-context experiment. Track search \`scid=3\` behaves as human-text search, not numeric MID lookup; numeric-ID searches produced no exact MID hits even for known-good controls. Browsing both \`SEARCHED_TRACKS-\` and \`SEARCHED_TRACKS-Rise\` returned the normal TIDAL root rather than a search-results container. Do not spend further time inventing synthetic \`SEARCHED_TRACKS-*\` CIDs.\n\nCurrent tested resolver checkpoint:\n\n\`\`\`text\ncbcd4ac — Fix HEOS album N-separator normalization\n\`\`\`\n\nCheckpoint additions:\n\n\`\`\`text\ne48613e — Add read-only HEOS reverse context probe\n0817a62 — Add guarded HEOS album separator normalization migration\ncbcd4ac — Fix HEOS album N-separator normalization\n\`\`\`\n\n`;
if (!changelog.includes(changelogInsert)) {
  const pos = changelog.indexOf(changelogAnchor);
  if (pos < 0) throw new Error('Guard failed: CHANGELOG section anchor not found');
  changelog = changelog.slice(0, pos) + changelogInsert + changelog.slice(pos);
}

fs.writeFileSync(readmePath, readme);
fs.writeFileSync(changelogPath, changelog);
console.log('Updated README.md and CHANGELOG.md only.');
console.log('No runtime/backend code touched.');

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(filePath, before, after) {
  const current = fs.readFileSync(filePath, 'utf8');
  const count = current.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${filePath}: expected anchor exactly once, found ${count}`);
  }
  fs.writeFileSync(filePath, current.replace(before, after));
}

const root = path.resolve(__dirname, '..');
const readme = path.join(root, 'README.md');
const changelog = path.join(root, 'CHANGELOG.md');

replaceOnce(
  readme,
  `Important boundary: official API numeric track IDs have **not yet been proven to interoperate with HEOS playback**. Do not claim the hybrid architecture is playback-complete until a controlled API-ID -> HEOS test succeeds. Such a test changes current playback and must be announced before execution.`,
  `### Official API -> HEOS playback bridge — proven live\n\nThe end-to-end bridge from an official personalized recommendation to real SR8015 playback is now proven, but **numeric API IDs must not be assumed to equal HEOS catalogue IDs**.\n\nLive Daily Discovery proof used Phantogram - \`When I'm Small\`:\n\n\`\`\`text\nOfficial API track id: 111442201\nOfficial API album id: 111442199 (Eyelid Movies)\nOfficial API artist id: 3614038 (Phantogram)\n\nHEOS artist cid: LIBARTIST-3614038\nHEOS album cid:  LIBALBUM-111438012 (Eyelid Movies)\nHEOS track mid:   111438014 (When I'm Small)\n\`\`\`\n\nA direct constructed browse of \`LIBALBUM-111442199\` returned an empty container, proving that official album IDs cannot be blindly converted to HEOS album CIDs. Following the real HEOS artist hierarchy instead found \`LIBALBUM-111438012\`; browsing that container exposed the matching title with MID \`111438014\`.\n\nThe resolved HEOS context was then tested with \`browse/add_to_queue\`: \`aid=3\` successfully appended the track and queue inspection confirmed Phantogram - When I'm Small at qid 51; \`aid=1\` then successfully started playback on the SR8015.\n\nProduction bridge rule: use official API metadata for discovery, then resolve into a real HEOS catalogue context by metadata/relationships and use the HEOS-returned CID + MID for playback. Artist IDs may coincide across APIs (Phantogram did), but this is not a safe universal assumption; album and track IDs demonstrably differed for this release.\n\nParameterized reconnaissance endpoint used for this proof:\n\n\`\`\`text\nGET /api/tidal/oauth/probe-track?id=<numeric-track-id>\n\`\`\`\n\nRuntime checkpoint:\n\n\`\`\`text\n153bc83 — Add parameterized TIDAL track metadata probe\n\`\`\``
);

replaceOnce(
  changelog,
  `- Current architecture direction: official TIDAL API for browsing/discovery/metadata, HEOS/SR8015 for playback. The remaining critical proof is whether an official-API numeric track ID can be handed to the existing HEOS playback path; this has not yet been tested and must not be assumed.`,
  `- Current architecture direction is now proven end-to-end: official TIDAL API for browsing/discovery/metadata, HEOS/SR8015 for playback. The bridge requires metadata-based HEOS catalogue resolution rather than direct numeric-ID translation.\n- Live Daily Discovery proof used Phantogram - When I'm Small. Official API returned track \`111442201\`, album \`111442199\` (Eyelid Movies), artist \`3614038\`. HEOS independently returned artist \`LIBARTIST-3614038\`, but its matching Eyelid Movies release was \`LIBALBUM-111438012\` and the matching track MID was \`111438014\`.\n- Constructing \`LIBALBUM-111442199\` directly from the API album ID returned an empty HEOS container, so API album/track IDs must not be assumed to equal HEOS IDs.\n- Following the real HEOS artist -> Albums hierarchy found the matching release and title. \`browse/add_to_queue\` with the HEOS-returned CID/MID succeeded with \`aid=3\`; queue inspection confirmed When I'm Small at qid 51. A subsequent \`aid=1\` test successfully started the track on the SR8015.\n- Production rule: resolve official API metadata into a real HEOS catalogue context, then use HEOS-returned CID + MID for queue/playback. Numeric identity can coincide (the Phantogram artist ID did) but must be treated as an optimization/verification signal, not as a universal mapping.`
);

replaceOnce(
  changelog,
  `Runtime search-recon checkpoint:\n\n\`\`\`text\n050da79 — Add TIDAL search reconnaissance\n\`\`\``,
  `Runtime reconnaissance checkpoints:\n\n\`\`\`text\n050da79 — Add TIDAL search reconnaissance\n153bc83 — Add parameterized TIDAL track metadata probe\n\`\`\``
);

console.log('Updated README.md and CHANGELOG.md with the proven TIDAL API -> HEOS playback bridge.');

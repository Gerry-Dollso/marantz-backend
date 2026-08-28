'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readmePath = path.join(root, 'README.md');
const changelogPath = path.join(root, 'CHANGELOG.md');
let readme = fs.readFileSync(readmePath, 'utf8');
let changelog = fs.readFileSync(changelogPath, 'utf8');

const readmeAnchor = '## Rich TIDAL browsing direction\n';
const readmeSection = `## Official TIDAL API reconnaissance — 28 Aug 2026\n\nUser OAuth Authorization Code + PKCE is proven live with read-only scopes \`recommendations.read\`, \`user.read\`, \`collection.read\` and \`search.read\`. The reconnaissance session is deliberately RAM-only; access/refresh tokens are never written to Git or disk. A backend restart clears the temporary user session and requires re-authorization.\n\nLive official-API results support a hybrid architecture in which TIDAL OpenAPI supplies fast browsing/discovery/metadata while HEOS/SR8015 remains the playback engine:\n\n- Personal recommendations are proven: My Mix 1-8, My Daily Discovery and My New Arrivals resolve to real playlist resources and numeric TIDAL track IDs.\n- Artist radio is proven from artist relationship to playlist contents.\n- Full user collections are proven through relationship pagination: 393 saved artists, 1,535 saved albums and 634 saved tracks at the test checkpoint. The 634 saved-track count independently matches the HEOS Favourite Tracks collection.\n- Collection page fetches were generally about 120-160 ms before deliberate rate-limit pacing; official API browsing is therefore suitable for first-page render plus background collection fill/cache rather than waiting on multi-second HEOS cold browse.\n- Rich metadata is proven: artist profile artwork, album artwork/artist metadata, and track -> artist + album -> cover art can be resolved through official relationships.\n- Search reconnaissance is implemented and correctly requests \`search.read\`, but this developer app currently receives \`400 Invalid resource ID\` for both normal and documented-control queries on root and relationship search forms. One burst also produced a 429. Treat official search as unavailable/access-blocked for this app unless TIDAL enables catalogue-search access; do not enable \`search.write\` merely to work around it.\n\nSearch checkpoint:\n\n\`\`\`text\n050da79 — Add TIDAL search reconnaissance\n\`\`\`\n\nImportant boundary: official API numeric track IDs have **not yet been proven to interoperate with HEOS playback**. Do not claim the hybrid architecture is playback-complete until a controlled API-ID -> HEOS test succeeds. Such a test changes current playback and must be announced before execution.\n\n`;

if (!readme.includes(readmeAnchor)) throw new Error('README guard failed: anchor not found');
if (readme.includes('## Official TIDAL API reconnaissance — 28 Aug 2026')) throw new Error('README guard failed: section already present');
readme = readme.replace(readmeAnchor, readmeSection + readmeAnchor);

const changelogAnchor = '## 2026-08-28 — TIDAL Favourite Tracks lifecycle cancellation\n';
const changelogSection = `## 2026-08-28 — Official TIDAL API reconnaissance\n\n- Proved temporary user OAuth Authorization Code + PKCE with read-only recommendation, user, collection and search scopes. Tokens remain RAM-only for reconnaissance.\n- Proved My Mix 1-8, My Daily Discovery and My New Arrivals resolve through official resources to real playlist contents and numeric track IDs.\n- Proved artist radio resolves through the official artist radio relationship to playlist contents.\n- Proved complete collection pagination: **393 artists, 1,535 albums, 634 tracks**, with zero 429 retries during the deliberately paced full benchmark.\n- Most successful collection page fetches were roughly 120-160 ms excluding deliberate one-second pacing, supporting an API-first browse/cache design.\n- Proved rich artist profile art, album cover art/artist relationships and nested track -> artist/album/cover-art metadata.\n- Added \`search.read\` and tested official search root/relationship forms with both Interpol and a documented control query. The current developer app consistently receives \`400 Invalid resource ID\`; one rapid burst also received a 429. Search is therefore recorded as access-blocked/unavailable for this app rather than treated as a backend implementation success. \`search.write\` remains disabled because no search mutation is required.\n- Current architecture direction: official TIDAL API for browsing/discovery/metadata, HEOS/SR8015 for playback. The remaining critical proof is whether an official-API numeric track ID can be handed to the existing HEOS playback path; this has not yet been tested and must not be assumed.\n\nRuntime search-recon checkpoint:\n\n\`\`\`text\n050da79 — Add TIDAL search reconnaissance\n\`\`\`\n\n`;

if (!changelog.includes(changelogAnchor)) throw new Error('CHANGELOG guard failed: anchor not found');
if (changelog.includes('## 2026-08-28 — Official TIDAL API reconnaissance')) throw new Error('CHANGELOG guard failed: section already present');
changelog = changelog.replace(changelogAnchor, changelogSection + changelogAnchor);

fs.writeFileSync(readmePath, readme);
fs.writeFileSync(changelogPath, changelog);
console.log('Documented TIDAL API reconnaissance checkpoint');

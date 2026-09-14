#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const path = 'CURRENT_HANDOVER.md';
const expectedSha = 'f92b15082edb58263c34e6439f38a11f6f98d431';
const data = fs.readFileSync(path, 'utf8');
const actualSha = crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(data)}\0`), Buffer.from(data)])).digest('hex');
if (actualSha !== expectedSha) throw new Error(`${path} guard failed: expected ${expectedSha}, got ${actualSha}`);

const oldDirection = `As of 13 Sep 2026, the official-TIDAL catalogue migration is production-accepted for **Favourite Tracks, Artists and Albums**. The governing architecture is still **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not regress these screens to HEOS-led display browsing merely because HEOS remains the playback/drill-in transport.`;
const newDirection = `As of 14 Sep 2026, the official-TIDAL catalogue migration is production-accepted for **Favourite Tracks, Artists, Albums and ordinary My Music Playlists**. The governing architecture is still **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not regress these screens to HEOS-led display browsing merely because HEOS remains the playback/drill-in transport.`;

const oldNext = `The next unfinished catalogue migration is **ordinary My Music Playlists**. These playlists are visible directly in HEOS and must first be reconciled read-only against the official TIDAL user-playlist collection and HEOS \`LIBPLAYLIST-*\` IDs. Do not treat this as a My Mix/personalised resolver problem and do not reopen the closed Sugarcubes/Birthday investigation merely to migrate ordinary playlists. Prove the playlist identity mapping before changing display or playback code.\n\nCurrent cleaned/pushed repository checkpoints after Artists/Albums acceptance and helper cleanup are backend \`f4e1476 — Remove Artists and Albums migration helpers\` and Pi \`497e6a5 — Remove Artists and Albums UI migration helper\`. Production implementation checkpoints immediately before cleanup include backend \`2ba75d0 — Add official TIDAL Artists and Albums catalogues\` and Pi \`998589b — Use official TIDAL Artists and Albums UI\`.`;
const newNext = `- Ordinary Playlists: production endpoint \`/api/tidal/favourite-playlists\` uses the **live exact-ID intersection** of the official TIDAL user-playlist collection and HEOS ordinary \`Created by me\` / \`Favorited\` branches. At acceptance time this was 53 official references versus 34 HEOS ordinary playlists (13 Created by me + 21 Favorited), with 19 official-only personalised Mix/Radio resources and zero HEOS-only IDs. Do not hard-code the current 34 IDs or blacklist the current 19; the library is dynamic. Preserve HEOS grouping and exact \`LIBPLAYLIST-*\` CIDs while using official TIDAL metadata/artwork. USER and EDITORIAL playlist types are both valid. Live Pi acceptance proved both catalogue branches, rich artwork, HEOS-backed track drill-in, PLAY NOW, PLAY ALL and SHUFFLE ALL. See \`docs/TIDAL_PLAYLISTS_2026-09-14.md\`.\n\nCurrent ordinary-Playlists checkpoints: backend production \`43902d1 — Add official TIDAL ordinary Playlists catalogue\`, backend cleanup \`0f6bf7b — Remove ordinary Playlists migration helpers\`, Pi production \`d2f96e4 — Use official TIDAL ordinary Playlists UI\`, Pi cleanup \`1e810ed — Remove ordinary Playlists UI migration helper\`.`;

const oldCheckpoints = `Backend current cleaned/pushed checkpoint: \`f4e1476 — Remove Artists and Albums migration helpers\`.\n\nBackend Artists/Albums production implementation checkpoint: \`2ba75d0 — Add official TIDAL Artists and Albums catalogues\`.\n\nPi current cleaned/pushed checkpoint: \`497e6a5 — Remove Artists and Albums UI migration helper\`.\n\nPi Artists/Albums production implementation checkpoint: \`998589b — Use official TIDAL Artists and Albums UI\`.`;
const newCheckpoints = `Backend current cleaned/pushed checkpoint: \`0f6bf7b — Remove ordinary Playlists migration helpers\`.\n\nBackend ordinary Playlists production implementation checkpoint: \`43902d1 — Add official TIDAL ordinary Playlists catalogue\`.\n\nPi current cleaned/pushed checkpoint: \`1e810ed — Remove ordinary Playlists UI migration helper\`.\n\nPi ordinary Playlists production implementation checkpoint: \`d2f96e4 — Use official TIDAL ordinary Playlists UI\`.\n\nEarlier Artists/Albums checkpoints remain \`2ba75d0\` backend production / \`f4e1476\` cleanup and \`998589b\` Pi production / \`497e6a5\` cleanup.`;

let out = data;
for (const [from, to, label] of [[oldDirection,newDirection,'direction'],[oldNext,newNext,'playlist status'],[oldCheckpoints,newCheckpoints,'checkpoints']]) {
  if (!out.includes(from)) throw new Error(`Expected ${label} text not found; refusing partial update`);
  out = out.replace(from, to);
}
fs.writeFileSync(path, out);
console.log(`${path}: updated ordinary Playlists status and checkpoints`);
console.log('No source/runtime files modified.');

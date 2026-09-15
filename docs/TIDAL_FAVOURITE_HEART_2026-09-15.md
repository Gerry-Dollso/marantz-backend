# TIDAL Now Playing favourite heart — 15 Sep 2026

## Status

Production accepted and pushed on both HP backend and MarantzPi. Task 2 is complete. Next agreed work is Task 3, TIDAL landing/home artwork cleanup.

## Governing identity rule

Favourite membership is an official-TIDAL concern. Use official TIDAL track identity for official TIDAL collection membership and add/remove. HEOS remains playback transport and must not be used to reconcile favourites.

When our own TIDAL UI starts playback, the Pi preserves the official track ID and associates it with the resulting HEOS MID. `/api/status` exposes that preserved value as `tidalTrackId` only while the associated HEOS MID still matches current playback. If no official hint exists, the current TIDAL HEOS `tidalMid` may only be sent as a candidate. The HP must validate exact official TIDAL track metadata/type/id before using it for membership or mutation; invalid candidates fail closed. No text search or heuristic ID reconciliation is permitted.

This distinction is required by the personalised replacement case already proved for The Sugarcubes — Birthday: official personalised track ID `34454218` can bridge to HEOS playable MID `341262056`. That mismatch belongs only at the official-TIDAL-to-HEOS playback boundary; it must not contaminate favourite identity.

## Backend contract

Official API base remains `https://openapi.tidal.com/v2`. OAuth scopes include `collection.write` in addition to the existing read scopes. Mutations use the `userCollectionTracks` relationship, JSON:API data with type `tracks`, and a fresh server-generated idempotency key.

Production routes:

- `GET /api/tidal/favourite-track-status?id=<official-or-candidate-id>` — read-only exact metadata validation followed by membership status.
- `POST /api/tidal/favourite-track?id=<id>` — add exact validated track to official TIDAL Favourite Tracks.
- `DELETE /api/tidal/favourite-track?id=<id>` — remove exact validated track.

Successful mutation invalidates the canonical Favourite Tracks cache and Favourite Tracks playback-validation cache. It does not rewrite or stop an already-active rolling Favourite Tracks HEOS queue/session. Future collection playback sees canonical refreshed state.

## Latency fix

The first implementation synchronously force-refreshed the complete Favourite Tracks collection after every successful write. Because the canonical loader paginates relationships and resolves metadata conservatively, this made POST/DELETE take about 34–35 seconds.

Commit `124fb49 — Remove favourite heart synchronous collection rebuild` changed the mutation response to return after the official TIDAL write succeeds and caches are invalidated. Aquarius controlled tests then measured roughly 0.3 seconds for writes.

The next canonical single-track status request could still take about 34.7 seconds because the collection cache had just been invalidated. Commits `f051e2a` and `6c7e2fe` add a narrow recent-mutation status overlay. After successful mutation the backend records the exact validated official ID and resulting boolean state. The status route still performs exact official metadata validation first; if a non-expired overlay exists it returns that state immediately instead of rebuilding the whole collection. The overlay expires after two minutes, then status falls through to canonical collection state. The full Favourite Tracks endpoint never treats this overlay as canonical.

This design preserves cache-generation protection in the auth module and avoids patching the canonical collection with guessed local state.

## Controlled acceptance

Test track: Boards of Canada — Aquarius, official ID `16024568`. Starting state was not favourite and was restored to not favourite at the end.

- Pre-test canonical status: `favourite:false`, 0.219 s.
- POST add: official TIDAL HTTP 200, `favourite:true`, 0.282 s.
- Immediate status: `favourite:true`, `recentMutation:true`, 0.214 s.
- DELETE remove: official TIDAL HTTP 200, `favourite:false`, 0.372 s.
- Immediate status: `favourite:false`, `recentMutation:true`, 0.202 s.

During testing, TIDAL temporarily returned HTTP 429 while backend startup/prewarm was also resolving Favourite Tracks metadata. Testing stopped rather than increasing request pressure. After cooldown, normal requests recovered. Do not hammer TIDAL when 429 is observed.

## Pi implementation

Pi production checkpoint: `4e7743e — Add TIDAL favourite heart to Now Playing`.

`server.js` preserves an official TIDAL playback hint and exposes `tidalTrackId` only while it matches the current HEOS MID. It proxies the three favourite endpoints to the HP backend. `public/app.js` drives heart status from the existing `render(data)` cycle and only requests a new status when track identity changes; there is no second `/api/status` poller. Generation/request guards prevent a late response from updating a newer track. Mutation buttons disable while the request is active and UI state changes only from the backend response. Failure hides/fails closed rather than inventing membership.

Accepted visual state in `public/favourite-heart-ui.css`:

- position: right side of Now Playing progress area, `bottom: 48px`;
- one SVG path/geometry for both states, 32 × 29 px;
- non-favourite: transparent fill, grey outline `rgba(255, 255, 255, 0.45)`;
- favourite: fill and stroke `#ff3b3b`;
- disabled opacity 0.45.

## Permanent checkpoints

Backend:

```text
43a3551 — Add official TIDAL favourite track mutations
124fb49 — Remove favourite heart synchronous collection rebuild
f051e2a — Add fast favourite track status overlay
6c7e2fe — Expire recent favourite status overlay
```

Pi:

```text
4e7743e — Add TIDAL favourite heart to Now Playing
```

The helper commits used during development are historical tooling, not the production source checkpoints.

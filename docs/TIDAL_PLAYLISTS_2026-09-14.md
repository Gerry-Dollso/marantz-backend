# TIDAL ordinary Playlists — 14 Sep 2026

## Status

Production-accepted end to end on the HP backend and MarantzPi.

Governing rule: **official TIDAL API for what the user sees; HEOS for what the user hears**. Ordinary My Music Playlists are a hybrid catalogue: HEOS proves that a playlist is currently an ordinary HEOS-visible/playable library playlist and supplies its deterministic `LIBPLAYLIST-<id>` CID/group; official TIDAL supplies the rich metadata and artwork.

Do not confuse this work with personalised My Mix / artist-radio resolution. Ordinary playlists are directly visible in HEOS and do not need the Sugarcubes/Birthday resolver path.

## Reconciliation evidence

HEOS `My Music-Playlists` exposes exactly two ordinary child branches:

- `My Music-Playlists-Created by me`
- `My Music-Playlists-Favorited`

At acceptance time HEOS returned 13 Created by me playlists and 21 Favorited playlists, all as playable `LIBPLAYLIST-<UUID>` containers: 34 ordinary playlists total.

The official TIDAL `userCollectionPlaylists` relationship returned 53 IDs across 3 pages. Exact-ID comparison proved:

- all 34 HEOS ordinary playlist IDs were present in the official collection;
- zero HEOS ordinary IDs were missing from the official collection;
- 19 official-only entries were personalised Mixes/Radio resources rather than ordinary HEOS-visible playlists.

Therefore production must **not** hard-code the current 34 IDs and must **not** maintain a blacklist of the current 19 personalised resources. The user's playlist library is dynamic. The production catalogue is the live exact-ID intersection of the current official TIDAL collection and the current HEOS Created by me/Favorited branches.

This means a newly created/favourited ordinary playlist appears when it exists on both sides, and a removed/unliked playlist disappears when it is no longer in the live intersection.

Do not filter the intersection by `playlistType`. Proven ordinary playlists include both `USER` and `EDITORIAL` resources.

## Official API methods

`getFavouritePlaylistReferenceIds()` performs complete pagination of:

`/userCollectionPlaylists/me/relationships/items?countryCode=...`

It validates IDs, rejects duplicate relationship IDs, uses the existing rate-limit retry behavior, guards against repeated pages and has a maximum-page safety bound.

`getPlaylistMetadata(ids)` fetches rich metadata in batches of at most 20 via:

`/playlists?filter[id]=<comma-separated IDs>&include=coverArt&countryCode=...`

Bulk response order must not be trusted. Production maps returned resources by ID and reconstructs the requested order. Compact metadata includes ID, name, playlist type, item/track/video counts, duration, last-modified timestamp and artwork. Existing artwork selection prefers exact 320-pixel artwork when available.

A direct UUID probe proved a user playlist such as `2000s Mix` is a normal official playlist resource and has official cover art. A direct editorial example proved `1980s Alternative Rock Classics` is `EDITORIAL` and also has official 320 artwork even though its HEOS row had no artwork.

## Production backend endpoint

`GET /api/tidal/favourite-playlists`

The endpoint:

1. Paginates the live HEOS Created by me and Favorited branches.
2. Validates `LIBPLAYLIST-` rows and strips the prefix to obtain the official playlist ID while preserving the full HEOS CID.
3. Fetches the live official user-playlist relationship IDs.
4. Intersects the two sides by exact ID.
5. Fetches rich official metadata only for the intersection.
6. Rebuilds each branch in HEOS order.
7. Preserves `Created by me` versus `Favorited` grouping and the original playable `LIBPLAYLIST-*` CID.
8. Falls back per item to the HEOS name/image if an ID is present on both sides but rich official metadata is unresolved.

The endpoint has a five-minute stale-while-revalidate cache. It does not alter favourites, playlists, playback or queues.

Live acceptance response at migration time:

```text
ok=true
count=34
createdByMe=13
favorited=21
officialReferenceCount=53
officialRelationshipPages=3
heosOrdinaryCount=34
officialOnlyCount=19
heosOnlyCount=0
unresolvedMetadataIds=[]
metadataBatches=2
buildMs=3642
```

Every returned ordinary playlist used official TIDAL metadata in that run; no fallback was needed.

## MarantzPi UI

The Pi proxies `/api/tidal/favourite-playlists` to the HP backend.

For the catalogue screens only, `public/tidal-ui.js` now loads the new endpoint for:

- `My Music-Playlists`
- `My Music-Playlists-Created by me`
- `My Music-Playlists-Favorited`

The top level still presents the familiar two categories, Created by me and Favorited. Branch rows use the rich official artwork/name while retaining their original `LIBPLAYLIST-*` CID.

Crucially, opening a `LIBPLAYLIST-*` playlist is **not** migrated to official playback. The existing HEOS browse path still supplies the track drill-in, and the existing HEOS playback/action code remains unchanged.

## Live acceptance

Touchscreen acceptance on 14 Sep 2026 proved:

- Created by me rendered correctly with all 13 playlists and rich artwork.
- Favorited rendered correctly with all 21 playlists and rich artwork.
- Previously artwork-poor HEOS entries gained official TIDAL artwork.
- Opening `1980s Alternative Rock Classics` correctly handed off to the existing HEOS-backed track list.
- Individual track `PLAY NOW` worked.
- Playlist `PLAY ALL` worked.
- Playlist `SHUFFLE ALL` worked.

This migration did not change personalised My Mix code, playlist playback/action code, AVR control, or the accepted Favourite Tracks rolling architecture.

## Production checkpoints

Backend production implementation:

`43902d1 — Add official TIDAL ordinary Playlists catalogue`

Backend helper cleanup:

`0f6bf7b — Remove ordinary Playlists migration helpers`

Pi production implementation:

`d2f96e4 — Use official TIDAL ordinary Playlists UI`

Pi helper cleanup:

`1e810ed — Remove ordinary Playlists UI migration helper`

## Invariants for future work

- Never replace the dynamic official∩HEOS intersection with a snapshot or hard-coded playlist list.
- Never blacklist today's 19 official-only Mix/Radio IDs; exclusion must arise naturally from absence in the live HEOS ordinary branches.
- Preserve the Created by me/Favorited grouping from HEOS.
- Preserve exact `LIBPLAYLIST-*` CIDs for deterministic HEOS drill-in/playback.
- Do not filter ordinary playlists by `playlistType`; both USER and EDITORIAL are valid.
- Do not reopen Birthday/Early Alternative resolver work merely because future work concerns playlists. That resolver is for personalised resources not directly represented by HEOS in the same way.
- Official bulk metadata results must be mapped by ID; never rely on response order.
- Do not mutate TIDAL favourites/playlists during catalogue reconciliation or testing.

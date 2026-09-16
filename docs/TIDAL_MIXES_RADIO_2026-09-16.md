# TIDAL Mixes & Radio — accepted implementation (2026-09-16)

## Purpose

Replace the incomplete recommendations-derived Mixes list with the user's actual TIDAL **Mixes & Radio** collection while retaining the existing official-TIDAL playlist-detail and TIDAL-to-HEOS playback bridge.

## Canonical source

The canonical source is the official TIDAL saved playlist collection:

- walk `/userCollectionPlaylists/me/relationships/items`
- bulk-load playlist metadata
- preserve collection relationship order
- select only playlist resources whose `playlistType` is exactly `MIX`

Do not identify Mixes & Radio by playlist name, hard-coded IDs, HEOS subtraction, or the recommendations endpoints. `playlistType === "MIX"` is the proven discriminator.

## Live reconciliation result

On 2026-09-16 the user's collection contained:

- 53 saved playlist references
- 3 relationship pages
- 53 metadata resources resolved
- 0 unresolved IDs
- exactly 19 resources with `playlistType: "MIX"`

Those 19 matched the TIDAL app's Mixes & Radio collection exactly. They included:

- My New Arrivals
- saved Artist Radio mixes (including TRICKY, Mudhoney, The Cure, Sonic Youth, Pixies and KNEECAP)
- saved Track Radio mixes (including Turnip Farm (2019 Remaster) and Ratbite)
- June 2026
- My Most Listened
- My Mix 1–8

Counts are observations, not constants. Production must continue deriving the collection dynamically.

## Backend implementation

`getPersonalisedRecommendations()` now:

1. calls `getFavouritePlaylistReferenceIds()`
2. calls `getPlaylistMetadata()` for those IDs
3. filters metadata with `item.playlistType === 'MIX'`
4. maps each MIX to the existing outward `playlists` contract
5. includes the official TIDAL playlist artwork URL directly
6. keeps the existing five-minute personalised cache

The `/api/tidal/personalised` endpoint therefore remains compatible with the Pi while now representing the canonical saved Mixes & Radio collection.

The response also exposes diagnostic counts (`referenceCount`, `mixCount`, relationship pages, metadata batches and unresolved IDs).

## Artwork

Official MIX metadata supplies TIDAL artwork. This artwork is significant because Artist Radio and Track Radio images contain TIDAL's own radio labelling/design. The Pi should prefer the `playlist.artwork` supplied by `/api/tidal/personalised` rather than requesting the old four-track mosaic artwork for every MIX.

This also avoids 19 unnecessary per-playlist artwork requests for the observed collection and reduces TIDAL API load/rate-limit exposure.

## Playlist detail and playback

No new playback mechanism was required. A saved MIX ID works with the existing personalised playlist detail machinery, which retrieves the official TIDAL track resources. Playback then uses the existing TIDAL-to-HEOS resolver.

Live acceptance tests on 2026-09-16 proved:

- `/api/tidal/personalised` returned 19 canonical MIXes with official artwork
- Pi proxy passed the complete response through intact
- TRICKY Artist Radio opened its track list
- Turnip Farm Track Radio opened its track list
- a Turnip Farm Radio track played successfully through the SR8015
- an existing My Mix 8 track played successfully, proving no regression of ordinary My Mix playback

## Important boundaries

- This feature uses the official TIDAL API to discover MIX identity, metadata, artwork and tracks.
- HEOS remains the playback bridge where required; do not use HEOS to decide which playlists belong in Mixes & Radio.
- Do not hard-code the observed 19 IDs or count.
- The broader `/userRecommendations/me` probe returned 404 and is not the source for this feature.
- Saved videos were deliberately excluded from the landing-page project by user decision.
- Now Playing Track Radio is a separate future task and was deliberately left on the back burner until the landing page was completed.

## Accepted production checkpoint

Backend production implementation commit: `853f62d` — `Use saved TIDAL MIX collection for Mixes and Radio`.

Temporary upgrade helper was removed in `d198dac`.

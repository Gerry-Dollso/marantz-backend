# TIDAL Artists and Albums — official catalogue migration

Date: 2026-09-13

This document records the accepted production migration of MarantzPi My Music Artists and Albums from HEOS-led display browsing to official TIDAL catalogue metadata while retaining HEOS/SR8015 for drill-in and playback.

## Architecture

The governing rule is **official TIDAL API = what the user sees; HEOS = what the user hears**. Artists and Albums are directly visible in both systems, unlike personalised My Mixes, so migration was based on direct collection-ID reconciliation rather than the personalised-track replacement resolver.

The official relationship loaders use the existing collection pagination machinery. Rich metadata is fetched in batches of at most 20 resources, mapped by ID because bulk response order is not authoritative, and reconstructed in official relationship order. Missing resources are retained only as stale/unresolved reference diagnostics and are not emitted as live display rows.

## Artist reconciliation

Read-only reconciliation established 393 official artist relationship references and 392 HEOS artist IDs. The sole official-only reference was `32968323`. A direct official artist-resource request for that ID returned 404. The user independently confirmed the visible TIDAL Artists collection contains 392 artists. Therefore production emits 392 live official artists.

Do not identify the stale artist by name without evidence. A possible catalogue-removal explanation was discussed but not proven.

## Album reconciliation

Read-only reconciliation established 1,535 official album relationship references and 1,535 HEOS `LIBALBUM-*` IDs with the same ID set. The rich official metadata build currently resolves 1,482 live album resources and omits 53 unresolved references. Three sampled unresolved IDs (`1441435`, `69720620`, `308597115`) were individually checked and returned official 404s. This strongly supports stale/unavailable-resource handling, but all 53 were not individually probed and must not be documented as individually proven 404s.

## Production backend

Production endpoints are `GET /api/tidal/favourite-artists` and `GET /api/tidal/favourite-albums`. Separate in-memory caches/in-flight refresh state use the same stale-while-revalidate approach as Favourite Tracks. The backend starts listening first, then prewarms sequentially **Artists → Albums → Favourite Tracks**. A failure in one stage is caught independently so later stages still run.

The backend emits HEOS-compatible CIDs alongside official display metadata: `LIBARTIST-<officialArtistId>` and `LIBALBUM-<officialAlbumId>`. Existing HEOS browse/drill-in/playback routes remain unchanged.

Accepted live counts after cleanup/restart were Artists `count=392, referenceCount=393, staleReferenceCount=1`; Albums `count=1482, referenceCount=1535, staleReferenceCount=53`; Favourite Tracks remained `count=594`.

## Production Pi UI

The Pi now obtains top-level Artists and Albums from the backend official endpoints and maps them into the existing UI item shapes. Existing A-Z navigation is retained. Artist selection continues through the existing HEOS-backed artist→albums route, and Album selection continues through the existing HEOS-backed album→tracks route.

Live touchscreen acceptance confirmed: Artists list at 392 with artwork and A-Z; Artist drill-in opened albums correctly; Albums list at 1,482 with artwork/artist and A-Z; albums across the A-Z list opened correct track lists; Album PLAY RANDOM successfully started a track; and an ordinary album-track PLAY NOW action succeeded.

## Checkpoints

Backend production implementation: `2ba75d0 — Add official TIDAL Artists and Albums catalogues`. Backend temporary probes were then removed from production source at `9ebf6b5`, and migration/probe helpers removed at current cleaned checkpoint `f4e1476`.

Pi production implementation: `998589b — Use official TIDAL Artists and Albums UI`. The temporary UI migration helper was removed at current cleaned checkpoint `497e6a5`.

All temporary helper/probe code remains recoverable from Git history.

## Next stage: ordinary Playlists

Ordinary My Music Playlists are HEOS-visible collections and are not the same architectural problem as My Mixes/personalised recommendations. Before changing production UI, perform fresh read-only reconciliation of the official TIDAL user-playlist collection against HEOS `LIBPLAYLIST-*`. Do not assume playlist IDs match until proved. Preserve existing playlist playback/actions while replacing only the display/catalogue authority if the evidence supports it.

Do not reopen Sugarcubes/Birthday, Early Alternative discovery, TIDAL Connect queue probing, ISRC inference, replacement/provenance/shares probes, or fuzzy resolver work merely for this ordinary-playlist migration.

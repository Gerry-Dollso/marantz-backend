# Current handover — 31 Aug 2026

This is the authoritative short handover for current MarantzPi / HP backend TIDAL work. Do not restart the closed Birthday/replacement reconnaissance unless a later code change specifically invalidates the evidence below.

## Current direction

The architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**. Official TIDAL supplies personalised recommendations, canonical track/artist/album metadata, descriptions and artwork. HEOS/SR8015 remains playback transport. Existing HEOS browse/search routes remain available as fallback/diagnostic paths, but new catalogue UI should not regress to HEOS browsing when official metadata is available.

Official TIDAL catalogue text search is currently access-blocked for this developer app (400 Invalid resource ID despite read-only search scope). Direct TIDAL playback to the SR8015 is parked.

## Repositories and live branches

Backend: `Gerry-Dollso/marantz-backend`, branch `local-ai-development`, runtime `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP 3100.

Pi: `Gerry-Dollso/marantzPI`, live branch `housekeeping-2026-08-21`, runtime `~/marantz-now-playing`, user service `marantz-display.service`. Do not casually switch/reset/merge the Pi to `v3-development`; the housekeeping branch is the authoritative deployed line.

## Current tested checkpoints

Backend source checkpoint: `66f6345 — Expose personalised TIDAL descriptions`.

Pi source checkpoint: `a65f1b5 — Add rich personalised TIDAL landing cards`.

The Pi landing page for My Mix 1-8, My Daily Discovery and My New Arrivals renders official TIDAL names/descriptions immediately, then progressively fills each card with a 2x2 collage from up to four distinct official album covers using limited concurrency. Personalised track rows show official artwork, title, artist and album.

## Fast personalised queue architecture — IMPLEMENTED AND PROVEN

The old 52.326-second whole-playlist pre-resolution design is historical and must not be described as current behaviour. Production now resolves only until it has a safe first playable track, queues that first track with `aid=4`, returns promptly, and builds the rest sequentially in the background with `aid=3`. Unresolved/ambiguous/resolution/HEOS failures are skipped and logged rather than aborting the entire remaining queue. Generation checks cancel superseded builds around awaited operations.

Live My Mix 1 proof:

```text
HTTP response: real 0m2.343s
queued=1, firstMid=35368957, building=true, remaining=38
background completion: queued=39, skipped=0, resolved=39, attempted=39, total=39
```

This is the current queue design. Do not restore full pre-resolution.

## Trusted user-playlist index — IMPLEMENTED AND PROVEN

Ambiguous official-to-HEOS resolution can use deterministic evidence from the user's own **Created by me** TIDAL playlists. The expensive playlist crawl is not performed in the request path. A complete trusted index is built in the background, off-side, and swapped atomically only when complete. If any playlist browse fails, the incomplete snapshot is discarded and the previous complete index remains active. Favorited/editorial playlists are intentionally excluded.

While the index is warming, an ambiguous request returns promptly with trusted context such as `warming`/`not-ready`; it does not block for the old multi-playlist crawl. Once ready, lookup is synchronous/in-memory and candidate-constrained to the current base resolver candidates. It never introduces a candidate that the base resolver did not find.

Live Birthday timing after restart: first ambiguous/warming request about 5.784 s; once the index was ready, deterministic resolution about 2.237 s.

## Sugarcubes — Birthday is CLOSED evidence, not an active investigation

Official personalised object: track `34454218`, album `34454215`, artist `3519103`, ISRC `USEE18800001`, duration PT4M. HEOS exposes two genuine playable candidates, including `341262056` / album `341262049` and `526377765` / album `526377759`; the base resolver correctly refuses to guess between them.

The selected playable replacement is already proven as **341262056 / 341262049** by three converging sources: the official Android TIDAL Share action on the exact My Mix item returned 341262056; TIDAL Connect used artwork matching album 341262049; and the user's pre-existing HEOS-visible **Early Alternative** playlist contains Birthday as 341262056 / 341262049 with the same artwork.

The trusted user-created-playlist index now supplies this evidence generically at runtime, without a Birthday hard-code. My Mix 1 subsequently completed 39/39 in the background, proving Birthday no longer breaks the real queue.

Do **not** redo Early Alternative discovery, ordinary HEOS playlist visibility, numeric MID search, ISRC inference, TIDAL Connect queue probing, replacement/provenance/shares probes, or arbitrary newest/oldest/first fuzzy tie-breaking. Interpol was only a known-good/control artist and is not the active case.

## Resolver invariants

- Never assume official TIDAL track/album IDs universally equal HEOS IDs; Phantogram remains a counterexample.
- Exact official MID inside a proven candidate HEOS context is deterministic identity.
- Ambiguity fails closed unless deterministic trusted context resolves it.
- Trusted resolution remains constrained to base resolver candidates.
- ISRC is not a universal equivalence key.
- Never hard-code Birthday or another catalogue exception merely to pass a sample.

## Personalised endpoints/UI contract

`/api/tidal/personalised` returns the ten current personalised recommendation resources with `id`, `name`, `kind` and official TIDAL `description`. The playlist detail endpoint returns canonical tracks with id, title, artist/artistId, album/albumId, duration, explicit, ISRC and official artwork.

The Pi uses the existing playlist detail endpoint progressively for landing-card artwork rather than blocking the initial recommendation listing or adding a separate preview endpoint. Measured Pi-side playlist calls were roughly 24-26 ms during testing.

Personalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY. PLAY FROM HERE remains deliberately unavailable for My Mixes for now.

## Working discipline

The user works through Termius on Android; large multiline terminal pastes are unreliable. Prefer safe GitHub edits and guarded migration helpers, then short sequential pull/apply/check commands. Before code changes inspect branch and working tree. After JavaScript edits run `node --check` and `git diff --check`, inspect the actual diff, then restart/test. Do not guess paths, ownership or service scope. Never commit TIDAL credentials or tokens; the refresh token remains outside Git at `/etc/marantz-backend/tidal-refresh-token` mode 0600.

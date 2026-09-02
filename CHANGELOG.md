# Changelog

## 2026-09-02 — AVR/HEOS network-path incident and recovery

- Investigated a live failure where voice-started IDLES playback succeeded but MarantzPi Now Playing displayed `UNKNOWN`. HEOS metadata remained valid while AVR TCP/23 status was unavailable.
- Direct tests from both Pi and HP showed TCP/23 connections could establish but initially returned zero bytes to `SI?`; HEOS 1255 remained responsive.
- Isolated the application stack before blaming code: stopped `marantz-display.service` and `marantz-backend.service`, identified `marantz-ai.service` as the llama.cpp model server, checked both hosts for AVR connections, and rebooted both machines. The direct port-23 failure persisted.
- AVR ordinary reboot/power cycling, Network Control toggling and a dedicated Network Settings reset did not individually restore the port-23 response. A firmware update also occurred during troubleshooting; do not infer that firmware caused the incident.
- The Network Settings reset temporarily left all external HEOS music services `available:false` while local HEOS sources remained available, despite HEOS account sign-in still being shown in both the app and AVR web interface.
- Recovery followed a later cold wall-power cycle that included the AVR, Pi and the physical network switch serving the AVR. TIDAL/Internet Radio returned and literal byte capture proved clean CR-terminated Marantz TCP/23 status messages (`SINET`, `ZMON`, volume/mute/zone responses). Pi `/api/status` and touchscreen operation then returned to normal.
- No production source code was changed. The network switch/path is a serious suspect, but root cause remains unproven because several devices were cold-cycled together. Preserve and capture HEOS 1255, AVR TCP/23 bytes, Pi `/api/status`, Pi/HP socket state and switch state first if this recurs.

Current tested backend source checkpoint remains:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi source checkpoint remains:

```text
300be7a — Fix personalised TIDAL artwork loading
```

## 2026-09-01 — Lightweight personalised TIDAL artwork

- Added an independent 30-minute `personalisedArtworkCache` for landing-card covers.
- Added `getPersonalisedArtwork(playlistId)`, which first reuses the full personalised playlist cache when available; otherwise it fetches only the first official playlist page and stops after collecting up to four distinct cover URLs.
- Added `GET /api/tidal/personalised/artwork?id=<playlistId>`. Full personalised playlist pagination remains reserved for actual playlist detail/playback.
- This change addresses the observed TIDAL 429/temporary failure pattern caused by unnecessary full-playlist artwork enrichment under cold-cache activity without weakening resolver or playback safety.
- Verified the endpoint on My Mix 1 with four official artwork URLs and a warm-cache repeat.
- End-to-end Pi testing populated all ten personalised cards from a genuine cold backend cache after restarting `marantz-backend.service`.
- PLAY FROM HERE remains deliberately pending and is the next planned personalised queue-tail feature.

Checkpoint:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

Companion Pi checkpoint:

```text
300be7a — Fix personalised TIDAL artwork loading
```

Current tested backend source checkpoint:

```text
2c8ac84 — Add lightweight personalised TIDAL artwork
```

## 2026-08-31 — Fast personalised TIDAL playback and rich UI backend checkpoint

- Replaced whole-playlist pre-resolution with fast first-track playback followed by generation-controlled background queue construction. Live My Mix 1 testing returned in about **2.343 seconds**, began with Smashing Pumpkins, and completed **39/39 queued, 0 skipped** in the background.
- Added the background trusted user-playlist index for deterministic resolution of catalogue substitutions. The expensive Created by me playlist crawl is no longer in the request path; complete snapshots are built off-side and swapped atomically. Ambiguous requests fail promptly while the index warms.
- Closed The Sugarcubes — Birthday identity case without hard-coding the track. Official personalised track `34454218` is deterministically resolved to HEOS/TIDAL playable `341262056` / album `341262049` through trusted user-created playlist context, matching the already-proven TIDAL Share, TIDAL Connect artwork and Early Alternative evidence.
- Birthday no longer breaks real My Mix 1 queue construction; the tested 39-track mix completed with zero skips.
- Exposed official recommendation `description` values from `/api/tidal/personalised` for the Pi landing cards. Live uncached response returned all ten recommendation descriptions.
- Official TIDAL API remains the catalogue/UI metadata source and HEOS remains playback transport. Official search remains access-blocked for this developer app; do not regress frontend catalogue work to HEOS search to compensate.
- Direct TIDAL playback remains parked.

Key backend checkpoints:

```text
0a5238f — Integrate trusted TIDAL HEOS resolution
27440abc6fd244da499529425a16fb11b986657c — Build trusted index in background
614850d — Build personalised TIDAL queues in background
66f6345 — Expose personalised TIDAL descriptions
```

Current tested backend source checkpoint:

```text
66f6345 — Expose personalised TIDAL descriptions
```


## 2026-08-29 — Personalised TIDAL playback and Birthday replacement investigation

- Proved the official personalised My Mix UI and per-track resolved playback path on the Pi; Play Now, Play Next, Add to End and Play Only work. Play From Here remains deliberately unavailable for My Mixes pending a generic queue-tail builder.
- Added the first generic resolved personalised playlist Play All/Shuffle All backend path. Its first live My Mix 1 Play All test failed safely after about **52.3 seconds**, before queue mutation, on The Sugarcubes - Birthday at index 31 because the resolver returned a genuine catalogue ambiguity.
- Identified the performance limitation independently of the identity problem: the prototype pre-resolves every track sequentially and the resolver performs live HEOS album browsing even on its direct path. Full-playlist pre-resolution is therefore too slow for production.
- Established the Birthday identity discrepancy precisely. My Mix 1 exposes official track `34454218` / album `34454215` / ISRC `USEE18800001`, while two HEOS-visible Life's Too Good editions contain Birthday as `341262056` / album `341262049` and `526377765` / album `526377759`.
- Proved both HEOS candidates are genuine official TIDAL objects with STREAM availability and different ISRCs, so ISRC cannot identify the consumer-selected replacement in this case.
- Obtained three converging pieces of evidence for `341262056` / `341262049`: the official Android TIDAL Share action on the exact My Mix item returned track `341262056`; TIDAL Connect to the SR8015 used the exact artwork of album `341262049`; and the user's pre-existing Early Alternative TIDAL playlist appears through HEOS with Birthday MID `341262056`, album_id `341262049`, and the same artwork.
- TIDAL Connect exposed placeholder `mid=1` / `album_id=1` and left the normal stored HEOS queue intact, confirming that the Connect session cannot itself be used as a direct MID lookup.
- Current deterministic investigation: test whether official TIDAL media replacement functionality can expose the mapping from stored personalised object `34454218` to the consumer-playable object. Do not fall back to arbitrary fuzzy/newest/oldest selection without evidence.
- Guarded replacement-probe migration commit `777e2d8` failed safely because its source anchor matched zero times; it made no runtime-file change. Subsequent uncommitted local reconnaissance added `replaceMedia`, provenance and shares probes to `tidal-user-auth-recon.js`; review those edits before committing them.
- Do not repeat established HEOS playlist discovery. Early Alternative is already proven at `LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84` and contains Birthday as MID `341262056` / album_id `341262049`.

<!-- TIDAL_BIRTHDAY_HANDOVER_2026_08_29 -->
## 2026-08-29 — Personalised queue hard case and TIDAL replacement investigation

- Added production personalised playlist playback at `a30db56`: official playlist tracks are resolved to HEOS context before queue mutation, first successful item uses `aid=4`, later items use `aid=3`, and ambiguity fails closed.
- Live My Mix 1 Play All exposed two distinct issues. Full pre-resolution took about **52.326 seconds**, which is not acceptable for production UX, and the build failed safely at index 31 on The Sugarcubes — **Birthday** without changing playback.
- The developer API My Mix object is track `34454218`, album `34454215`, artist `3519103`, ISRC `USEE18800001`, duration `PT4M`. Direct official probing proved it is a genuine TIDAL resource but the observed response did not advertise STREAM availability.
- HEOS exposes two playable same-title/same-album candidates: `341262056` / album `341262049` and `526377765` / album `526377759`. Both are genuine official resources with STREAM availability but different ISRC/licensing metadata, proving ISRC cannot be used as a universal equivalence key.
- The official Android TIDAL app's Share action on the exact My Mix Birthday item returned track **341262056**. Sending the same item through TIDAL Connect produced album artwork exactly matching official album **341262049**. Connect itself reports placeholder `mid=1` / `album_id=1`, so Share supplies the exact track identity while Connect independently confirms the selected album edition.
- Independently browsed the user's existing **Early Alternative** playlist through HEOS. Birthday is already present there as MID **341262056**, album_id **341262049**, with the same artwork. This closes the question of whether the playlist is HEOS-visible and which edition it contains; do not repeat that reconnaissance.
- TIDAL Connect queue inspection showed the Connect session is transient/station-style and did not replace the existing normal HEOS queue.
- The active investigation is now whether official TIDAL APIs expose a deterministic replacement/media-substitution mapping from personalised object `34454218` to playable object `341262056`. Prefer TIDAL's own replacement semantics if accessible; do not choose among editions by arbitrary fuzzy tie-breakers.
- The first guarded replacement-probe migration failed safely because its exact anchor did not match and wrote nothing. Subsequent 29 Aug commits added read-only replacement/replaceMedia/metadata/provenance/shares reconnaissance helpers. Inspect their live results before creating further probes.
- Queue latency remains a separate problem even if replacement identity is solved: the reusable resolver performs live HEOS browsing on many tracks, so whole-playlist pre-resolution can take tens of seconds. Future generic Play All/Shuffle All/Play From Here machinery should start a safely resolved first item promptly and continue building in the background while retaining cancellation/fail-safe behaviour.
- Added `CURRENT_HANDOVER.md` as the short authoritative continuation document so a new chat does not restart closed investigations.

This file records project-level milestones and known-good checkpoints. Git history remains the detailed source for individual code changes.

## 2026-08-28 — HEOS resolver normalization and second-sample validation

- Diagnosed the remaining 16 Horsepower failure against the real HEOS album container. Official TIDAL track `35888116` / album `35888114` (`Sackcloth 'N' Ashes`) maps to HEOS `LIBALBUM-635299` / MID `635301` (`Sackcloth -N- Ashes`).
- Proved the resolver bug was general album normalization, not missing catalogue content: apostrophes survived the common normalizer, so `'N'` and `-N-` never converged. Added quote-delimited N-separator normalization in `cbcd4ac`; no artist-specific exception was added.
- Re-ran the read-only resolver after the fix against the then-current personalized recommendations. TIDAL had refreshed the mixes, so this was a new 26-track sample rather than the original fixed sample. Result: **26/26 resolved, 0 ambiguous, 0 unresolved, 0 errors**.
- In the fresh sample, 23/26 resolved through `direct-album-id+official-mid`; April Skies, Screen Shot and Black Soul Choir resolved through structured `artist-album-track` traversal.
- Preserve the earlier 23/26, 1 ambiguous, 2 unresolved result as a separate hard edge-case checkpoint. Do not claim that the one-line normalization change alone converted that exact sample to 26/26. Birthday and Rise remain valuable historical edge cases from that original sample.
- Closed the simple HEOS reverse-context experiment. Track search `scid=3` behaves as human-text search, not numeric MID lookup; numeric-ID searches produced no exact MID hits even for known-good controls. Browsing both `SEARCHED_TRACKS-` and `SEARCHED_TRACKS-Rise` returned the normal TIDAL root rather than a search-results container. Do not spend further time inventing synthetic `SEARCHED_TRACKS-*` CIDs.

Current tested resolver checkpoint:

```text
cbcd4ac — Fix HEOS album N-separator normalization
```

Checkpoint additions:

```text
e48613e — Add read-only HEOS reverse context probe
0817a62 — Add guarded HEOS album separator normalization migration
cbcd4ac — Fix HEOS album N-separator normalization
```

## 2026-08-28 — Persistent TIDAL user authorization and deterministic HEOS resolution

- Added persistent TIDAL user OAuth refresh-token authorization for the official user-scoped API. Access tokens remain short-lived in memory; the refresh token is stored outside Git in `/etc/marantz-backend/tidal-refresh-token` with owner `gerry:gerry` and mode `0600`.
- The backend can now restore a user session after restart by exchanging the persisted refresh token, and the `/api/tidal/oauth/status` response reports whether a refresh token is stored without exposing the token itself.
- Added a read-only recommendation-resolution batch probe over 26 tracks drawn from My Mix 1, My Daily Discovery and My New Arrivals.
- Added the read-only `ai/probe-tidal-heos-resolution.js` reconnaissance tool to resolve official recommendation metadata into playable HEOS context.
- The first metadata-only resolver pass achieved 18/26 resolved, 2 ambiguous and 6 unresolved. Follow-up deterministic identity checks improved this to **23/26 resolved, 1 ambiguous, 2 unresolved, 0 errors**.
- The key finding is narrower than universal ID equality: when a valid candidate HEOS context exposes a playable `mid` exactly equal to the official TIDAL track ID, that exact match is a deterministic identity signal. Phantogram remains the counterexample proving that official TIDAL track IDs cannot be blindly treated as HEOS MIDs.
- 22 of the 23 resolved tracks were confirmed as `direct-album-id+official-mid`; Ladytron and the other edge cases established that an exact official MID can disambiguate duplicate title matches inside a HEOS album container.
- `A Daisy Chain 4 Satan (Acid & Flowers Mix)` required only transport-name normalization: HEOS returned `Acid %26 Flowers Mix`, but the official track ID `113779406` matched the playable HEOS MID exactly.
- `Who Are You` on `Black Boy (Alternative)` resolved despite official metadata crediting Vince Staples while the HEOS track list credits Dahi, because the official track ID `536071631` matched the HEOS MID exactly.
- `That's Law` resolved despite the official artist being Frankie Pulitzer and the HEOS track credit being CZARFACE, because the official track ID `536793606` matched the HEOS MID exactly. Frankie Pulitzer is a collaborator on the release, not the HEOS primary artist credit.
- `Destroy Everything You Touch` resolved deterministically by choosing the HEOS candidate whose MID equals official track ID `214191276`.
- `Screen Shot` by Swans resolved through artist -> album -> track traversal where direct constructed album lookup was insufficient.
- Current remaining edge cases are The Sugarcubes `Birthday`, where two distinct HEOS albums both contain a track with the same title, and two unresolved catalogue/context cases from Public Image Ltd. and 16 Horsepower. These remain intentionally unresolved rather than guessed.
- Current architecture rule: official TIDAL metadata supplies canonical discovery identity; HEOS remains the playback transport. Prefer exact numeric identity when a proven HEOS context exposes a MID equal to the official track ID. Do not assume that arbitrary TIDAL artist or album IDs can be constructed into HEOS CIDs.
- Next investigation is reverse lookup from a playable HEOS MID/context toward canonical TIDAL metadata, while preserving read-only reconnaissance and not guessing undocumented cross-service mappings.

Current tested backend checkpoint:

```text
2ce9132 — Use deterministic TIDAL IDs in HEOS resolver probe
```

Checkpoint sequence:

```text
0a7776c — Add persistent TIDAL auth and paced recommendation probe
e2b45dd — Add read-only TIDAL HEOS resolution probe
a616299 — Refine read-only TIDAL HEOS resolution probe
2ce9132 — Use deterministic TIDAL IDs in HEOS resolver probe
```

## 2026-08-28 — Official TIDAL API reconnaissance

- Proved user OAuth Authorization Code + PKCE with read-only recommendation, user, collection and search scopes. The later persistent-auth checkpoint stores only the refresh token outside Git; no token is committed to repository source.
- Proved My Mix 1-8, My Daily Discovery and My New Arrivals resolve through official resources to real playlist contents and numeric track IDs.
- Proved artist radio resolves through the official artist radio relationship to playlist contents.
- Proved complete collection pagination: **393 artists, 1,535 albums, 634 tracks**, with zero 429 retries during the deliberately paced full benchmark.
- Most successful collection page fetches were roughly 120-160 ms excluding deliberate one-second pacing, supporting an API-first browse/cache design.
- Proved rich artist profile art, album cover art/artist relationships and nested track -> artist/album/cover-art metadata.
- Added `search.read` and tested official search root/relationship forms with both Interpol and a documented control query. The current developer app consistently receives `400 Invalid resource ID`; one rapid burst also received a 429. Search is therefore recorded as access-blocked/unavailable for this app rather than treated as a backend implementation success. `search.write` remains disabled because no search mutation is required.
- Current architecture direction is now proven end-to-end: official TIDAL API for browsing/discovery/metadata, HEOS/SR8015 for playback. The bridge requires metadata-based HEOS catalogue resolution rather than direct numeric-ID translation.
- Live Daily Discovery proof used Phantogram - When I'm Small. Official API returned track `111442201`, album `111442199` (Eyelid Movies), artist `3614038`. HEOS independently returned artist `LIBARTIST-3614038`, but its matching Eyelid Movies release was `LIBALBUM-111438012` and the matching track MID was `111438014`.
- Constructing `LIBALBUM-111442199` directly from the API album ID returned an empty HEOS container, so API album/track IDs must not be assumed to equal HEOS IDs without evidence. The later 26-track deterministic probe substantially strengthened the specific track-ID evidence where the HEOS context exposes the same MID.
- Following the real HEOS artist -> Albums hierarchy found the matching release and title. `browse/add_to_queue` with the HEOS-returned CID/MID succeeded with `aid=3`; queue inspection confirmed When I'm Small at qid 51. A subsequent `aid=1` test successfully started the track on the SR8015.
- Production rule: resolve official API metadata into a real HEOS catalogue context, then use HEOS-returned CID + MID for queue/playback. Numeric identity must be proven per identifier class and context rather than assumed globally.

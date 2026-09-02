# Current handover — 2 Sep 2026

This is the authoritative short handover for current MarantzPi / HP backend TIDAL work. Do not restart the closed Birthday/replacement reconnaissance unless a later code change specifically invalidates the evidence below.

## Current direction

The architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**. Official TIDAL supplies personalised recommendations, canonical track/artist/album metadata, descriptions and artwork. HEOS/SR8015 remains playback transport. Existing HEOS browse/search routes remain available as fallback/diagnostic paths, but new catalogue UI should not regress to HEOS browsing when official metadata is available.

Official TIDAL catalogue text search is currently access-blocked for this developer app (400 Invalid resource ID despite read-only search scope). Direct TIDAL playback to the SR8015 is parked.

## Repositories and live branches

Backend: `Gerry-Dollso/marantz-backend`, branch `local-ai-development`, runtime `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP 3100.

Pi: `Gerry-Dollso/marantzPI`, live branch `housekeeping-2026-08-21`, runtime `~/marantz-now-playing`, user service `marantz-display.service`. Do not casually switch/reset/merge the Pi to `v3-development`; the housekeeping branch is the authoritative deployed line.

Voice: `Gerry-Dollso/marantz-voice`, branch `main`, HP runtime `/opt/marantz-voice`, system service `marantz-voice.service`. The Pi-side sender at `/home/dollso/marantz-voice` is a deployment directory, not a Git checkout, and is managed by `marantz-mic-stream.service`.

## AVR/HEOS network-path incident — 2 Sep 2026

During ReSpeaker voice testing, `Play, IDLES` succeeded audibly but the Pi Now Playing screen displayed `UNKNOWN`. Direct `/api/status` proved the HEOS side was healthy (`Heel / Heal`, IDLES, Brutalism, artwork/progress) while AVR status had collapsed to `power:unknown`, `input:UNKNOWN`, `volume:null`; `hasTrackInfo` was false because NET could no longer be confirmed.

Direct TCP/23 tests from both Pi and HP established connections to `192.168.50.220:23` but initially received zero bytes for `SI?`, while HEOS port 1255 remained responsive. `marantz-display.service` and `marantz-backend.service` were stopped; `marantz-ai.service` was confirmed to be the llama.cpp model server; no persistent or repeatedly observed short-lived port-23 connections from Pi or HP were found. Rebooting the HP and Pi did not restore `SI?`.

AVR-side attempts included ordinary power/reboot, a firmware update that occurred during troubleshooting, toggling Network Control, and a dedicated Network Settings reset. None by itself restored the silent TCP/23 response. The Network Settings reset also temporarily left all external HEOS music services (`Tidal`, `TuneIn`, Amazon, Deezer, Qobuz, SoundCloud) as `available:false`, while local HEOS sources remained available. The HEOS app and AVR web interface still showed the HEOS account signed in, so do not equate `available:false` with proven logout.

Recovery occurred after a later cold wall-power cycle that included the AVR, Pi and, importantly, the physical network switch serving the AVR. TIDAL and Internet Radio menus returned, and TCP/23 began returning data. A literal byte dump with `od` proved clean CR-terminated Marantz protocol messages including `SINET`, `ZMON`, `MV48`, `MVMAX 80`, `MUOFF`, `Z2OFF` and `Z3OFF`; Termius rendering of CR-only output can look overwritten/garbled and must not be mistaken for malformed AVR bytes. Pi `/api/status` then returned healthy receiver state (`power:on`, `input:TIDAL`, `inputCode:NET`, volume `-32`, mute false), and touchscreen operation was confirmed normal.

**No production code was changed for this incident.** The network switch/path is now a serious suspect because recovery occurred only after the cold cycle that included it, but root cause is **not proven** because multiple devices were cold-cycled together. Do not claim that the switch, firmware, ReSpeaker/voice, or the earlier Pi TCP connection churn independently caused this occurrence.

If the symptom recurs, preserve the fault before resetting anything and capture, in order: direct HEOS 1255 status/metadata, direct AVR TCP/23 response bytes, Pi `/api/status`, sockets/connections from both Pi and HP, and network-switch state. Avoid factory-resetting the AVR or changing production code until those layers are distinguished. The earlier single-connection AVR polling hardening remains in place and is functioning normally after recovery.

## Voice hardware checkpoint — 2 Sep 2026

Voice/ASR development has resumed on the **Seeed Studio ReSpeaker USB Mic Array v2.0 (107990193)**. The former miniDSP UMIK-1 is no longer the active microphone baseline.

The ReSpeaker exposes native 6-channel, 16 kHz, S16_LE audio. The Pi sender now captures that native stream, extracts the processed speech output on channel 0 with ffmpeg, converts it to mono raw 16 kHz S16_LE PCM, and sends it to the HP voice listener on `192.168.50.145:5566`. The pre-ReSpeaker Pi sender is backed up at `/home/dollso/marantz-voice/mic-stream.sh.before-respeaker`.

First end-to-end live verification succeeded without changing Whisper or backend semantics:

```text
Power test:
WAKE DETECTED score=0.587
TRANSCRIPTION: Power on.
BACKEND RESPONSE: {"ok":true,"state":"on"}
AVR physically powered on

Artist test:
WAKE DETECTED score=0.951
TRANSCRIPTION: Play, IDLES.
BACKEND RESPONSE: play-artist / IDLES / shuffle=true
IDLES playback started successfully
```

One earlier repeated power test produced `Pore on`, so normal ASR variance remains. Initial difficult-title samples were `TANGK -> tank` with the final artist omitted, and `Gift Horse` correctly recognised while `IDLES -> Idola`. The sample is too small to justify gain, AGC, Whisper-model or prompt tuning yet.

The `UNKNOWN` Now Playing incident seen during the IDLES test was subsequently isolated as an AVR/network-status-path failure and recovered without a production code change; it is not evidence of a ReSpeaker/voice failure. Voice testing can resume from this checkpoint when desired.

Detailed microphone/ASR notes are maintained in the `marantz-voice` README and CHANGELOG.

## Current tested checkpoints

Backend source checkpoint: `2c8ac84 — Add lightweight personalised TIDAL artwork`.

Pi source checkpoint: `300be7a — Fix personalised TIDAL artwork loading`.

The Pi landing page for My Mix 1-8, My Daily Discovery and My New Arrivals renders official TIDAL names/descriptions immediately, then progressively fills each card with a 2x2 collage from up to four distinct official album covers. Landing artwork now uses a dedicated first-page-only backend endpoint with an independent 30-minute cache. Pi enrichment is sequential and a failed card receives one delayed retry. End-to-end testing populated all ten cards from a genuinely cold backend cache. Personalised track rows show official artwork, title, artist and album.

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

`/api/tidal/personalised` returns the ten current personalised recommendation resources with `id`, `name`, `kind` and official TIDAL `description`. The full playlist detail endpoint returns canonical tracks with id, title, artist/artistId, album/albumId, duration, explicit, ISRC and official artwork.

Landing-card artwork uses the separate `GET /api/tidal/personalised/artwork?id=<playlistId>` endpoint. On a cold artwork/full-playlist cache it fetches only the first official playlist page and returns up to four distinct artwork URLs; it does not paginate. Artwork has an independent 30-minute cache, and a warm full-playlist cache can satisfy it with no additional TIDAL request. The Pi loads these requests sequentially and retries only a failed card once after two seconds.

Personalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END and PLAY ONLY. PLAY FROM HERE remains deliberately unavailable for My Mixes for now. The next implementation should replace the current queue with the selected personalised track followed by every later track from the same Mix in original order, preserving existing deterministic resolution, background queue-building and generation-cancellation safety.

## Working discipline

The user works through Termius on Android; large multiline terminal pastes are unreliable. Prefer safe GitHub edits and guarded migration helpers, then short sequential pull/apply/check commands. Before code changes inspect branch and working tree. After JavaScript edits run `node --check` and `git diff --check`, inspect the actual diff, then restart/test. Do not guess paths, ownership or service scope. Never commit TIDAL credentials or tokens; the refresh token remains outside Git at `/etc/marantz-backend/tidal-refresh-token` mode 0600.

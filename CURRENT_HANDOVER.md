# Current handover — 2 Sep 2026

This is the authoritative short handover for current MarantzPi / HP backend TIDAL work. Do not restart the closed Birthday/replacement reconnaissance unless a later code change specifically invalidates the evidence below.

## Current direction


## Proactive architecture roadmap

The HP is deliberately an extensible local brain. `marantz-ai.service` (persistent llama.cpp/Qwen) is available beyond the current voice/intent classifier when AI genuinely improves the system. Future chats/developers should proactively identify and propose useful backend services, packages, diagnostics, storage, automation and AI capabilities rather than waiting for the user to suggest them, but must explain and obtain approval before installation or implementation.

Maintain the safety boundary: AI may interpret language/context, assist discovery and explain diagnostics; deterministic/fail-closed code remains authoritative for TIDAL-to-HEOS identity, AVR control and playback/queue mutation.

Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; a Current Queue view/control surface (read-only first, with current/upcoming tracks and available artwork/metadata, then optional play/remove/reorder/clear controls later); richer contextual voice follow-ups; AI-assisted diagnosis from structured evidence; discovery across TIDAL metadata, Discogs-derived collection data and playback history; and, only when justified by a concrete retrieval need, lightweight local embeddings/semantic search. These are roadmap items, not yet implemented features.

The architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**. Official TIDAL supplies personalised recommendations, canonical track/artist/album metadata, descriptions and artwork. HEOS/SR8015 remains playback transport. Existing HEOS browse/search routes remain available as fallback/diagnostic paths, but new catalogue UI should not regress to HEOS browsing when official metadata is available.

Official TIDAL catalogue text search is currently access-blocked for this developer app (400 Invalid resource ID despite read-only search scope). Direct TIDAL playback to the SR8015 is parked.

## Repositories and live branches

Backend: `Gerry-Dollso/marantz-backend`, branch `local-ai-development`, runtime `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP 3100.

Pi: `Gerry-Dollso/marantzPI`, live branch `housekeeping-2026-08-21`, runtime `~/marantz-now-playing`, user service `marantz-display.service`. Do not casually switch/reset/merge the Pi to `v3-development`; the housekeeping branch is the authoritative deployed line.

Voice: `Gerry-Dollso/marantz-voice`, branch `main`, HP runtime `/opt/marantz-voice`, system service `marantz-voice.service`. The Pi-side sender at `/home/dollso/marantz-voice` is a deployment directory, not a Git checkout, and is managed by `marantz-mic-stream.service`.

## AVR TCP/23 recurrence — 4 Sep 2026

A second spontaneous `UNKNOWN` incident occurred during ordinary PHONO/vinyl listening, without voice/ReSpeaker activity. MarantzPi could still send source/volume commands, but no source was highlighted. Pi `/api/status` retained HEOS-side metadata but showed AVR state as `power:unknown`, `input:UNKNOWN`, `inputCode:UNKNOWN`, `volume:null`.

The live fault was preserved before recovery. From both Pi and HP, TCP connections to `192.168.50.220:23` succeeded but `SI?` returned zero bytes. HEOS port 1255 remained healthy and returned the SR8015 normally. The Pi Node poller showed two transient established TCP/23 sockets whose local ports changed across samples, demonstrating cycling/timeout behaviour rather than permanently stuck sockets. The HP held no persistent TCP/23 socket.

`marantz-display.service` was then stopped and its TCP/23 sockets disappeared. Independent HP `SI?` probes remained silent after 10 seconds and again after more than one minute with zero Pi polling, so Pi polling is not required to maintain the wedged state. A passive 10-second TCP/23 listen also received no bytes.

Recovery was isolated much more tightly than on 2 Sep: with the Pi display still stopped and the HP/network switch untouched, the SR8015 alone was put into normal standby, left for about 10 seconds, and powered back on. HP `SI?` immediately returned `SI8K\r` (plus `SVOFF\r`) and returned the same result again 10 seconds later. `SI8K` correctly matched the configured PHONO/Technics SL-1210G source. MarantzPi was then restarted and normal source display was confirmed.

This materially weakens the earlier suspicion of the external network switch and the ReSpeaker/voice path. Current evidence strongly localises the failure to the SR8015 or its internal network/control subsystem: TCP/23 accepts connections but becomes silent while HEOS remains healthy, and a normal AVR-only standby/on cycle can recover it. The exact trigger/root cause is still unproven. Do not claim a specific internal firmware/service defect without further evidence.

For a future recurrence, preserve the live fault first. The shortest proven diagnostic set is: raw `SI?` bytes from Pi and HP, HEOS 1255 health, Pi `/api/status`, and Pi/HP TCP/23 sockets. If those reproduce this exact signature, an AVR-only normal standby/on cycle is now the least-invasive proven recovery to try before network resets, host reboots or wall-power cycling.

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

Backend tested functional source checkpoint: `ad56d23 — Require selected My Mix track for play from here`.

Backend clean repository checkpoint after migration-helper removal: `9ac4924 — Remove strict play from here helper`.

Pi tested functional source checkpoint: `041b035 — Make TIDAL track actions reusable`.

Pi current repository/documentation checkpoint: `0769f88 — Remove Play From Here documentation helper`.

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

Personalised PLAY ALL / SHUFFLE ALL are live. Individual tracks support PLAY NOW, PLAY NEXT, ADD TO END, PLAY FROM HERE and PLAY ONLY. PLAY FROM HERE sends the personalised playlist ID plus the exact official selected track ID, rejects shuffle, verifies the selected track belongs to the fetched Mix, slices the queue from that exact position and preserves the existing deterministic resolver, first-track `aid=4`, background `aid=3` builder and generation-cancellation safety. The selected first track is strict/fail-closed: if it cannot resolve or queue safely, the request fails rather than silently starting the following track; later unresolved tracks retain the normal safe-skip background behaviour. Live touchscreen acceptance confirmed exact selected-track starts, repeated PLAY FROM HERE use, and the final-track boundary where NEXT does not start an unrelated track. The Pi shared track-action lifecycle now clears disabled/loading state in `finally`, so these actions remain reusable.

## Working discipline

The user works through Termius on Android; large multiline terminal pastes are unreliable. Prefer safe GitHub edits and guarded migration helpers, then short sequential pull/apply/check commands. Before code changes inspect branch and working tree. After JavaScript edits run `node --check` and `git diff --check`, inspect the actual diff, then restart/test. Do not guess paths, ownership or service scope. Never commit TIDAL credentials or tokens; the refresh token remains outside Git at `/etc/marantz-backend/tidal-refresh-token` mode 0600.

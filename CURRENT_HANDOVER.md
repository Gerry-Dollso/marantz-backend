# Current handover — 15 Sep 2026

<!-- ARTIST_CACHE_HANDOVER_2026_09_17 -->
## 2026-09-17 — Artist landing performance checkpoint (backend accepted; final Pi redesign pending)

The governing architecture remains **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not treat the richer Artist Page as fully finished yet: the backend performance architecture below is live and runtime-proven, but the final compact 8-inch Pi Artist landing redesign and touchscreen acceptance are still pending.

### Current accepted HP backend architecture

Artist Details core is deliberately separated from expensive secondary enrichment. The landing core keeps official TIDAL artist metadata/artwork, HEOS-backed release previews, Artist Radio and Similar Artists, but **Top Tracks and biography no longer block the core Artist Details response**. Biography is available lazily through `GET /api/tidal/artist-biography?id=<id>`. Top Tracks is available lazily through `GET /api/tidal/artist-top-tracks?id=<id>`.

HEOS landing release previews are now genuinely bounded at the backend to **3 Albums, 3 EPs & Singles and 3 Appears On** entries. Do not revert to fetching complete HEOS release categories for the landing page. Full-list views must be loaded lazily from dedicated/full retrieval paths rather than assuming the truncated core payload is complete.

Top Tracks correctness is non-negotiable. Official TIDAL Artist `tracks` relationships do not expose a documented server-side popularity sort or a separate app-ranked Top Tracks relationship. Existing `getAllTracks()` therefore crawls the Artist track relationship, de-duplicates and sorts by official TIDAL `popularity`, then keeps the ranked result. Earlier empirical testing proved raw relationship order is not Top Tracks order: for the tested artist, `Judith` was 12th in raw relationship order but ranked #1 after official popularity sorting, matching the TIDAL app. **Never replace this with the first four raw relationship tracks.** The landing UI may display only four, but the genuine ranking calculation remains authoritative.

Top Tracks is now lazy and persistently cached. Production endpoint: `GET /api/tidal/artist-top-tracks?id=<artistId>`, with optional `refresh=1`. The persistent store is `/var/lib/marantz-backend/artist-top-tracks/<artistId>.json`, using atomic temp-file/rename writes, 24-hour freshness and a 30-day maximum stale window. It retains the existing 15-minute memory cache, in-flight de-duplication and stale-while-refresh behaviour. Current backend code stores the existing **top 10 ranked tracks**; the planned landing view displays the first four. Do not call those 10 a complete artist track list.

Runtime proof used favourite artist **TRICKY, TIDAL ID 27444**. Before the 3/3/3 release limit, forced Artist Details took **20.532 s**. After 3/3/3 it took **14.258 s**, with Top Tracks still consuming **10.318 s**. After removing Top Tracks from the critical path, forced core Artist Details took **3.894 s**. The first separate lazy Top Tracks request took **10.455 s**, the immediate RAM hit took **0.000781 s**, and after a complete `marantz-backend.service` restart the same request took **0.002326 s** with `cached:true`, `cacheSource:'disk'`, `trackCount:10`. The verified first four were `Hell Is Round The Corner`, `Black Steel`, `Overcome`, `Aftermath`. This proves the expensive genuine ranking is moved off the landing critical path and survives process restart.

### Production checkpoints through this handover

Backend repository `Gerry-Dollso/marantz-backend`, branch `local-ai-development`, runtime `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP port 3100.

- `97a09d6 — Optimize Artist Details cold loading`
- `aa34f70 — Make Artist biography load lazily`
- `3172044 — Limit Artist landing release previews`
- `d7debb5 — Add persistent Artist Top Tracks store`
- `3d93282 — Add guarded lazy persistent Artist Top Tracks updater`
- `ef89872 — Add guarded Artist Top Tracks route updater`
- `0994b54 — Make Artist Top Tracks lazy and persistent`

The production Top Tracks changes passed `node --check server.js`, `node --check tidal-artist-details.js` and `git diff --check`, were runtime-proven as above, committed as `0994b54`, and pushed to `origin/local-ai-development` before this documentation roll-up.

### Persistent caches — backend architecture accepted

Persistent roots are now `/var/lib/marantz-backend/artwork`, `/var/lib/marantz-backend/artist-details`, `/var/lib/marantz-backend/artist-top-tracks` and `/var/lib/marantz-backend/artist-biographies`. Artwork list performance was fixed by batching touch-index writes; accepted timings were about **0.0189 s for Artists** and **0.0466 s for Albums**. The Pi binary artwork proxy regression was also fixed and touchscreen-confirmed for both lists.

Biography is now lazy **and persistently cached**. `tidal-artist-biography-store.js` stores one versioned JSON record per numeric Artist ID under `/var/lib/marantz-backend/artist-biographies/<artistId>.json`, using atomic temp-file/rename writes, **7-day freshness** and a **30-day maximum stale window**. The existing RAM cache and in-flight de-duplication remain. Fresh disk values survive a complete backend restart; stale-but-usable biographies return immediately while one background refresh replaces the record. Null biography results can also be persisted so repeatedly unresolved artists do not continually repeat expensive external lookups. The MusicBrainz -> Wikidata -> Wikipedia resolution logic itself was not changed.

Runtime acceptance used **TRICKY, TIDAL ID 27444**. A forced cold biography refresh took **6.642 s** and wrote a version-1 persistent record with a Wikipedia biography. After a complete `marantz-backend.service` restart, the normal biography request took **0.015 s**, proving disk persistence. The record was then deliberately aged to 8 days old, the backend restarted to clear RAM, and the stale request returned in **0.016 s**. Background refresh subsequently replaced the deliberately old `2026-09-09T15:44:19.297Z` timestamp with fresh `2026-09-17T15:47:07.667Z`, with the Wikipedia biography intact. This proves restart persistence and stale-while-refresh end to end.

Biography persistence production checkpoints: `6103aa3 — Add persistent Artist biography store` and `aa8f276 — Persist Artist biographies across restarts`. Both touched JavaScript files passed `node --check` and `git diff --check`; runtime acceptance passed as above. At the completion of this test, local HEAD and `origin/local-ai-development` both reported `aa8f276` with a blank working-tree status. The remaining Artist phase work is now the Pi UI/full-list redesign and real 8-inch touchscreen acceptance, not further biography persistence.

### Immediate next work — do not skip touchscreen acceptance

Before changing Pi source, inspect the actual GitHub state of `Gerry-Dollso/marantzPI`, branch `housekeeping-2026-08-21`; do not ask the user to grep source that GitHub can provide. The physical MarantzPi uses an **8-inch 1080p touchscreen**.

Agreed final landing design: **4 Top Tracks in a fixed 2×2 layout**, **3 Albums**, **3 EPs & Singles**, **3 Appears On**, no preview scrollbars, and a compact end-of-row full-list control such as `›` or `…` instead of the large SEE ALL control. Similar Artists should be inspected before deciding whether the same 3-item treatment applies. Core Artist Details should render immediately; Top Tracks and biography should fill asynchronously with a navigation/request-token guard so late responses cannot update a page the user has left.

Because the core release arrays are now deliberately truncated, inspect and implement proper lazy full-list retrieval for Albums, EPs & Singles and Appears On. Existing SEE ALL/full-list behaviour must not silently show only the three preview entries. Likewise, the Top Tracks endpoint currently returns the ranked top 10; determine from the existing Pi UX whether the full Top Tracks page is intended to mean those 10 or something broader before labelling it.

**Final acceptance must happen on the actual 8-inch touchscreen.** Backend syntax checks, diffs and curl timings are not sufficient. Verify fast core appearance, asynchronous Top Tracks/biography, fixed 2×2 Top Tracks, three-card release rows, no preview scrollbars, working compact full-list controls, genuinely complete intended full-list pages, and safe navigation while lazy requests are in flight. Only after that acceptance should Pi documentation say the redesign is complete.

### Mandatory working method

The user works primarily from Android phone/tablet using Termius. Commands must be single-line, short, sequential and copy/paste safe; label HP/Pi and read-only/mutating, then wait for output. A 👍🏻 means agree/continue and can represent expected blank output. Use GitHub first for repository inspection and substantial/interconnected edits; Termius is for runtime evidence, deployment/testing and small bounded edits. Never guess source/API shapes when GitHub or the official TIDAL OpenAPI can answer them. Before new TIDAL API probes, inspect the current official OpenAPI. User-entered/name-based search still uses HEOS; official TIDAL rich metadata is available once an exact Artist ID is known.

For touched JavaScript run `node --check`; before restart/commit run `git diff --check` and inspect the actual diff. HP `marantz-backend.service` is a system service; Pi `marantz-display.service` is a user service. Never touch `marantz-mic-stream.service`. Credentials stay outside Git in `/etc/marantz-backend/tidal.env`. Finish accepted checkpoints committed/pushed with blank `git status --short`.

<!-- TASK3_TIDAL_LANDING_MIXES_2026_09_16 -->
## 2026-09-16 — TIDAL landing / Mixes & Radio accepted

Task 3 of the post-catalogue UI/control phase is production-accepted. The Pi TIDAL landing page now has six local line-icon shortcuts: Playlists, Artists, Albums, Tracks, Mixes & Radio and Genres. Genres restores the existing HEOS/TIDAL genre browse surface and live testing returned artwork correctly. Videos were deliberately omitted.

Mixes & Radio is no longer built from the incomplete recommendations endpoints. The backend walks the official TIDAL saved playlist collection, bulk-loads playlist metadata, preserves relationship order and selects resources with `playlistType === "MIX"`. This is the canonical discriminator: do not use names, hard-coded IDs, HEOS subtraction or the old recommendation list. The 2026-09-16 acceptance snapshot was 53 saved playlist references and 19 MIX resources with zero unresolved metadata IDs; counts are snapshots, not constants. The collection naturally included My New Arrivals, Artist Radio, Track Radio, history/listening mixes, My Most Listened and My Mix 1–8.

The backend returns official TIDAL playlist artwork directly and the Pi renders that artwork without the old per-MIX enrichment requests. Existing official playlist-detail and TIDAL-to-HEOS resolver paths remain the playback mechanism. Touchscreen acceptance passed TRICKY Artist Radio browse, Turnip Farm Track Radio browse/playback, My Mix 8 playback and Genres artwork.

Canonical checkpoints: backend production `d075c78`, backend cleanup `5da1641`, backend documentation head before this roll-up `4ad1725`; companion Pi production `e98c1e1`, cleanup `d94b55d`, documentation `2530d9c`. Detailed record: `docs/TIDAL_MIXES_RADIO_2026-09-16.md`.

Current Queue, Now Playing favourite heart and TIDAL landing/Mixes & Radio are complete. **Next active task: richer Artist Page.** Now Playing Track Radio was discussed and deliberately left as a later task.


This is the authoritative short handover for current MarantzPi / HP backend TIDAL work. Do not restart the closed Birthday/replacement reconnaissance unless a later code change specifically invalidates the evidence below.

## Current direction

As of 14 Sep 2026, the official-TIDAL catalogue migration is production-accepted for **Favourite Tracks, Artists, Albums and ordinary My Music Playlists**. The governing architecture is still **official TIDAL API for what the user sees; HEOS for what the user hears**. Do not regress these screens to HEOS-led display browsing merely because HEOS remains the playback/drill-in transport.

Current accepted catalogue state:

- Favourite Tracks: 594 live official tracks; production endpoint `/api/tidal/favourite-tracks`; full continuous Pi list; existing individual actions plus PLAY ALL/SHUFFLE ALL retained.
- Artists: 393 official collection references, 392 live artist resources, one unresolved/stale reference (ID `32968323`); production endpoint `/api/tidal/favourite-artists`. The 392 live official IDs match the HEOS artist IDs after the stale reference is omitted.
- Albums: 1,535 official collection references and 1,535 matching HEOS album IDs; 1,482 live official album resources returned by the production rich-metadata loader, leaving 53 unresolved metadata resources. Three sampled unresolved IDs were individually confirmed as official 404s; do not claim all 53 were individually probed or individually proven stale. Production endpoint `/api/tidal/favourite-albums`.
- Artists/Albums preserve generated HEOS-compatible `LIBARTIST-<id>` / `LIBALBUM-<id>` CIDs, so the existing HEOS-backed artist→album and album→track drill-ins and playback paths remain unchanged. Live touchscreen acceptance proved Artist drill-in, Album drill-in, Album PLAY RANDOM and ordinary album-track PLAY NOW.
- Backend startup prewarm is deliberately sequential in the order **Artists → Albums → Favourite Tracks** and runs after HTTP listen. Each stage fails independently without preventing later stages.

- Ordinary Playlists: production endpoint `/api/tidal/favourite-playlists` uses the **live exact-ID intersection** of the official TIDAL user-playlist collection and HEOS ordinary `Created by me` / `Favorited` branches. At acceptance time this was 53 official references versus 34 HEOS ordinary playlists (13 Created by me + 21 Favorited), with 19 official-only personalised Mix/Radio resources and zero HEOS-only IDs. Do not hard-code the current 34 IDs or blacklist the current 19; the library is dynamic. Preserve HEOS grouping and exact `LIBPLAYLIST-*` CIDs while using official TIDAL metadata/artwork. USER and EDITORIAL playlist types are both valid. Live Pi acceptance proved both catalogue branches, rich artwork, HEOS-backed track drill-in, PLAY NOW, PLAY ALL and SHUFFLE ALL. See `docs/TIDAL_PLAYLISTS_2026-09-14.md`.

Current ordinary-Playlists checkpoints: backend production `43902d1 — Add official TIDAL ordinary Playlists catalogue`, backend cleanup `0f6bf7b — Remove ordinary Playlists migration helpers`, Pi production `d2f96e4 — Use official TIDAL ordinary Playlists UI`, Pi cleanup `1e810ed — Remove ordinary Playlists UI migration helper`.


## Current Queue — production accepted 15 Sep 2026

The read-only Current Queue stage is complete and live-tested on the Pi. Permanent checkpoints are Pi `41e8ab0 — Add read-only Current Queue API` and `1796f6c — Add read-only Current Queue UI`. The HP backend was deliberately not changed for this feature.

The Pi now exposes read-only `GET /api/queue`, reusing its existing HEOS queue reader and a current-media query. The normalized response contains physical queue count plus qid, mid, albumId, song, artist, album, imageUrl and current-row state. The Now Playing QUEUE button opens a dedicated CURRENT QUEUE screen; the current row is highlighted as NOW PLAYING. The UI refreshes `/api/queue` every 5 seconds only while open, stops on BACK, preserves manual scroll position during refresh, and centres the current row only on initial open. Live acceptance confirmed the highlight advances automatically on a natural track transition.

The key contract is **physical HEOS queue, not source/canonical length**. Favourite Tracks rolling playback was observed with 10 physical rows initially and 15 after the backend appended its next five-track batch. A user-created Chill Mix containing 125 source tracks exposed only 50 physical HEOS rows at that moment. My Mix 2 exposed 24 rows initially and later 40. Therefore the queue header reports exactly what HEOS currently materialises; never label a physical count as a source total or fabricate the unmaterialised remainder.

HEOS queue rows already provide artwork, title, artist, album, qid, mid and album_id, so the HP official TIDAL API is not required for this basic queue viewer. Current-media qid/mid matched the corresponding physical row throughout live tests. Retained queue/current-position state while the AVR is off or after leaving NET is intentional MarantzPi resume behaviour and must not be treated as stale merely because receiver power is off.

Queue viewing and queue mutation remain separate stages. No play-selected, remove, reorder, sort or clear controls were added. The user is currently satisfied with viewing and does not consider editing a priority. If mutation is revisited later, separately prove its interaction with ordinary HEOS playback, Favourite Tracks rolling playback and personalised/background queue builders; do not complicate or regress the accepted read-only viewer.

## Now Playing TIDAL favourite heart — production accepted 15 Sep 2026

Task 2 is complete. The Pi production checkpoint is `4e7743e`; backend production is pushed through `6c7e2fe`. The heart uses official TIDAL collection membership/writes only. Preserve known official `tidalTrackId` across our own TIDAL playback launch; otherwise treat HEOS `tidalMid` only as a candidate and require exact official metadata validation. Never use HEOS to reconcile favourite membership.

The write path no longer waits for the ~35 s canonical Favourite Tracks rebuild. Successful official mutation invalidates the canonical cache and records a two-minute single-track recent-mutation overlay. Status validates the official track first, then may answer from that overlay; expired entries fall through to the canonical collection. Full Favourite Tracks endpoints and rolling playback remain canonical and are not patched by the overlay. Controlled Aquarius add/remove tests passed at ~0.3 s writes and ~0.2 s immediate status checks, and Aquarius was restored to not-favourite.

Pi UI acceptance: heart is in the Now Playing progress area at right, `bottom:48px`; one SVG geometry is used for both states; non-favourite is grey outline `rgba(255,255,255,0.45)`; favourite is solid/stroked `#ff3b3b`. Heart sync is driven by the existing `render(data)` status cycle with no second `/api/status` poller.

## Immediate next-chat work — agreed order

Current Queue and the Now Playing favourite heart are complete. Resume with **Task 3** next; do not reopen either completed task without new evidence. Use GitHub for repository inspection and Termius only for runtime evidence/deployment checks that GitHub cannot provide.

1. **TIDAL landing/home artwork:** generic browse rows currently create an artwork slot even when the item has no image, producing blank boxes. For the TIDAL landing/category screen, either remove the empty artwork slot for those categories or deliberately supply appropriate imagery. Do not fabricate remote artwork URLs or regress working navigation.

2. **Richer artist page:** current HEOS-backed artist drill-in categories can likewise show blank generic artwork slots. Preserve those tested HEOS drill-ins/playback, but enrich the page with an official-TIDAL artist hero image and biography/description only if the developer API actually exposes supported fields/relationships. Research/probe read-only first; do not guess API shapes. Aim for a Roon/TIDAL-style header while keeping the existing Tracks/Albums/EPs/Other Albums/Similar routes working.

## Proactive architecture roadmap

The HP is deliberately an extensible local brain. `marantz-ai.service` (persistent llama.cpp/Qwen) is available beyond the current voice/intent classifier when AI genuinely improves the system. Future chats/developers should proactively identify and propose useful backend services, packages, diagnostics, storage, automation and AI capabilities rather than waiting for the user to suggest them, but must explain and obtain approval before installation or implementation.

Maintain the safety boundary: AI may interpret language/context, assist discovery and explain diagnostics; deterministic/fail-closed code remains authoritative for TIDAL-to-HEOS identity, AVR control and playback/queue mutation.

Active future opportunities to preserve across handovers are: a lightweight SQLite event/playback/command/resolver history store; a unified read-only system health/diagnostic snapshot; optional Current Queue mutation controls only if the user later wants them and only after separate queue-owner safety work; richer contextual voice follow-ups; AI-assisted diagnosis from structured evidence; discovery across TIDAL metadata, Discogs-derived collection data and playback history; and, only when justified by a concrete retrieval need, lightweight local embeddings/semantic search. These are roadmap items, not yet implemented features.

The architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**. Official TIDAL supplies personalised recommendations, canonical track/artist/album metadata, descriptions and artwork. HEOS/SR8015 remains playback transport. Existing HEOS browse/search routes remain available as fallback/diagnostic paths, but new catalogue UI should not regress to HEOS browsing when official metadata is available.

Official TIDAL catalogue text search is currently access-blocked for this developer app (400 Invalid resource ID despite read-only search scope). Direct TIDAL playback to the SR8015 is parked.

## Working method — mandatory for the next chat

The user works from an Android phone/tablet with Termius and is not a software developer. Long terminal pastes are error-prone and Android clipboard handling is a real constraint. Use one small, explicit step at a time, label the target machine **HP** or **Pi**, explain whether the step is read-only or mutating, and wait for pasted output before continuing. A blank terminal result is commonly reported as 👍🏻.

Prefer GitHub-side inspection and guarded migration helpers for source/document edits. The established safe pattern is: inspect the current branch in GitHub; add a small exact-guard helper; user runs a short `git pull`; run the helper locally; run syntax/diff checks; restart only the affected service; perform a narrow live acceptance test; inspect `git diff --check` and the exact diff; commit only accepted production files; remove the temporary helper in a separate cleanup commit; push; finish with blank `git status --short`. Do not ask the user to paste large source files or huge JSON blobs into Termius when GitHub can be inspected directly.

For runtime-only evidence that GitHub cannot provide, use compact terminal probes and summarise JSON with small `python3 -c` commands where useful. Avoid broad service restarts and never restart both Pi and backend merely for convenience. Pi display service is the user service `marantz-display.service`; backend is system service `marantz-backend.service`. The unrelated Pi `marantz-mic-stream.service` must not be touched during display work.

Never guess paths, owners, CIDs, player IDs, API fields or service names. Current backend constants in production source are AVR `192.168.50.220`, HEOS PID `48723103`, TIDAL HEOS SID `10`, HTTP port `3100`. Credentials remain outside Git in `/etc/marantz-backend/tidal.env`; do not print, move or commit them.

Do not mutate TIDAL favourites, playlists, queue or AVR state during reconnaissance unless the user explicitly agrees to a live mutation test. Protect the working TIDAL resume path, rolling Favourite Tracks queue, personalised resolver/background queue builder, ordinary playlist intersection, and literal-space `My Music-Tracks` HEOS CID rule.

Historical `ai/` and reconnaissance scripts remain in the backend repository as development evidence/tools. Do not mass-delete them merely to make the tree look cleaner. The important cleanliness rule is that temporary helpers for the current migration are removed after acceptance and production branches end with a clean working tree.

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

Backend pre-handover cleaned/pushed checkpoint: `b83b443 — Remove official TIDAL catalogue README updater`. The preceding permanent documentation checkpoint is `d3c247b — Document completed official TIDAL catalogue migration`.

Pi current tested/pushed production head before this documentation update: `1796f6c — Add read-only Current Queue UI`; its paired API checkpoint is `41e8ab0 — Add read-only Current Queue API`. Earlier tested UI checkpoints remain `36bd317 — Restore TIDAL browse with Now Playing swipe` and `84170a5 — Sort TIDAL Artists alphabetically`.

Ordinary Playlists remain production-checkpointed at backend `43902d1` / cleanup `0f6bf7b`, and Pi `d2f96e4` / cleanup `1e810ed`. Earlier Artists/Albums checkpoints remain `2ba75d0` backend production / `f4e1476` cleanup and `998589b` Pi production / `497e6a5` cleanup. Favourite Tracks rolling production remains `4d6da8c`, with ordinary-action fix `08a86ce`.

The Pi swipe-return acceptance is narrow and deliberate: TIDAL PLAY NOW / PLAY FROM HERE / PLAY ONLY arm a one-shot return from Now Playing to the preserved TIDAL browse screen. Manual TIDAL NOW PLAYING does not arm it. Swiping on a non-TIDAL MarantzPi input was live-tested and correctly did nothing. The external SR8015 HTTPS page retains native browser-back behaviour because MarantzPi JavaScript is not active there.

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

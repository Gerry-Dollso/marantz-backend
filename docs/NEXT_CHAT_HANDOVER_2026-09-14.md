# MarantzPi / HP backend — next-chat handover — 14 Sep 2026

Read this before touching either repository. The canonical detailed project handover remains `CURRENT_HANDOVER.md`; this file is the concise bridge from the completed catalogue/UI migration work into the next four tasks agreed with the user.

## Clean starting point

- Backend GitHub: `Gerry-Dollso/marantz-backend`, branch `local-ai-development`, pre-handover cleaned/pushed checkpoint `b83b443 — Remove official TIDAL catalogue README updater`. Runtime: HP media server, `/opt/marantz-backend`, system service `marantz-backend.service`, HTTP 3100.
- Pi GitHub: `Gerry-Dollso/marantzPI`, branch `housekeeping-2026-08-21`, final documentation-cleaned/pushed head `649b272 — Remove handover documentation updater`; pre-documentation tested cleanup checkpoint `1758311 — Remove TIDAL swipe return migration helper`. Runtime: `~/marantz-now-playing`, user service `marantz-display.service`, local UI `http://127.0.0.1:3000`.
- Latest tested Pi production changes: `84170a5 — Sort TIDAL Artists alphabetically`; `36bd317 — Restore TIDAL browse with Now Playing swipe`.
- Latest swipe acceptance: TIDAL playlist track -> PLAY NOW -> Now Playing -> swipe back restored the exact previous track list; a non-TIDAL input swipe correctly did nothing. Existing external SR8015 setup-page browser back remains untouched.

## Architecture that must not regress

Official TIDAL API is catalogue/display authority where available; HEOS/SR8015 is playback transport. Favourite Tracks, Artists, Albums and ordinary My Music Playlists are already migrated and accepted. Do not put those top-level screens back onto slow HEOS-led display browsing.

Favourite Tracks canonical display is 594 live official tracks. Rolling PLAY ALL/SHUFFLE ALL/PLAY FROM HERE is accepted: initial 10, low-water <5 ahead, replenish 5, persistent HEOS events, debounced reconciliation, bounded tail verification, external-queue fail-close and generation supersession. Ordinary Favourite Tracks actions require literal-space HEOS CID `My Music-Tracks`; `My%20Music-Tracks` fails.

Artists: 393 official references -> 392 live resources; one directly proven 404. Albums: all 1,535 relationship IDs match HEOS; 1,482 rich resources resolve, leaving 53 unresolved metadata resources; only three sampled unresolved IDs were individually proven 404. Ordinary Playlists are the live exact-ID intersection of official collection and HEOS Created by me/Favorited branches; no hard-coded playlist IDs or personalised blacklist.

Personalised My Mix/Radio uses a separate official-to-HEOS resolver and fast first-track/background queue architecture. The Sugarcubes — Birthday replacement case is closed evidence; do not reopen it for ordinary catalogue work.

## Working method

The user is operating through Termius on Android and has real clipboard/copy-paste constraints. Give one command at a time, explicitly label **HP** or **Pi**, explain what the command does and whether it mutates anything, and wait for the output. Prefer GitHub connector/source inspection and short guarded helper scripts over asking for long source pastes. Use GitHub to inspect the exact current branch before editing.

For edits, use the proven sequence: GitHub guarded helper -> short `git pull` -> run helper -> syntax check -> restart only the affected service -> narrow live test -> `git diff --check` + exact diff -> commit production file(s) -> remove helper in a cleanup commit -> push -> blank `git status --short`. Do not commit a feature until the user has live-tested and accepted it.

Do not guess. Current production backend constants are AVR `192.168.50.220`, HEOS PID `48723103`, TIDAL HEOS SID `10`. Backend credentials are outside Git and must remain there. Do not touch `marantz-mic-stream.service` during Pi display work.

Reconnaissance is read-only by default. Never add/remove TIDAL favourites, alter playlists, clear/reorder the HEOS queue, or change AVR state without explicit approval for that live mutation test.

## Next task 1 — Current Queue

Goal: a control/link on the Pi Now Playing screen opens a live Current Queue screen. The user ultimately wants to see the queue and be able to select, edit, reorder/sort and otherwise manage tracks.

Start read-only. The backend already calls HEOS `player/get_queue` internally for rolling Favourite Tracks verification and for selected-item handling, but there is no general user-facing queue endpoint/view. Establish exact queue paging/count/qid/mid behaviour first and determine the best metadata source for each row. Then design mutations. Any remove/move/clear/play-selected operation must coexist safely with the Favourite Tracks rolling session and personalised background queue builders; do not let UI edits race a builder or silently violate queue ownership. Consider explicit supersession/reconciliation semantics before enabling mutation.

## Next task 2 — Now Playing favourite heart

Goal: the heart shows whether the current canonical TIDAL song is in the user's favourites and can add/remove it.

First build/prove read-only membership. Do not mutate the real TIDAL library during discovery. Critically, do not assume the HEOS currently playing MID is always the canonical official TIDAL track ID: personalised/replacement playback can differ, as proven by Birthday. Work out how Now Playing retains or can recover the originating official track identity before mutation. When mutation is eventually accepted, use the official TIDAL collection API, confirm success, then invalidate/refresh the appropriate Favourite Tracks cache/UI state.

## Next task 3 — TIDAL landing blank artwork boxes

The generic Pi browse renderer always creates an artwork span; when a category has no image this renders as an empty box. On the TIDAL landing/home categories, either deliberately remove the artwork slot for categories with no art or provide appropriate deliberate imagery. Keep navigation unchanged. Inspect current `makeBrowseButton()`, landing item construction and `tidal-ui.css` before choosing the design.

## Next task 4 — richer artist page

Current artist drill-in is HEOS-backed and exposes categories such as Tracks, Albums, EPs/Singles, Other Albums and Similar. Those category rows can show the same blank generic artwork slot. The user wants a Roon/TIDAL-like page with artist image and biography plus better category presentation. Preserve the proven HEOS drill-in/playback routes. Research the official developer API read-only for artist hero/profile art and biography/description fields or relationships; do not invent fields. Then enrich the page around the existing deterministic HEOS CIDs.

## Recent Pi swipe implementation detail

`public/app.js` still traps browser history globally. `public/tidal-ui.js` now has a one-shot `tidalSwipeReturnArmed` flag. PLAY NOW / PLAY FROM HERE / PLAY ONLY arm it before TIDAL is hidden; a second `popstate` listener reopens TIDAL only when it is armed, TIDAL is hidden, Now Playing is visible and `latest.playbackSource === 'tidal'`. Opening TIDAL clears the flag. Manual NOW PLAYING does not arm it. Do not re-enable browser history globally.

## Source areas likely relevant next

Pi: `public/index.html` (Now Playing controls), `public/app.js` (status/render/browser history), `public/tidal-ui.js` and `public/tidal-ui.css` (TIDAL browse/screens), `server.js` (Pi proxy/API bridge), `public/screen-state.js` (screen visibility).

Backend: `server.js` (HEOS commands, queue builders and API routes), `tidal-user-auth-recon.js` (official user collection/catalogue access), `tidal-heos-resolver.js` / `tidal-heos-trusted-resolver.js` (personalised identity), `tidal-metadata-client.js` (official metadata), plus the dedicated TIDAL migration docs.

## Do not redo solved work

Do not redo Birthday/Early Alternative discovery, arbitrary numeric MID searching, TIDAL Connect queue probing, ISRC inference, or fuzzy candidate tie-breaking. Do not reintroduce HEOS paging for Favourite Tracks/Artists/Albums/ordinary Playlists. Do not change the accepted rolling Favourite Tracks architecture casually. Do not weaken AVR unknown-state handling or TIDAL resume protection. Do not mass-delete historical recon scripts; they are not current migration leftovers.

When the next chat begins, first inspect GitHub heads and the specific current source involved in Task 1. Do not start by editing code from memory.

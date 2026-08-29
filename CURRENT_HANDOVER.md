# Current handover — 29 Aug 2026

This file is the authoritative short handover for the active TIDAL/HEOS investigation. Read it before doing further reconnaissance. Do not repeat tests listed here unless a later code change specifically invalidates them.

## Strategic direction

The target architecture is **official TIDAL API for what the user sees; HEOS for what the user hears**. Official TIDAL API is the frontend/catalogue/discovery/metadata source. The HP backend resolves official TIDAL catalogue objects into HEOS-playable context. HEOS remains playback transport to the SR8015. Do not build new browse/frontend functionality around HEOS unless resolution/playback genuinely requires it.

Generic official-TIDAL queue machinery should eventually underpin Play All, Shuffle All and Play From Here, and later the migration of existing My Music screens away from HEOS browsing.

## Current production/repository state

Backend repo: `Gerry-Dollso/marantz-backend`
Branch: `local-ai-development`
Runtime path: `/opt/marantz-backend`
Service: `marantz-backend.service`
HTTP port: 3100
HEOS/SR8015: `192.168.50.220:1255`
HEOS player ID: `48723103`
TIDAL HEOS SID: `10`

The resolved personalised-playlist queue implementation was committed at `a30db56` (`Add resolved TIDAL personalised playlist playback`). Later 29 Aug commits added read-only reconnaissance/migration helpers. Before changing runtime code, inspect the current branch head and working tree.

## Personalised browse and playback already proven

Official personalised browse is live and proven:
- My Mix 1-8
- My Daily Discovery
- My New Arrivals
- rich ordered playlist pagination with artwork
- Pi My Mixes UI
- My Mix track actions Play Now, Play Next, Add End and Play Only through `/api/tidal/play-resolved`

Do not re-investigate whether these mixes exist or whether ordinary user-created TIDAL playlists are visible through HEOS.

## Play All / Shuffle All failure that led to the current investigation

`GET /api/tidal/personalised/playlist/play?id=<id>&shuffle=0|1` was implemented as a safe first version. It pre-resolves every playlist track before mutating the HEOS queue, then uses aid=4 for the first track and aid=3 for the rest. It deliberately fails closed on an unresolved/ambiguous track.

A live My Mix 1 Play All test took about **52.326 seconds** and failed safely at index 31 on The Sugarcubes — `Birthday`; nothing started playing. This exposed two separate problems:
1. catalogue identity/replacement for some personalised items;
2. unacceptable latency from pre-resolving an entire playlist through sequential live HEOS browse calls.

Do not treat the 52-second behaviour as acceptable. Likely future queue design is to resolve/start the first playable item promptly and continue resolving/appending in the background, retaining generation cancellation and safely skipping genuinely unresolved items. This is not yet implemented.

## The active hard case is The Sugarcubes — Birthday, NOT Interpol

The exact My Mix object returned by the official developer API is:

- track `34454218`
- album `34454215`
- artist `3519103`
- title `Birthday`
- artist `The Sugarcubes`
- album `Life's Too Good`
- ISRC `USEE18800001`
- duration `PT4M`

Direct official API probing proved `34454218` is a genuine TIDAL resource. It has `accessType: PUBLIC` but did not advertise `availability: STREAM` in the response we observed.

HEOS artist browsing exposed at least two playable `Life's Too Good` editions:
- `LIBALBUM-341262049` -> Birthday MID `341262056`
- `LIBALBUM-526377759` -> Birthday MID `526377765`

Both are genuine official TIDAL resources too, but have different ISRC/licensing metadata. Both advertise STREAM availability. Therefore ISRC does **not** solve this case and the resolver was correct to fail ambiguous rather than guess.

## Strong evidence for TIDAL's selected playable replacement

Two independent consumer-app observations point specifically to `341262056` / album `341262049` when the user selects the My Mix item represented to the developer API as `34454218`:

1. In the official Android TIDAL app, sharing the exact Birthday item from My Mix 1 produced TIDAL track ID **341262056**.
2. Starting that exact My Mix item through TIDAL Connect to the SR8015 produced HEOS Now Playing artwork path `4fe177f8/64f1/4b2b/8db7/92c43cb3a5fa`, which exactly matches official album **341262049**. TIDAL Connect itself exposed placeholder `mid=1` and `album_id=1`, so the Connect Now Playing response does not directly reveal track MID; the artwork proves the selected album edition, while Share supplies the exact track ID.

## Ordinary user playlist control already proven

The user's ordinary TIDAL playlist **Early Alternative** is visible through HEOS at:
`LIBPLAYLIST-d36d23dd-83d0-4312-9958-986b3964ec84`

Browsing it is already proven. It contains:
- Birthday — The Sugarcubes
- HEOS MID **341262056**
- HEOS album_id **341262049**
- artwork `4fe177f8/64f1/4b2b/8db7/92c43cb3a5fa/...`

This exactly matches the edition selected by TIDAL Share/TIDAL Connect evidence above. **Do not repeat tests asking whether Early Alternative exists in HEOS, whether user playlists are visible in HEOS, or whether Birthday is present in it. Those questions are closed.**

TIDAL Connect was also checked with `player/get_queue`; it played as a transient station-style session and did not replace the pre-existing normal HEOS queue. That avenue is also already understood.

## Replacement/equivalence investigation

The current goal is narrow: determine whether the official API gives us a deterministic programmatic way to map the personalised object `34454218` to the streamable consumer/HEOS object `341262056`, preferably through TIDAL's own replacement/media-substitution semantics rather than fuzzy matching.

The earlier guarded migration `ai/add-tidal-replacement-probe.js` initially failed safely because its exact anchor did not match. It made no runtime change. Subsequent 29 Aug work added read-only reconnaissance helpers/routes around replacement, playlist `replaceMedia`, artist metadata, provenance and shares. Inspect the current branch and actual live results before adding more probes. Do not switch the investigation to Interpol merely because Interpol was used previously as a search/control artist.

Important: documentation indicates TIDAL has media replacement concepts, but some replacement functionality is marked beta/internal. Treat access and exact semantics as something to prove with our authorized API, not as an assumed production contract.

## Resolver rules that remain valid

- Never assume official TIDAL track/album IDs universally equal HEOS IDs. Phantogram remains the counterexample.
- If a real candidate HEOS context exposes a playable MID exactly equal to the official track ID, that is deterministic identity in that context.
- Ambiguity fails closed; do not pick newest/oldest/first/popular-looking edition arbitrarily.
- Do not use ISRC as a universal equivalence key; Birthday proves consumer-equivalent catalogue editions can carry different ISRCs.
- Generic HEOS text search is catalogue evidence, not an identifier resolver. Numeric MID reverse-search and synthetic `SEARCHED_TRACKS-*` experiments were already closed.

## Performance rule

The reusable resolver currently performs live HEOS album browse even on many direct paths. That is why whole-playlist pre-resolution can take tens of seconds. Solving Birthday identity alone does not solve Play All latency. Preserve this as a separate engineering problem.

## Working discipline

User works through Termius on Android. Avoid large multiline terminal pastes. Prefer guarded GitHub migration helpers and short commands. Before playback/queue/source mutation, explicitly say it will affect playback. For read-only HEOS/API probes, say they are read-only. Always inspect branch/status/current code before modifying it. Run `node --check` and `git diff --check`, inspect the diff, then restart/test. Never commit TIDAL secrets or refresh/access tokens.

# TIDAL Favourite Tracks — official API / TIDAL UI / HEOS discrepancy

Date: 2026-09-07

This document records the read-only reconnaissance performed before migrating MarantzPi `TRACKS` / Favourite Tracks from HEOS-backed display data to official TIDAL metadata. Preserve these findings so future work does not repeat the investigation or mistake the HEOS representation for the user's real visible TIDAL collection.

## Architecture context

The target architecture remains:

- **official TIDAL API = what the user sees / rich catalogue metadata**
- **HEOS = what the user hears / SR8015 playback transport**
- identity and playback correlation must remain deterministic and fail closed; AI/fuzzy matching must not invent track identity.

Unlike personalised My Mixes, Favourite Tracks is directly exposed by HEOS as `My Music-Tracks`. This should be exploited for deterministic playback context, but the HEOS browse representation must not automatically be treated as authoritative display/catalogue data.

## Observed live collection counts

Read-only probes and direct inspection established three different views of the same Favourite Tracks collection:

### TIDAL consumer UI

The user's TIDAL Favourite Tracks screen visibly contains **594 tracks**. The final visible item is numbered 594.

### Official TIDAL user-collection API

The relationship endpoint returned **635 unique saved track references** across 32 pages:

- 594 IDs are current/live track resources.
- 41 IDs are stale/historical references for which current `/tracks/<id>` lookup returned HTTP 404 in the reconnaissance sample/probe.
- the official relationship itself contained no duplicate IDs in this 635-reference snapshot.

### HEOS `My Music-Tracks`

HEOS returned and the official HEOS app visibly displayed **635 rows**, but only **594 unique MIDs**:

- 594 unique HEOS MIDs correspond to the 594 live/current official TIDAL IDs.
- there are 41 excess HEOS row occurrences.
- 40 HEOS MIDs occur more than once; 39 occur twice and one MID occurs three times, producing 41 excess occurrences in total.
- `heosUniqueOnlyCount` was zero: HEOS did not expose a separate set of 41 old/stale unique MIDs.

## Strong deterministic ordering result

The decisive read-only comparison was:

1. remove the 41 stale/404 references from the 635 official TIDAL relationship;
2. deduplicate the 635 HEOS rows by MID, retaining first-occurrence order.

Both sides then contain **594 IDs and the two 594-ID sequences are exactly identical in order** (`dedupedSameOrder: true`).

This is much stronger than a title/fuzzy match and is the main reason the 594 live official IDs are the correct candidate set for the new Favourite Tracks display path.

## HEOS repeated-block behaviour is real and is not MarantzPi code

The user inspected Favourite Tracks directly in the official HEOS mobile app. HEOS reports 635 tracks and visibly contains repeated contiguous blocks. The same repeated rows were present in raw HEOS reconnaissance, so this behaviour is upstream of MarantzPi and is not introduced by the Pi/backend UI code.

Examples observed in the HEOS app / raw HEOS data include repeated sequences such as:

- `1969` → `I Like It` → `Mother Mary` → `Son of a Gun`
- `Pretty In Pink` → `She Sells Sanctuary` → `The Passenger`
- `What Needs Must Be` → `Loss Leader`
- `Sweet Young Thing Ain't Sweet No More` → `Salad Days` → `Used For Glue`
- `Winn Coma` → `Rule the Beast` → `Ski Bunny` → `Don't Want to Know If You Are Lonely`
- `Cut Your Hair` → `The Reproduction Of Death` → `Green Machine`
- a longer block containing `Creepy Jackalope Eye`, `Behemoth`, `Born Slippy`, `Try Honesty`, `Bastards of Young` and `Sweet Dreams`.

The repeated HEOS entries are playable. The TIDAL consumer Favourite Tracks UI does **not** show these HEOS-style repeated blocks and reports 594 tracks rather than 635.

## What is proven vs inferred

### Proven by observation/probes

- TIDAL consumer UI: 594 visible Favourite Tracks.
- Official collection relationship: 635 unique references in the captured snapshot.
- 594 official IDs are live/current; 41 captured relationship IDs are stale/404 under current track lookup.
- HEOS: 635 rows, 594 unique MIDs, 41 excess duplicate occurrences.
- every unique HEOS MID belongs to the 594 live official-ID set.
- after stale-reference removal / HEOS deduplication, the same 594 IDs remain in exactly the same order.
- official HEOS app itself displays the repeated-block behaviour, independently of MarantzPi.
- repeated HEOS rows can play.

### Plausible but NOT proven internally

A strong working hypothesis is that historical/unavailable saved references remain in an underlying TIDAL collection relationship, while TIDAL's consumer Favourite Tracks UI suppresses them. HEOS appears to mishandle that state and emits repeated current/playable rows rather than suppressing the obsolete references.

Do **not** document as fact that HEOS "saved both old and new IDs" or that a particular stale TIDAL ID maps to a particular repeated HEOS MID. The data does not show 41 old unique MIDs in HEOS, and anchor-gap analysis did not establish local 1:1 stale-to-duplicate mappings.

## Failed/closed positional-mapping idea

A shared-anchor gap probe tested whether each stale official reference could be paired positionally with a repeated HEOS row between the same neighbouring live IDs. It did **not** support that model:

- official stale total: 41
- HEOS excess duplicate total: 41
- gap totals account for all 41 on both sides
- local gap counts do not align
- `exactStructuralAlignment: false`

The repeated HEOS rows often occur in blocks at different positions from the stale official references. Do not infer stale-ID replacement mappings from raw row position.

## Production design consequence for Favourite Tracks

Do **not** reproduce the raw 635-row HEOS Favourite Tracks browse result on MarantzPi.

The intended display target is the same **594 current tracks visible in TIDAL**, using official TIDAL metadata. HEOS remains the playback transport and direct library context.

Candidate flow:

```text
Official TIDAL Favourite Tracks relationship
        ↓
resolve/filter to current live track resources
        ↓
594 current official track IDs + rich metadata
        ↓
validate against directly exposed HEOS My Music-Tracks identity/context
        ↓
MarantzPi displays the 594-track TIDAL-equivalent collection
        ↓
HEOS performs playback
```

Because the 594 current official IDs already correspond to the 594 unique HEOS MIDs in identical order, Favourite Tracks should not require the expensive My-Mix trusted replacement resolver for normal current tracks. Preserve deterministic validation and fail closed if this invariant is not satisfied after a collection change.

The old HEOS browse/cache path should remain available as playback context, fallback/correlation evidence and diagnostics even after the display/catalogue path moves to official TIDAL.

## Playback implications

The existing HEOS `My Music-Tracks` playback machinery currently operates on the raw HEOS collection. Migration must review PLAY ALL / SHUFFLE ALL / PLAY FROM HERE semantics so the new UI does not silently reintroduce HEOS's repeated rows.

For the new 594-track display, duplicate-row occurrence identity should not be needed if each displayed current track is represented once. Individual playback can use the validated official ID / HEOS MID relationship and known `My Music-Tracks` context.

Preserve the critical HEOS CID rule: use literal-space `My Music-Tracks`, not `My%20Music-Tracks`, when constructing HEOS browse/add-to-queue commands.

## Next read-only validation before production implementation

Before changing production routes/UI, perform one final read-only comparison of the 594 live official records against the 594 deduplicated HEOS records, including at least:

- track ID / HEOS MID
- title
- artist
- album where available
- ordering

The goal is to verify row-for-row identity with rich metadata, not merely ID-set equality. If that passes, design the production official-TIDAL Favourite Tracks endpoint and its caching/pagination strategy.

Do not modify/delete the user's TIDAL favourites as part of this investigation; the 594-track consumer collection appears correct and the malformed 635-row representation is visible independently in HEOS.
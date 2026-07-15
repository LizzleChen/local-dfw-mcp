# Local DFW MCP — Geographic Coverage

## Core counties

| County | FIPS | Covered by |
|---|---|---|
| Dallas | 48113 | all county/statewide tools |
| Tarrant | 48439 | all county/statewide tools |
| Collin | 48085 | all county/statewide tools |
| Denton | 48121 | all county/statewide tools |

## City-scoped tools — City of Dallas ONLY

`dfw_311` and `dfw_crime`'s default/Dallas path query City of Dallas Open Data.
They enforce a pre-flight jurisdiction guard ("no wrong-city silent success"):

1. **Explicit `city` parameter** — pass `city: "dallas"` to override detection.
2. **Fast string layer** — ZIP table + city keywords. A clearly non-Dallas
   address (Fort Worth, Plano, Frisco, Arlington, Irving, Garland, Mesquite,
   McKinney, Denton, ...) is refused immediately with an explicit
   "Not covered" message. No best-effort query is run.
3. **Ground truth** — U.S. Census geocode → point-in-polygon against the City
   of Dallas city-limits ArcGIS layer. Postal "Dallas, TX" is NOT the same as
   City of Dallas jurisdiction (e.g. 75287 addresses can be in Collin County;
   Garland/Irving/Mesquite are Dallas County but not City of Dallas).

If the city cannot be detected at all (no ZIP/keyword, geocoder blip), the tool
proceeds as City of Dallas but prefixes the response with an explicit
"Assuming City of Dallas" note and how to override.

`dfw_crime` additionally supports `city: "fortworth"` (v0.2) and
`city: "denton"` (v0.3) -- see below. Both are EXPLICIT-only overrides: they
are never auto-detected from an address (a Fort Worth or Denton address
without the matching `city` value is still refused by the Dallas path with a
"not covered" message, same as any other non-Dallas address). Neither Fort
Worth nor Denton has its own ground-truth city-limits polygon (only Dallas
does) -- routing for those two is decided entirely by the explicit `city`
argument.

## City-scoped tools — Fort Worth + McKinney + Arlington (v0.2 / v0.3)

`dfw_permits`, `dfw_code_cases`, and `dfw_crime`'s `city: "fortworth"` /
`city: "denton"` branches query City of Fort Worth / McKinney / Arlington /
Denton Open Data. Dallas is deliberately NOT wired for permits/code-cases
(Dallas's permit feeds are stale/dead and its code-case publication stalled
2025-01-31 -- see `dfw://datasets/index`); any `city` value other than the
wired ones (including `"dallas"`) is refused with an explicit "not covered"
message, never a best-effort query.

- **`dfw_permits`** — Fort Worth addresses are **componentized upstream**
  (`Addr_No` / `Street_Name` / `Street_Suffix` — there is no single situs
  string field; `Full_Street_Address` is usually null). Search with `street`
  (contains-match on `Street_Name`) + optional `addr_no` (exact match), never
  a one-line address. **McKinney (`city: "mckinney"`, v0.3)** queries
  McKinney's Energov Records layer (permits + plans in one layer, always
  filtered to `MODULE='PERMIT'`) and has **NO DATE FIELD AT ALL** — `address`
  is therefore **REQUIRED** for `city: "mckinney"` (contains-match on
  `ENT_MA1`; there is no newest-first browsing/listing there), `since_date`
  is accepted but ignored with a note, and results are ordered by
  `ENT_NUMBER DESC`, which only roughly groups recent cases (the year-month
  is embedded in the case-number prefix, e.g. `"COM2026-07-00990"`) — not a
  true chronological sort. The "filed" date surfaced to users is parsed from
  the case number and labeled "filed (from case number)", never implied to
  be an authoritative date. **Arlington (`city: "arlington"`, v0.3)** queries
  Arlington's Issued Permits layer; `FOLDERNAME` IS a single string address
  (like McKinney, unlike Fort Worth). Issued permits only — a separate,
  smaller Permit Applications layer exists upstream but is deliberately not
  wired (see `dfw://datasets/index`).
- **`dfw_code_cases`** — Fort Worth's `Violation_Address` IS a single string
  field (not componentized), so a normal contains-match address filter works.
  **McKinney (`city: "mckinney"`, v0.3)** queries McKinney's Code Enforcement
  Cases layer (on McKinney's on-prem ArcGIS server, same risk profile as Fort
  Worth's on-prem twin); its `Address` field is also a single string.
  **Arlington (`city: "arlington"`, v0.3)** queries Arlington's Code
  Complaint layer (also on-prem, also a single `FOLDERNAME` string address);
  its case-created/case-closed dates (`INDATE`/`FINALDATE`) map to
  `created`/`closed`, and its genuine last-modified field
  (`LastUpdateAmanda`) maps to `updated` — mirroring the created/closed/
  updated separation fixed for McKinney (a close date must never be
  mislabeled "updated"). Arlington publishes no public case-ID field — the
  internal ArcGIS row ID is surfaced labeled as an internal ID. Same FCRA
  "not a consumer report" notice for all three cities.
- **`dfw_crime` (`city: "fortworth"`)** — queries the City of Fort Worth
  Police Crime Data ArcGIS layer instead of Dallas's Socrata dataset; same
  block-level-address shape, FCRA notice, and "at least one of address/offense"
  requirement as the Dallas path.
- **`dfw_crime` (`city: "denton"`, v0.3)** — queries Denton's CKAN
  `denton-crime-data` datastore resource via `datastore_search_sql` (ILIKE
  contains-matching on `Public_Address` / `Crime`, string-compare on the
  zero-padded `"Date/Time"` text field). Covers 2019-11-06 → present, Denton
  PD. Addresses are block-level and often house-number-free upstream (e.g.
  `"MORSE ST DENTON TX "`). Same FCRA notice and "at least one of
  address/offense" requirement as the other branches.

## Events (`dfw_events`)

Two tiers, merged soonest-first:

| Tier | Coverage | Key |
|---|---|---|
| Official city calendars (CivicPlus RSS) | Dallas (**Parks & Recreation calendar only** — no citywide Dallas feed exists), Garland, Frisco, Mesquite, McKinney (added v0.3) | none |
| Commercial events (Ticketmaster Discovery) | concerts / sports / theater, whole metroplex (DMA 222) | `DFW_TICKETMASTER_API_KEY` (free) |

No calendar feed exists (verified 2026-07-07) for Plano (different CMS),
Irving (redirect + 403), Fort Worth and Arlington (bot-blocked). Say
"not covered" for those cities' official calendars rather than guessing.

## Traffic (`dfw_traffic`)

Four sources, each with **different** coverage -- do not blur them:

| Kind | Coverage | Source |
|---|---|---|
| `incidents` | **Fort Worth ONLY** -- no other DFW city publishes a keyless live incident feed | City of Fort Worth "Current Traffic Accidents" (ArcGIS, small rolling table) |
| `closures` | **Dallas + Arlington** (v0.3), merged by default and labeled per-result with `city` | City of Dallas right-of-way (ROW) permits (Socrata, line + point permits merged) + City of Arlington ROW Permits Issued (ArcGIS, on-prem) |
| `counts` | Dallas, Tarrant, Collin, Denton counties | TxDOT 5-Year Statewide AADT Traffic Counts (ArcGIS). No road-name field -- `search` is ignored with a note. |
| `projects` | Dallas, Tarrant, Collin, Denton counties | TxDOT Projects Info (ArcGIS). `search` matches the highway number (`HWY_NBR`). |

`kind="incidents"` with `city` set to anything but `"fortworth"`, or
`kind="closures"` with `city` set to anything but `"dallas"`/`"arlington"`,
returns a "not covered" response instead of a best-effort (and misleading)
query — the same "no wrong-city silent success" rule used by
`dfw_311`/`dfw_crime`. Default `kind="all"` merges incidents + closures only
(now including both closures cities); `counts`/`projects` need an explicit
`kind`.

**Arlington closures caveat (live-verified 2026-07-15):** `ProjectStart`/
`ProjectEnd` are the SCHEDULED work window and are often forward-dated months
into the future — presented as the closure window, never as a staleness
signal. `UpdatedInGIS` looks like a per-record freshness field but turned out
to be a whole-table batch-sync timestamp (all 23,971 rows fall inside a
~20-second window) — surfaced as informational `updated` but NOT used for
sorting. This layer has no created/issued-date field at all, so the merge/
sort key is instead derived from the `Permit` ID's embedded year+sequence
(`"YYYY-NNNNNN-ROW"`), which does increase monotonically with filing order —
the same fallback pattern `dfw_permits`' McKinney branch already uses
(`ENT_NUMBER DESC`) when no date field exists. See `lib/sources.js`
`arlingtonRowPermits` and `resources/datasets-index.md` for the full
reasoning.

## County / statewide / national tools

| Tool | Coverage |
|---|---|
| `dfw_fema_flood` | national (FEMA NFHL) |
| `dfw_tea_schools` | all Texas (TEA); filter by DALLAS / TARRANT / COLLIN / DENTON county |
| `dfw_nws_alerts` | national (NWS); defaults to downtown Dallas |
| `dfw_utility_providers` | all Texas (PUC CCN boundaries) |
| `dfw_district_lookup` | county + ISD statewide; council district City of Dallas only |
| `dfw_appraisal` | Texas statewide (TxGIO StratMap); DFW's 4 core counties verified on the 2025 certified roll. Address-first (geocode → parcel identify); no owner-name/free-text search |

## Not covered yet

- **Dallas building permits**: every current City of Dallas permit feed is
  ~20 months stale — not wired. `dfw_permits` ships Fort Worth + McKinney +
  Arlington (v0.2 / v0.3). See `dfw://datasets/index`.
- **Dallas code-compliance cases**: newest Dallas dataset stale since
  2025-01-31 — not wired. `dfw_code_cases` ships Fort Worth + McKinney +
  Arlington (v0.2 / v0.3).
- **Irving**: NOT wireable today. Residential/commercial permits, code
  violations, and police incidents all froze around 2025-02-28 (or earlier)
  with no successor dataset; events RSS is Akamai bot-blocked (403). Revisit
  if/when Irving resumes publication.
- **Plano**: has NO live record-level data — its Socrata code-enforcement
  datasets froze 2026-03 (see `dfw://datasets/index`). Not wired.
- **Arlington Permit Applications**: a separate, smaller layer (426 rows at
  verification) covering in-process applications rather than issued permits
  — deliberately left out of `dfw_permits`' contract (issued permits only,
  matching Fort Worth/McKinney). See `lib/sources.js`
  `arlingtonPermitApplications`.
- **Arlington events calendar**: still bot-blocked (403) — `dfw_events` has
  no Arlington coverage (permits/code-cases/traffic closures are wired,
  events are not).
- **Frisco city portal (permits/code/crime)**: not yet built (Frisco is
  covered today only by its `dfw_events` calendar).
- **Composed `dfw_property_360`**: still to come.

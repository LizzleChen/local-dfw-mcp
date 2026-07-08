# Local DFW MCP — Geographic Coverage

## Core counties

| County | FIPS | Covered by |
|---|---|---|
| Dallas | 48113 | all county/statewide tools |
| Tarrant | 48439 | all county/statewide tools |
| Collin | 48085 | all county/statewide tools |
| Denton | 48121 | all county/statewide tools |

## City-scoped tools — City of Dallas ONLY

`dfw_311` and `dfw_crime` query City of Dallas Open Data. They enforce a
pre-flight jurisdiction guard ("no wrong-city silent success"):

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

## Events (`dfw_events`)

Two tiers, merged soonest-first:

| Tier | Coverage | Key |
|---|---|---|
| Official city calendars (CivicPlus RSS) | Dallas (**Parks & Recreation calendar only** — no citywide Dallas feed exists), Garland, Frisco, Mesquite | none |
| Commercial events (Ticketmaster Discovery) | concerts / sports / theater, whole metroplex (DMA 222) | `DFW_TICKETMASTER_API_KEY` (free) |

No calendar feed exists (verified 2026-07-07) for Plano (different CMS),
Irving (redirect + 403), Fort Worth and Arlington (bot-blocked). Say
"not covered" for those cities' official calendars rather than guessing.

## Traffic (`dfw_traffic`)

Four sources, each with **different** coverage -- do not blur them:

| Kind | Coverage | Source |
|---|---|---|
| `incidents` | **Fort Worth ONLY** -- no other DFW city publishes a keyless live incident feed | City of Fort Worth "Current Traffic Accidents" (ArcGIS, small rolling table) |
| `closures` | **Dallas ONLY** | City of Dallas right-of-way (ROW) permits (Socrata, line + point permits merged) |
| `counts` | Dallas, Tarrant, Collin, Denton counties | TxDOT 5-Year Statewide AADT Traffic Counts (ArcGIS). No road-name field -- `search` is ignored with a note. |
| `projects` | Dallas, Tarrant, Collin, Denton counties | TxDOT Projects Info (ArcGIS). `search` matches the highway number (`HWY_NBR`). |

`kind="incidents"` with `city` set to anything but `"fortworth"`, or
`kind="closures"` with `city` set to anything but `"dallas"`, returns a
"not covered" response instead of a best-effort (and misleading) query — the
same "no wrong-city silent success" rule used by `dfw_311`/`dfw_crime`. Default
`kind="all"` merges incidents + closures only; `counts`/`projects` need an
explicit `kind`.

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

- **Building permits** (`dfw_permits`): not shipped — every current City of
  Dallas permit feed is ~20 months stale. See `dfw://datasets/index`.
- **Code compliance cases**: deferred — newest Dallas dataset stale since
  2025-01-31.
- **Fort Worth / Arlington / Plano / Frisco city portals**: v0.2.
- **Composed `dfw_property_360`**: v0.2.

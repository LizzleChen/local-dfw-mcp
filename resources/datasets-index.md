# Local DFW MCP — Dataset Catalog

Registry of every upstream this MCP talks to. Most `verified` entries were
confirmed with a live query on 2026-07-06/07/08; the Fort Worth permits/code
violations/crime entries (`dfw_permits`, `dfw_code_cases`, `dfw_crime`'s
`city="fortworth"` branch) were confirmed live on 2026-07-14; the McKinney
permits/code-cases entries and the Denton crime (CKAN) entry were confirmed
live on 2026-07-15. Machine-readable twin: `lib/sources.js`.

## Shipped (verified)

| Tool | Source | ID / layer | Freshness evidence (2026-07-06) |
|---|---|---|---|
| `dfw_311` | Dallas Open Data (Socrata) | `d7e7-envw` — "311 Service Requests October 1, 2020 to Present" | max `created_date` = 2026-07-05 (updated daily). Identical-schema sibling: `gc4d-8a49`. |
| `dfw_crime` | Dallas Open Data (Socrata) | `qv6i-rri7` — "Police Incidents" | max `date1` = 2026-07-05 (updated daily). Addresses block-level (privacy-rounded upstream). |
| `dfw_tea_schools` | data.texas.gov (Socrata) | `nui6-x374` — Statewide Accountability Ratings 2022-2023 | 10,292 rows; latest published ratings year is 2022-23. AskTED `hzek-udky` exists but its current publication is district-level, so the campus-directory join was dropped for v0.1. |
| `dfw_fema_flood` | FEMA NFHL (ArcGIS) | `hazards.fema.gov/.../NFHL/MapServer` layer 28 | service metadata OK; national coverage. |
| `dfw_nws_alerts` | NWS API | `api.weather.gov/alerts/active?point=...` | live TX alerts query OK. |
| `dfw_utility_providers` | Texas PUC CCN (ArcGIS, owner `gis.user.puct`) | Water `Water_CCN_Service_Areas/FeatureServer/210`, Sewer `Sewer_CCN_Service_Areas/FeatureServer/230` on services6.arcgis.com | PIP at a Frisco point returned `CITY OF FRISCO` (CCN 11772); 34 water polygons in Dallas County. Note: dense urban cores served directly by a city utility may return no CCN polygon. |
| `dfw_district_lookup` | Dallas GIS + statewide ArcGIS | Council: `CouncilAreas/FeatureServer/0` (services2.arcgis.com/rwnOSbfKSwyTBcwN); City limits: `CityLimits/FeatureServer/0` (same org); Counties: TPP_GIS `Texas_County_Boundaries/FeatureServer/0`; ISDs: TEA `Districts1920/FeatureServer/0` | PIP at 1500 Marilla St returned District 2 / Jesse Moreno and CITY=Dallas. |
| `dfw_appraisal` | TxGIO StratMap Land Parcels (ArcGIS) — county appraisal-district (CAD/CAMA) data republished by the Texas Geographic Information Office | `feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0` | See detailed evidence below. |
| — geocoding | U.S. Census geocoder | `geocoding.geo.census.gov` | 1500 Marilla St resolved OK. |
| `dfw_events` (tier 1) | CivicPlus calendar RSS (`/RSSFeed.aspx?ModID=58&CID=All-calendar.xml`) | `dallasparks.org` (Dallas Parks & Rec — **no citywide Dallas feed exists**), `garlandtx.gov`, `friscotexas.gov`, `cityofmesquite.com` | All four verified live 2026-07-07 (HTTP 200; 10-105 KB; populated `calendarEvent:*` tags, stable `Calendar.aspx?EID=` links). Probed and rejected: Irving (redirect → 403), Plano (different CMS), Fort Worth + Arlington (bot-block 403). CMS feeds churn — all four are in `dfw_health`. |
| `dfw_events` (tier 2) | Ticketmaster Discovery API | `app.ticketmaster.com/discovery/v2/events.json`, DMA 222 (Dallas-Fort Worth) | Optional `DFW_TICKETMASTER_API_KEY` (free, 5000 calls/day / 5 rps); keyless installs get city calendars + a hint. Every event links its ticketmaster.com page (attribution). Commercial ToS: personal/non-resale API use — re-read terms before any hosted redistribution. |
| `dfw_traffic` (incidents) | City of Fort Worth Open Data (ArcGIS) | `CFW_Current_Traffic_Accidents/FeatureServer/0` (services5.arcgis.com/3ddLCBXe1bRt7mzj) | Live-verified 2026-07-08: `UpdateTime` matched same-day; small rolling table (4 active records at verification time). Fort Worth only. |
| `dfw_traffic` (closures) | Dallas Open Data (Socrata) | `xd3q-ipis` (line/block-range ROW permits), `bw6g-a3ur` (point/address ROW permits) | Live-verified 2026-07-08: both return current (2026) `createddate` rows. Dallas only. See detail below — these are NOT the plan doc's original IDs. |
| `dfw_traffic` (counts) | TxDOT Open Data (ArcGIS) | `TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0` (services.arcgis.com/KTcxiTD9dsQw4r7Z) | Live-verified 2026-07-08: 3210 Dallas-county records, `LATEST_AADT_YR` 2025. County field `CNTY_NM` is title case. No road-name field. |
| `dfw_traffic` (projects) | TxDOT Open Data (ArcGIS) | `TxDOT_Projects_Info/FeatureServer/0` (services.arcgis.com/KTcxiTD9dsQw4r7Z) | Live-verified 2026-07-08: non-zero records in all 4 core counties (419 Dallas, 282 Tarrant, 298 Collin, 234 Denton). `COUNTY_NAME` is title case; `HWY_NBR` is a usable free-text search field. |
| `dfw_permits` (Fort Worth-first, v0.2) | City of Fort Worth Open Data (ArcGIS) | `CFW_Open_Data_Development_Permits_View/FeatureServer/0` (services5.arcgis.com/3ddLCBXe1bRt7mzj) | Live-verified 2026-07-14: 1,600,274 rows, newest `File_Date` same-day (2026-07-14). Fort Worth only; Dallas remains stale/unwired (see below). |
| `dfw_code_cases` (Fort Worth-first, v0.2) | City of Fort Worth Open Data (ArcGIS) | `CFW_Open_Data_Code_Violations_Table_view/FeatureServer/0` (services5.arcgis.com/3ddLCBXe1bRt7mzj) | Live-verified 2026-07-14: 65,718 rows, newest `Case_Created_Date` 2026-06-16. Fort Worth only; Dallas remains stalled/unwired (see below). |
| `dfw_crime` (`city="fortworth"`, v0.2) | City of Fort Worth Open Data (ArcGIS) | `CFW_Open_Data_Police_Crime_Data_Table_view/FeatureServer/0` (services5.arcgis.com/3ddLCBXe1bRt7mzj) | Live-verified 2026-07-14: 1,449,465 rows, newest `Reported_Date` 2026-07-12. Explicit-`city`-only branch alongside the unchanged Dallas default. |
| `dfw_code_cases` (`city="mckinney"`, v0.3) | City of McKinney Open Data (ArcGIS, on-prem) | `MapServices/CodeServices/MapServer/1` ("Code Enforcement Cases") (maps.mckinneytexas.org) | Live-verified 2026-07-15: 166,053 rows, max `OpenDate` 2026-07-14. Address is a single string field. |
| `dfw_permits` (`city="mckinney"`, v0.3) | City of McKinney Open Data (ArcGIS, on-prem) | `MapServices/EnergovRecords/MapServer/0` ("Energov Records") (maps.mckinneytexas.org) | Live-verified 2026-07-15: 328,308 rows, live through the current month (2026-07 case numbers) but NO date field — `address` required, see detail below. |
| `dfw_crime` (`city="denton"`, v0.3) | City of Denton Open Data (CKAN, OpenGov-managed) | `denton-crime-data` package, datastore resource `34f60f26-b458-48d0-9e40-d4f83fee3563` (data.cityofdenton.com) | Live-verified 2026-07-15: 77,979 records, 2019-11-06 → present, max `"Date/Time"` = `"2026-07-14 16:45"`. |
| `dfw_events` (tier 1, McKinney, v0.3) | CivicPlus calendar RSS | `mckinneytexas.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml` | Live-verified 2026-07-15: HTTP 200, 41 items, same CivicPlus labeled description fields as the other feeds. |

### `dfw_appraisal` — TxGIO StratMap Land Parcels (verified 2026-07-07)

The State of Texas (TxGIO) republishes county appraisal-district (CAD/CAMA) data
statewide under a standardized schema. This unblocks the previously-deferred
`dfw_parcels` work without ever touching the DCAD/TAD portals.

- **Endpoint:** `feature.geographic.texas.gov/arcgis/rest/services/Parcels/`
  `stratmap_land_parcels_48_most_recent/MapServer/0` — public, keyless.
- **Access shape (dictates the design):** the `/query` operation is **DISABLED**
  on the public layer (`400 "requested capability is not supported"`); the
  vintage-named twins (`stratmap23/24/25_...`) are token-gated. Only MapServer
  **`/identify`** works keyless. So the tool is address-first by construction
  (Census geocode → identify), with **no owner-name / free-text search** — a
  deliberate people-search-misuse reduction.
- **identify params (all required):** `geometry=lng,lat`,
  `geometryType=esriGeometryPoint`, `sr=4326`, `layers=all:0`, `tolerance` (1–2),
  `mapExtent` (small bbox around the point), `imageDisplay=400,400,96`,
  `returnGeometry=false`, `f=json`.
- **Payload quirk:** every attribute value comes back as a **STRING under
  UPPERCASE keys**; blank fields are whitespace-padded (`" "`). Normalized in
  `tools/property/dfw-appraisal.js`.
- **Sample (Dallas City Hall, `-96.7970,32.7767`):** `PROP_ID
  00000101154000000`, `OWNER_NAME "DALLAS CITY OF"`, `LAND_VALUE 32032500`,
  `IMP_VALUE 8420`, `MKT_VALUE 32040920`, `SITUS_ADDR "1400 YOUNG ST ,DALLAS, TX
  75201"`, `SOURCE "DALLAS APPRAISAL DISTRICT"`, `DATE_ACQ 20250801`, `COUNTY
  DALLAS`, `FIPS 48113`, `TAX_YEAR 2025`.
- **All 4 core counties verified, all `TAX_YEAR 2025`** (current certified roll):
  Dallas (`DATE_ACQ` 2025-08-01), Tarrant (2025-07-01), Collin (2025-01-01),
  Denton (2025-01-01); each `SOURCE` = the county's appraisal district.
- **Value quirk:** some Tarrant parcels publish `MKT_VALUE` (or LAND/IMP) as `0`
  (TAD publication quirk) — the tool renders these as "value unavailable", never
  as `$0`. `YEAR_BUILT` is often blank.
- **Caveats encoded in output:** 2025 certified roll is an annual snapshot (not
  live); **appraised value ≠ tax bill** (exemptions/rates come from the county
  tax assessor-collector, not this layer); FCRA "not a consumer report" notice.
- **`copyrightText`:** "Texas Geographic Information Office, Various Counties,
  Various Vendors" → attributed as TxGIO StratMap Land Parcels (data from county
  appraisal districts). MAIL_* (owner mailing) fields are omitted from output.

### `dfw_traffic` — four sources, four coverage footprints (verified 2026-07-08)

`dfw_traffic` merges four upstreams with genuinely different natural fields and
coverage; there is deliberately no forced common schema (each result carries a
`type` discriminator instead). No API key required for any of the four.

- **Incidents — City of Fort Worth "Current Traffic Accidents"** (ArcGIS,
  `CFW_Current_Traffic_Accidents/FeatureServer/0`): small **rolling live table**
  (4 active records at verification time) — do not assume volume; a
  `resultRecordCount` of 25–50 is plenty. Fields: `Event_Number`, `Type_`,
  `Description`, `Severity`, `Address`, `Street`, `Cross_Street`,
  `CreationTime`/`UpdateTime` (epoch ms). `City`/`State`/`Zip`/
  `Location_Description`/`SubType_` are usually null. Fort Worth only — no
  other DFW city publishes a keyless live incident feed.
- **Closures — Dallas right-of-way (ROW) permits** (Socrata, two datasets
  merged, tagged `geometry_type: "line"|"point"`):
  - **Corrected dataset IDs** — the plan doc's original IDs (`yi5a-ym5z` for
    lines, `xum9-x6px` for points) are **dead empty shell views with zero
    columns** (confirmed live 2026-07-08). The tool uses the underlying
    `modifyingViewUid` datasets that actually carry data: **`xd3q-ipis`**
    (line/block-range permits, ~22.5k rows) and **`bw6g-a3ur`** (point/address
    permits, ~62k rows). A future maintainer re-checking the plan doc against
    `lib/sources.js` should trust `lib/sources.js`.
  - **Use `createddate` for recency/ordering, NOT `issuedate`** — `issuedate`
    was observed to contain unreliable future placeholder dates that match the
    estimated-completion date, not the actual issue date.
  - `locationnames` holds the full address on points (e.g. `"4156 LOMITA LN,
    DALLAS, 75220"`) and a block-range on lines (e.g. `"3500-3600   DIXON
    AVE"`); `statusdescription` is an enum (`"Issued"` | `"In Warranty"`
    observed). Dallas only.
- **Counts — TxDOT 5-Year Statewide AADT** (ArcGIS,
  `TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0`): **county field
  `CNTY_NM` is title case** (`"Dallas"`, not `"DALLAS"`) — the plan doc's
  uppercase assumption only "worked" because this ArcGIS backend happens to
  do case-insensitive string comparison; do not rely on that for display or
  reuse elsewhere. **No road-name field** — `TRFC_STATN_ID` is a station ID
  only (e.g. `"43HP174"`); `search` is not supported and is ignored with a
  note. **Null-current-year quirk:** the "current" AADT slot (`AADT_RPT_QTY`)
  is frequently `null` even though `LATEST_AADT_YR` has a real value — the
  tool picks the first non-null value among `[AADT_RPT_QTY,
  AADT_RPT_HIST_01_QTY, ..., AADT_RPT_HIST_04_QTY]` (most-recent-first) and
  labels it with `LATEST_AADT_YR` rather than a hardcoded year. If all five
  are null the tool renders "count unavailable", never a bare `0`. Scoped to
  the 4 core counties.
- **Projects — TxDOT Projects Info** (ArcGIS, `TxDOT_Projects_Info/FeatureServer/0`):
  same **title-case gotcha on `COUNTY_NAME`**. `HWY_NBR` (e.g. `"FERGUSON RD"`,
  `"US 67"`) IS a usable free-text search field, unlike the AADT layer.
  `PT_PHASE` values are used verbatim from upstream (observed: `"Construction
  Underway or Begins Soon"`, `"Planning, 10+ years"`, `"Construction begins
  within 4 years"`) — the tool does not invent its own phase enum. Scoped to
  the 4 core counties.
- **Pagination note:** closures/counts/projects are each thousands to tens of
  thousands of rows — too large to fetch in full like `dfw_events`' small RSS
  feeds. Each sub-source is queried sorted by its own recency field with a
  `topN = offset + limit + 1` cap starting at offset 0 (a standard top-K
  merge), so `total_matched` is an honest lower bound (exact once there's no
  next page), not a full `COUNT(*)`.

### `dfw_permits` / `dfw_code_cases` / `dfw_crime` (Fort Worth) — Fort Worth-first (verified 2026-07-14)

Three tools/branches share City of Fort Worth's ArcGIS Hub org
(`services5.arcgis.com/3ddLCBXe1bRt7mzj`), the same org `dfw_traffic`'s
incidents kind already uses:

- **Permits** — `CFW_Open_Data_Development_Permits_View/FeatureServer/0`,
  1,600,274 rows, newest `File_Date` same-day at verification (2026-07-14).
  **Address is componentized**: `Addr_No`, `Direction`, `Street_Name`,
  `Street_Suffix`, `Street_Suffix_Dir` — `Full_Street_Address` is usually
  `null`. `dfw_permits` matches on `Street_Name` (+ optional `Addr_No`), never
  a contains-match on one combined field, per the plan's componentized-address
  guidance. `JobValue`/`Units`/`SqFt` are typed as **strings** upstream (e.g.
  `"220000.0"`) — parsed to numbers or `null`, never left as strings.
  `B1_WORK_DESC` is genuine free text on older permits but is literally the
  placeholder string `"B1_WORK_DESC"` on most modern rows (an upstream
  field-mapping bug, confirmed live: ~922k of 1.6M rows carry the literal
  placeholder) — the tool filters that placeholder out rather than surfacing
  it as a description. `Permit_Category` is often the literal string `"NA"` —
  normalized to `null`.
- **Code violations** — `CFW_Open_Data_Code_Violations_Table_view/FeatureServer/0`,
  65,718 rows, newest `Case_Created_Date` 2026-06-16 (~4 weeks old at
  verification, but an actively-maintained feed — not abandoned like Dallas's,
  which stalled 2025-01-31). Unlike permits, **`Violation_Address` is a single
  string field** (not componentized) — a normal contains-match works.
  `Violation_Current_Status` / `Case_Current_Status` are a 2-value enum
  (`Open`/`Closed`). `Next_Activity_Due_Date` is a plain string
  (`"2026-07-01 00:00:00"`), not an ArcGIS date field.
- **Crime** — `CFW_Open_Data_Police_Crime_Data_Table_view/FeatureServer/0`,
  1,449,465 rows, newest `Reported_Date` 2026-07-12. **`Reported_Date` /
  `From_Date` are STRING fields** (`"YYYY-MM-DDTHH:MM:SS"`), not
  `esriFieldTypeDate` — compared/sorted as plain quoted strings, never wrapped
  in a `TIMESTAMP` literal (confirmed both string-compare filtering and
  `orderByFields` sort correctly on this format). `BLOCK_ADDRESS` is a single
  block-level string field, same shape as Dallas's `incident_address`. `City`
  is dirty free text (mostly `"FORT WORTH"` — 1,445,109 of 1,449,465 rows —
  but includes FWPD mutual-aid/typo rows for neighboring jurisdictions,
  e.g. `"ARLINGTON"`, `"DALLAS"`, `"FTW"`, `"ft. worth"`); not filtered on,
  mirroring how the Dallas branch doesn't filter on its `city` field either.
  `Attempt_Complete` is a 2-value code (`A`=Attempted, `C`=Complete) mapped to
  a readable label. Wired into `dfw_crime` as an **explicit-only** `city`
  branch (never auto-detected from an address) alongside the unchanged Dallas
  default, per the plan.
- All three query shapes (`likeClause`, `queryLayer` pagination via
  `resultOffset`/`resultRecordCount`) reuse `lib/arcgis.js` exactly as
  `dfw_traffic`'s incidents kind does — nothing new added to that client.

### `dfw_code_cases` / `dfw_permits` (McKinney) — v0.3, on-prem ArcGIS (verified 2026-07-15)

City of McKinney runs its own on-prem ArcGIS server
(`maps.mckinneytexas.org`, not AGOL) — same risk profile as Fort Worth's
on-prem twin above (self-hosted infra, no AGOL SLA).

- **Code Enforcement Cases** — `MapServices/CodeServices/MapServer/1`,
  166,053 rows, max `OpenDate` 2026-07-14 (verified via `outStatistics`
  MAX). Fields: `CaseNumber`, `CaseType`, `CaseStatus`, `AssignedTo`,
  `OpenDate` (esri date), `Year`, `Quarter`, `CloseDate` (date), `Address`,
  `Parcel`. **`Address` is a single string field** — a normal contains-match
  works, ordered newest-first by `OpenDate DESC`.
- **Energov Records** — `MapServices/EnergovRecords/MapServer/0`, 328,308
  rows; `MODULE` is `'PERMIT'` or `'PLAN'` in one shared layer — `dfw_permits`
  always filters `MODULE='PERMIT'` (confirmed live: a `'%VIRGINIA%'` address
  search returns both PLAN and PERMIT rows upstream; the tool's query and its
  unit test both assert the `MODULE='PERMIT'` filter is present). Live through
  the current month (2026-07 `ENT_NUMBER` case numbers observed, e.g.
  `"COM2026-07-00990"`) **but the layer has NO DATE FIELD at all** — no
  `File_Date`/`Created_Date` equivalent exists on this layer. Consequences,
  all deliberate design decisions:
  - `dfw_permits` **requires `address`** for `city="mckinney"` and returns an
    explicit LLM-friendly refusal if it's missing, rather than silently
    returning an arbitrary/undated slice of 328k rows.
  - `since_date` is accepted but **ignored with a note** for McKinney (there
    is nothing to filter on).
  - Results are ordered by `ENT_NUMBER DESC`, which only **roughly** groups
    recent cases (the year-month is embedded in the case-number prefix) — the
    output explicitly caveats that this is NOT a true chronological sort.
  - The "date" surfaced per result is parsed from the case number itself
    (`/(19|20)\d{2}-\d{2}/` on `ENT_NUMBER`, e.g. `"SIGN2023-08-00454"` →
    `"2023-08"`) and labeled `"filed (from case number)"`, never presented as
    an authoritative filing date.
  - `ENT_MA1`/`ENT_MA2` are address line 1/2 — `address` contains-matches
    `ENT_MA1`. Live-verified with the address `"216 W Virginia St"`
    (McKinney), which returns real permit history (wall-sign permits back to
    2016).

### `dfw_crime` (Denton) — v0.3, new CKAN client (verified 2026-07-15)

Denton is the first non-Socrata, non-ArcGIS source in this MCP: it publishes
crime data on an **OpenGov-managed CKAN portal**
(`data.cityofdenton.com`, package `denton-crime-data`, datastore resource
`34f60f26-b458-48d0-9e40-d4f83fee3563`). New client: `lib/ckan.js`, style-
matched to `lib/soda.js` (retry profile `"soda"`, `withLimit("ckan", ...)`
semaphore bucket, `UpstreamError`-compatible error text).

- **77,979 records**, 2019-11-06 → present, max `"Date/Time"` =
  `"2026-07-14 16:45"` (fresh at verification). Fields: `ID`, `Agency` (e.g.
  `"DENTON PD"`), `Crime` (category, e.g. `"Vandalism"`, `"Simple Assault"`,
  `"All Other Offenses"`), `"Date/Time"` (`"YYYY-MM-DD HH:MM"`),
  `Public_Address` (e.g. `"MORSE ST DENTON TX "` — often block-level/no house
  number, has a trailing space that the tool trims).
- **All fields are TEXT**, including `"Date/Time"` — its zero-padded format
  means a plain lexicographic string compare/sort IS chronologically correct
  (confirmed: `ORDER BY "Date/Time" DESC` returns true newest-first order).
- **`datastore_search`** (CKAN's built-in endpoint) only supports exact-match
  `filters`, so it can't do address/offense contains-matching.
  **`datastore_search_sql`** (standard CKAN SQL over one resource) IS enabled
  on this portal — used instead, with hand-built `ILIKE '%value%'` clauses.
  **SQL safety**: only escaped string literals (single quotes doubled via
  `sqlEscape`/`ilikeClause` in `lib/ckan.js`) are ever interpolated;
  column names with special characters (`"Date/Time"`) are double-quoted
  literals in the tool code, never derived from user input. Unit-tested in
  `test/unit/ckan.test.js`, including an injection-payload escaping case.
- Wired into `dfw_crime` as an **explicit-only** `city="denton"` branch
  (mirrors the Fort Worth branch's structure: neither city has its own
  ground-truth city-limits polygon, so routing is decided entirely by the
  explicit `city` argument, never auto-detected from an address). Same
  block-level-address note, FCRA "not a consumer report" notice, and "at
  least one of address/offense" requirement as the other branches.
  `source_url` links `https://data.cityofdenton.com/dataset/denton-crime-data`.

### `dfw_events` (McKinney) — v0.3

`mckinneytexas.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml` — live-
verified 2026-07-15 (HTTP 200, 41 items), same CivicPlus labeled
description-field shape (`Event date` / `Event Time` / `Location`) as the
other shipped feeds. Added purely as a new `lib/sources.js` `EVENTS_RSS`
entry — `dfw_events`' city enum derives from `Object.keys(EVENTS_RSS)`, so no
tool-code change was needed to light up `city="mckinney"`.

## Excluded / deferred (do NOT wire without re-verification)

### Irving — NOT wireable (verified 2026-07-15; pipeline froze 2025-02-28)

Irving's entire open-data pipeline stopped around the same date across THREE
independent datasets — a strong signal of a stopped publication job, not
three coincidental staleness events:

- **Residential permits** —
  `services3.arcgis.com/OfsJXUlu8pSkbl7B/.../Residential_Permits_Issued_Feb_15_2022_Present/FeatureServer/0`
  — max `Issued_Date` **2025-02-28**, despite the `"...Present"` layer name
  implying it's current.
- **Commercial permits** —
  `services3.arcgis.com/OfsJXUlu8pSkbl7B/.../Commercial_Permits_Issued_2_15_22_Present/FeatureServer/0`
  — identical freeze, **2025-02-28**.
- **Code violations** — annual-snapshot services, frozen since **2022** with
  no 2023+ sibling ever published.
- **Police incidents** — static CSV items frozen at the same **2025-02-28**
  date, with no query API to page through them (not even a stale ArcGIS
  layer — just fixed downloadable files).
- **Events RSS** — Akamai bot-blocks plain (non-browser) fetches with a 403
  (same failure mode noted in the `EVENTS_RSS` comment in `lib/sources.js`).

Decision: `ARCGIS.irvingResidentialPermits` / `ARCGIS.irvingCommercialPermits`
are recorded in `lib/sources.js` with `verified: false` and explanatory
comments, but are **not wired into any tool**. Revisit trigger: Irving
resumes publication (re-verify freshness across all four findings before
wiring anything).

### Plano — NO live record-level data (verified 2026-07-15)

Plano's Socrata code-enforcement datasets froze **2026-03** — the newest
publication available is over 4 months stale at verification time. Not
wired; revisit if Plano resumes.

### Arlington — HAS fresh data, not yet wired (verified 2026-07-15)

Unlike Irving/Plano, Arlington DOES have fresh, wireable permits and
code-violation ArcGIS layers on
`gis2.arlingtontx.gov/agsext2/rest/services/OpenData/...`. Confirmed live but
deliberately left out of this wave (v0.3 scope was McKinney + Denton) — a
good candidate for a future wave once its layer schema is fully mapped.

### Dallas building permits — still EXCLUDED (stale sources only; Fort Worth ships instead, see above)

- Socrata `e7gq-4sah` ("Building Permits"): **dead** — max `issued_date` =
  `2019-12-31` despite fresh catalog metadata.
- ArcGIS fallback probe (2026-07-06, AGOL owner
  `jeffery.danielson@dallascityhall.com_DallasGIS`):
  - "New Permits 1971-2024" →
    `services2.arcgis.com/rwnOSbfKSwyTBcwN/.../NewPermit_2008_2024/FeatureServer/0`,
    max `ISSUE_DATE` = **2024-11-12** (~20 months stale).
  - "Building Permits for Fiscal Year 2023 to 2024" →
    `.../T_BU_Permits_FY2023_24/FeatureServer/0` — FY23-24 snapshot, not current.
- Decision: `SODA.dallas.permits` / `ARCGIS.dallasPermits` remain
  `verified: false` in `lib/sources.js` (`requireVerified` guard) and are
  never queried. `dfw_permits` ships Fort Worth-only (v0.2, see above) --
  Dallas is not "fixed", just left unwired. Shipping a permit tool on a
  20-month-stale layer would silently mislead users.

### Dallas code-compliance cases — still deferred (Fort Worth ships instead, see above)

Newest Dallas code-violations dataset is stale since **2025-01-31**. Revisit
when the city resumes publication. `dfw_code_cases` ships Fort Worth-only
(v0.2, see above) in the meantime.

### `dfw_parcels` — UNBLOCKED (folded into `dfw_appraisal`)

Originally deferred: no authoritative core-county parcel FeatureServer was found
and CAD portals (DCAD/TAD) have anti-bot/ToS concerns. **Resolved 2026-07-07** by
the TxGIO StratMap Land Parcels service (see the `dfw_appraisal` section above),
which carries CAD-sourced situs, land use, geometry-match, owner, and values for
all 4 core counties keyless via `identify`. The parcel record and its appraised
values now ship together as `dfw_appraisal`; the DCAD/TAD portals are never
touched.

## Env vars

- `DFW_SODA_APP_TOKEN` — optional Socrata app token (free signup at
  https://dev.socrata.com/register) to raise the shared anonymous rate limit.
- `DFW_TICKETMASTER_API_KEY` — optional Ticketmaster Discovery key (free at
  https://developer.ticketmaster.com) to add concerts/sports/theater to
  `dfw_events`.
- `DFW_LIMIT_<SOURCE>` — per-upstream concurrency override (soda, arcgis, fema,
  census, nws, ckan).
- `DFW_CACHE_DISABLED=1` — disable the LRU/TTL cache (tests).
- `LOCAL_DFW_MCP_TIER=core|all` — tool tier gate (v0.1: identical sets).

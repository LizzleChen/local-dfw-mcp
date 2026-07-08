# Local DFW MCP — Dataset Catalog

Registry of every upstream this MCP talks to. All `verified` entries were
confirmed with a live query on 2026-07-06/07. Machine-readable twin:
`lib/sources.js`.

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

## Excluded / deferred (do NOT wire without re-verification)

### `dfw_permits` — EXCLUDED from v0.1 (stale sources only)

- Socrata `e7gq-4sah` ("Building Permits"): **dead** — max `issued_date` =
  `2019-12-31` despite fresh catalog metadata.
- ArcGIS fallback probe (2026-07-06, AGOL owner
  `jeffery.danielson@dallascityhall.com_DallasGIS`):
  - "New Permits 1971-2024" →
    `services2.arcgis.com/rwnOSbfKSwyTBcwN/.../NewPermit_2008_2024/FeatureServer/0`,
    max `ISSUE_DATE` = **2024-11-12** (~20 months stale).
  - "Building Permits for Fiscal Year 2023 to 2024" →
    `.../T_BU_Permits_FY2023_24/FeatureServer/0` — FY23-24 snapshot, not current.
- Decision: entries remain `verified: false` in `lib/sources.js`
  (`requireVerified` guard) and the tool is not registered. Shipping a permit
  tool on a 20-month-stale layer would silently mislead users.

### `dfw_code_cases` — deferred

Newest Dallas code-violations dataset is stale since **2025-01-31**. Revisit
when the city resumes publication.

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
- `DFW_LIMIT_<SOURCE>` — per-upstream concurrency override (soda, arcgis, fema,
  census, nws).
- `DFW_CACHE_DISABLED=1` — disable the LRU/TTL cache (tests).
- `LOCAL_DFW_MCP_TIER=core|all` — tool tier gate (v0.1: identical sets).

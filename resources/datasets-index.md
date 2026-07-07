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
| — geocoding | U.S. Census geocoder | `geocoding.geo.census.gov` | 1500 Marilla St resolved OK. |

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

### `dfw_parcels` — deferred

No authoritative Dallas County (or other core-county) parcel FeatureServer was
found. CAD portals (DCAD/TAD) have anti-bot/ToS concerns; ownership/value data
is out of scope until a clean source exists.

## Env vars

- `DFW_SODA_APP_TOKEN` — optional Socrata app token (free signup at
  https://dev.socrata.com/register) to raise the shared anonymous rate limit.
- `DFW_LIMIT_<SOURCE>` — per-upstream concurrency override (soda, arcgis, fema,
  census, nws).
- `DFW_CACHE_DISABLED=1` — disable the LRU/TTL cache (tests).
- `LOCAL_DFW_MCP_TIER=core|all` — tool tier gate (v0.1: identical sets).

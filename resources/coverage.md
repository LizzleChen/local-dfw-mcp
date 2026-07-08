# Local DFW MCP — Geographic Coverage (v0.1)

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

## County / statewide / national tools

| Tool | Coverage |
|---|---|
| `dfw_fema_flood` | national (FEMA NFHL) |
| `dfw_tea_schools` | all Texas (TEA); filter by DALLAS / TARRANT / COLLIN / DENTON county |
| `dfw_nws_alerts` | national (NWS); defaults to downtown Dallas |
| `dfw_utility_providers` | all Texas (PUC CCN boundaries) |
| `dfw_district_lookup` | county + ISD statewide; council district City of Dallas only |
| `dfw_appraisal` | Texas statewide (TxGIO StratMap); DFW's 4 core counties verified on the 2025 certified roll. Address-first (geocode → parcel identify); no owner-name/free-text search |

## Not covered in v0.1

- **Building permits** (`dfw_permits`): not shipped — every current City of
  Dallas permit feed is ~20 months stale. See `dfw://datasets/index`.
- **Code compliance cases**: deferred — newest Dallas dataset stale since
  2025-01-31.
- **Fort Worth / Arlington / Plano / Frisco city portals**: v0.2.
- **Composed `dfw_property_360`**: v0.2.

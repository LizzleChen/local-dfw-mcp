# Changelog

Assembled from the per-version files in [`changelog/`](changelog/), which
carry the full "why" behind each release (dead upstream datasets, frozen
city pipelines, source-selection rationale). Newest first.

## [v0.2.3](changelog/v0.2.3.md) — 2026-07-18

Fort Worth + metro-city release: new `dfw_permits` and `dfw_code_cases`
tools (Fort Worth / McKinney / Arlington), Fort Worth + Denton branches on
`dfw_crime`, Arlington closures in `dfw_traffic`, CKAN adapter. Dallas
permits/code and all of Irving deliberately not wired (stale/frozen
upstreams — refusing beats serving stale data).

## [v0.2.2](changelog/v0.2.2.md) — 2026-07-15

`dfw_traffic`: Fort Worth incidents, Dallas ROW closures, TxDOT AADT counts
and construction projects. Includes the Dallas dead-Socrata-shell detective
work and the AADT null-field handling.

## [v0.2.1](changelog/v0.2.1.md) — 2026-07-08

`dfw_appraisal` via TxGIO StratMap statewide parcels (keyless, 2025
certified roll, geocode-then-identify — no owner search by design).

## [v0.2.0](changelog/v0.2.0.md) — 2026-07-08

`dfw_events`: five city calendars + optional free Ticketmaster tier. The
"local guide" repositioning.

## [v0.1.1](changelog/v0.1.1.md) — 2026-07-07

First published release: nine tools, metro router with wrong-city refusals,
verified-source registry. (v0.1.0 was burned by the MCP Registry's
case-sensitive namespace check.)

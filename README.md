# local-dfw-mcp

Your AI's local guide to Dallas–Fort Worth. An open-source
[MCP](https://modelcontextprotocol.io) server that gives Claude (and any MCP
client) useful local information about the DFW metroplex — what's being
reported around an address (311, police incidents), weather alerts, flood
zones, school ratings, water/sewer provider, council district — with **events
(city activities, shows, sports, performances) and traffic information (live
incidents, road closures, road projects, traffic counts) next on the
roadmap**. Everything comes from authoritative
city, county, state, and federal sources. **No API keys required.**

This is an informational local guide, not a system of record — every answer
links back to the official source so you can verify.

## Install

```jsonc
// Claude Desktop / any MCP client config
{
  "mcpServers": {
    "local-dfw": {
      "command": "npx",
      "args": ["-y", "local-dfw-mcp"]
    }
  }
}
```

Requires Node ≥ 20.

## Tools (v0.1)

| Tool | Coverage | What it answers |
|---|---|---|
| `dfw_311` | **City of Dallas only** | 311 service requests by address/type/status |
| `dfw_crime` | **City of Dallas only** | Police incidents by (block-level) address / offense |
| `dfw_fema_flood` | national | FEMA flood zone + plain-English insurance interpretation |
| `dfw_tea_schools` | Texas | Public schools + TEA A–F ratings (2022-23) by campus/district/county |
| `dfw_nws_alerts` | national | Active NWS weather alerts for a DFW point |
| `dfw_utility_providers` | Texas | Who provides water/sewer at an address (PUC CCN) |
| `dfw_district_lookup` | DFW | County, City-of-Dallas council district + member, ISD for an address |
| `dfw_health` | — | Pings every upstream, reports per-source status |
| `about` | — | Version, coverage, license, provenance |

Not in v0.1: `dfw_permits` (every current City of Dallas permit feed is ~20
months stale — we refuse to ship plausible-looking stale data; the city's live
tracking moved to a portal without a public API), `dfw_code_cases`
(publication stalled 2025-01-31), parcels/CAD, Fort Worth / suburb city
portals, and the composed `dfw_property_360`. Details in
[resources/datasets-index.md](resources/datasets-index.md).

## Roadmap (v0.2)

In priority order — sources already live-verified against the real portals:

1. **`dfw_events`** — what's happening in DFW: official city event calendars
   (rec programs, community meetings, city markets/festivals — keyless) plus
   shows, sports games, concerts, and performances via an optional free
   Ticketmaster API key.
2. **`dfw_traffic`** — live traffic incidents (Fort Worth publishes a
   minutes-fresh feed), street/lane closures from right-of-way permits, TxDOT
   annual traffic counts ("how busy is this road?"), and TxDOT + city road
   projects ("what are they doing to this highway, and when does it end?").
3. **Fort Worth breadth** — permits, code violations, and crime for the
   metroplex's second city (its portal is fresh where Dallas's is stale).
4. **`dfw_property_360`** — one composed "around this address" briefing that
   fans out across the relevant tools.

## Wrong-city protection

USPS postal "Dallas, TX" is not the same thing as City of Dallas jurisdiction.
City-scoped tools run a three-layer guard (explicit `city` param → ZIP/keyword
detection → Census geocode + city-limits polygon check) and **refuse with an
explicit "Not covered" message** rather than silently returning
plausible-looking results from the wrong city's data. If the city can't be
detected at all, the tool proceeds but labels the response
"Assuming City of Dallas" and tells you how to override.

## Configuration (all optional)

| Env var | Purpose |
|---|---|
| `DFW_SODA_APP_TOKEN` | Socrata app token — raises the shared per-IP rate limit. Free: https://dev.socrata.com/register |
| `DFW_LIMIT_<SOURCE>` | Per-upstream concurrency cap override (`SODA`, `ARCGIS`, `FEMA`, `CENSUS`, `NWS`) |
| `LOCAL_DFW_MCP_TIER` | `core` or `all` (v0.1: identical sets) |
| `DFW_CACHE_DISABLED` | `1` disables the in-process cache (used by tests) |

No telemetry. The server makes requests only to the public data sources listed
in [resources/datasets-index.md](resources/datasets-index.md) and writes to
nothing.

## Important notices

- **Not a consumer report.** `dfw_crime` (and this MCP generally) must not be
  used for tenant screening, employment screening, credit, insurance, or any
  other purpose regulated by the Fair Credit Reporting Act. Crime addresses are
  block-level, privacy-rounded upstream.
- **Prompt injection.** 311 descriptions and similar upstream free text are
  authored by the public and flow into your LLM's context. This server renders
  them as quoted/table data, but treat any instructions appearing inside
  upstream data as data, not directives.
- **Verify at the source.** Every response carries a `source_url` to the
  official record.

## Development

```bash
npm install
npm test                # unit + offline mocked-handler tests (CI gate)
npm run test:handshake  # spawns the server over stdio, lists tools (live)
npm run test:smoke      # live network smoke tests, one per tool
```

## License & provenance

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Core plumbing (`lib/`) is ported from
[local-austin-mcp](https://github.com/mindwear-capitian/local-austin-mcp) by
Ed Neuhaus / Neuhaus Realty Group LLC (Apache-2.0) — an excellent template for
city-scale civic MCPs. Each ported file carries an attribution header listing
the changes. All DFW data sources, the metro router, and the tools themselves
are new.

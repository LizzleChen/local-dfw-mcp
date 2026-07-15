# local-dfw-mcp

**Your AI's local guide to Dallas–Fort Worth.** An open-source
[MCP](https://modelcontextprotocol.io) server that connects Claude (or any MCP
client) to official city, county, state, and federal data — so you can ask
things like:

- 🎪 *"What's happening in Frisco this weekend?"*
- 🌊 *"Is 1500 Marilla St in a flood zone?"*
- 🏫 *"How are the schools rated near Garland?"*
- 🚰 *"Who provides water and sewer at this address?"*
- 🕳️ *"Any potholes or illegal dumping reported on my street?"*
- ⛈️ *"Are there severe weather alerts for Dallas right now?"*
- 🏠 *"What's this house appraised at, per the county?"*

Every answer comes from an authoritative public source and includes a link to
the official record. **No API keys required** — one optional free key unlocks
concerts and sports (see below).

## Quick start

Add this to your MCP client config (Claude Desktop, Claude Code, etc.):

```jsonc
{
  "mcpServers": {
    "local-dfw": {
      "command": "npx",
      "args": ["-y", "local-dfw-mcp"]
    }
  }
}
```

Requires Node ≥ 20. That's it — restart your client and start asking.

## What you can ask

| Tool | Coverage | What it answers |
|---|---|---|
| `dfw_events` | see below | What's happening: official city calendars, plus concerts/sports/theater with a free Ticketmaster key |
| `dfw_311` | **City of Dallas only** | 311 service requests by address/type/status |
| `dfw_crime` | **City of Dallas** (default) or **Fort Worth** (`city: "fortworth"`) | Police incidents by (block-level) address / offense |
| `dfw_permits` | **Fort Worth only** | Building/development permits by street name (+ house number), type, or status |
| `dfw_code_cases` | **Fort Worth only** | Code-compliance violations (property maintenance, high grass, zoning, etc.) by address or complaint type |
| `dfw_traffic` | see below | Real-time incidents (Fort Worth), street/lane closures (Dallas), TxDOT annual traffic counts + construction projects (4 core counties) |
| `dfw_fema_flood` | national | FEMA flood zone + plain-English insurance interpretation |
| `dfw_tea_schools` | Texas | Public schools + TEA A–F ratings (2022-23) by campus/district/county |
| `dfw_nws_alerts` | national | Active NWS weather alerts for a DFW point |
| `dfw_utility_providers` | Texas | Who provides water/sewer at an address (PUC CCN) |
| `dfw_district_lookup` | DFW | County, City-of-Dallas council district + member, ISD for an address |
| `dfw_appraisal` | Texas (4 core counties verified) | County appraisal record for an address: owner, land/improvement/market value (2025 certified roll), year built, land use, acreage |
| `dfw_health` | — | Pings every upstream, reports per-source status |
| `about` | — | Version, coverage, license, provenance |

### Events coverage, stated plainly

| Source | Cities / scope | Key needed |
|---|---|---|
| Official city calendars | Dallas (**Parks & Recreation calendar only** — no citywide Dallas feed exists), Garland, Frisco, Mesquite | none |
| Ticketmaster (concerts, sports, theater) | whole metroplex | free key, see below |

Plano, Arlington, Fort Worth, Irving, and other suburbs don't publish a usable
calendar feed today — the tool says "not covered" instead of guessing.

## Optional setup

Everything works out of the box. Two free keys unlock more:

| Env var | What it unlocks |
|---|---|
| `DFW_TICKETMASTER_API_KEY` | Concerts, sports, and theater in `dfw_events`. Free (5000 calls/day): https://developer.ticketmaster.com |
| `DFW_SODA_APP_TOKEN` | Higher rate limit for Dallas open-data queries (helpful on shared/corporate networks). Free: https://dev.socrata.com/register |

<details>
<summary>Advanced knobs</summary>

| Env var | Purpose |
|---|---|
| `DFW_LIMIT_<SOURCE>` | Per-upstream concurrency cap override (`SODA`, `ARCGIS`, `FEMA`, `CENSUS`, `NWS`) |
| `LOCAL_DFW_MCP_TIER` | `core` or `all` — trims the tool list for clients with tool caps |
| `DFW_CACHE_DISABLED` | `1` disables the in-process cache (used by tests) |

</details>

No telemetry. The server only reads from the public data sources listed in
[resources/datasets-index.md](resources/datasets-index.md) and writes to
nothing.

## Honest by design

- **Wrong-city protection.** Postal "Dallas, TX" is not the same as City of
  Dallas jurisdiction. City-scoped tools verify the address (ZIP/keyword →
  geocode → city-limits polygon) and **refuse with an explicit "Not covered"
  message** rather than silently returning plausible-looking results from the
  wrong city's data.
- **No stale data.** Sources are live-verified before they ship — that's why
  `dfw_permits` and `dfw_code_cases` are Fort Worth-only: every current Dallas
  permit feed is ~20 months stale and Dallas's code-case publication stalled
  2025-01-31, so Dallas isn't wired for either. Also pending: suburb portals
  beyond Fort Worth/Dallas, and the composed `dfw_property_360`. Details in
  [resources/datasets-index.md](resources/datasets-index.md).
- **Verify at the source.** Every response carries a `source_url` to the
  official record.

## Important notices

- **Not a consumer report.** `dfw_crime`, `dfw_code_cases`, `dfw_appraisal`
  (and this MCP generally) must not be used for tenant screening, employment
  screening, credit, insurance, or any other purpose regulated by the Fair
  Credit Reporting Act. Crime addresses are block-level, privacy-rounded
  upstream. `dfw_appraisal`
  owner names and values are public record but not for screening, and it reports
  the 2025 certified appraised value — **not a tax bill**.
- **Prompt injection.** 311 descriptions, event listings, and similar upstream
  free text are authored by the public and flow into your LLM's context. This
  server renders them as quoted/table data, but treat any instructions
  appearing inside upstream data as data, not directives.

## License & provenance

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Core plumbing (`lib/`) is ported from
[local-austin-mcp](https://github.com/mindwear-capitian/local-austin-mcp) by
Ed Neuhaus / Neuhaus Realty Group LLC (Apache-2.0) — an excellent template for
city-scale civic MCPs. Each ported file carries an attribution header listing
the changes. All DFW data sources, the metro router, and the tools themselves
are new.

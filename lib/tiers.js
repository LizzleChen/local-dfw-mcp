/**
 * Adapted from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: CORE_TOOL_NAMES replaced with the DFW tool set;
 * env var LOCAL_AUSTIN_MCP_TIER -> LOCAL_DFW_MCP_TIER.
 * See LICENSE and NOTICE in the repository root.
 *
 * Tool tiers. `core` is the minimum set most people need. Set
 * LOCAL_DFW_MCP_TIER=core to load only this set; default ("all") loads everything.
 * Names are the PUBLIC (post-rename) names registered with the server.
 *
 * For v0.1 every shipped tool is in `core` (the whole surface is small), so
 * core and all are currently equivalent -- the knob exists for forward growth.
 */

export const CORE_TOOL_NAMES = new Set([
  "about",
  "dfw_health",
  "dfw_311",
  "dfw_crime",
  "dfw_permits",
  "dfw_code_cases",
  "dfw_events",
  "dfw_fema_flood",
  "dfw_tea_schools",
  "dfw_nws_alerts",
  "dfw_utility_providers",
  "dfw_district_lookup",
  "dfw_appraisal",
  "dfw_traffic",
]);

export function tierFromEnv() {
  return String(process.env.LOCAL_DFW_MCP_TIER || "all").toLowerCase();
}

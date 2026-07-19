/**
 * Guard: every input-schema field on every tool must carry a .describe() --
 * field descriptions are the LLM-facing contract (behavioral caveats live
 * there, not in code comments). See plan/cyanheads-mcp-study.md §5 item 2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { aboutTool } from "../../tools/about.js";
import { dfwHealth } from "../../tools/dfw-health.js";
import { dfw311 } from "../../tools/civic/dfw-311.js";
import { dfwCrime } from "../../tools/civic/dfw-crime.js";
import { dfwPermits } from "../../tools/civic/dfw-permits.js";
import { dfwCodeCases } from "../../tools/civic/dfw-code-cases.js";
import { dfwTeaSchools } from "../../tools/civic/dfw-tea-schools.js";
import { dfwDistrictLookup } from "../../tools/civic/dfw-district-lookup.js";
import { dfwFemaFlood } from "../../tools/property/dfw-fema-flood.js";
import { dfwUtilityProviders } from "../../tools/property/dfw-utility-providers.js";
import { dfwAppraisal } from "../../tools/property/dfw-appraisal.js";
import { dfwNwsAlerts } from "../../tools/environment/dfw-nws-alerts.js";
import { dfwEvents } from "../../tools/events/dfw-events.js";
import { dfwTraffic } from "../../tools/traffic/dfw-traffic.js";

const ALL_TOOLS = [
  aboutTool, dfwHealth, dfw311, dfwCrime, dfwPermits, dfwCodeCases,
  dfwTeaSchools, dfwDistrictLookup, dfwFemaFlood, dfwUtilityProviders,
  dfwAppraisal, dfwNwsAlerts, dfwEvents, dfwTraffic,
];

/** Find the describe() text on a zod schema, unwrapping optional/default wrappers. */
function describeText(schema) {
  let s = schema;
  for (let i = 0; s && i < 10; i++) {
    if (typeof s.description === "string" && s.description.length > 0) return s.description;
    s = s.def?.innerType ?? s._def?.innerType;
  }
  return null;
}

test("every tool input field has a .describe()", () => {
  const missing = [];
  for (const tool of ALL_TOOLS) {
    for (const [field, schema] of Object.entries(tool.inputSchema ?? {})) {
      if (!describeText(schema)) missing.push(`${tool.name}.${field}`);
    }
  }
  assert.deepEqual(missing, [], `fields missing .describe(): ${missing.join(", ")}`);
});

test("every tool has a non-trivial description", () => {
  for (const tool of ALL_TOOLS) {
    assert.ok(
      typeof tool.description === "string" && tool.description.length >= 40,
      `${tool.name} description too short`
    );
  }
});

/**
 * dfw_health -- one-shot diagnostic of every upstream data source. Adapted from
 * local-austin-mcp's austin-health.js (Apache-2.0): the probe/report structure
 * is unchanged; the CHECKS list points at the DFW upstreams instead.
 *
 * Pings each provider in parallel with a short timeout and reports per-source
 * status. A reachable-but-rejecting endpoint (400/401/403) counts as UP.
 */

import { z } from "zod";
import { ATTRIBUTION_TAG } from "../lib/attribution.js";

const TIMEOUT_MS = 3500;

const CHECKS = [
  {
    source: "SODA www.dallasopendata.com (311)",
    url: "https://www.dallasopendata.com/resource/d7e7-envw.json?$limit=1",
  },
  {
    source: "SODA www.dallasopendata.com (crime)",
    url: "https://www.dallasopendata.com/resource/qv6i-rri7.json?$limit=1",
  },
  {
    source: "SODA data.texas.gov (TEA)",
    url: "https://data.texas.gov/resource/nui6-x374.json?$limit=1",
  },
  {
    source: "ArcGIS FEMA NFHL",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer?f=json",
  },
  {
    source: "ArcGIS PUC Water CCN",
    url: "https://services6.arcgis.com/N6Lzvtb46cpxThhu/arcgis/rest/services/Water_CCN_Service_Areas/FeatureServer/210?f=json",
  },
  {
    source: "ArcGIS Dallas Council Areas",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/CouncilAreas/FeatureServer/0?f=json",
  },
  {
    source: "ArcGIS Dallas City Limits",
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/CityLimits/FeatureServer/0?f=json",
  },
  {
    source: "U.S. Census geocoder",
    url: "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=Texas&benchmark=Public_AR_Current&format=json",
  },
  {
    source: "NWS api.weather.gov",
    url: "https://api.weather.gov/alerts/active?area=TX",
    init: { headers: { "User-Agent": "local-dfw-mcp (https://github.com/LizzleChen/local-dfw-mcp)" } },
  },
];

async function probe(check) {
  const started = Date.now();
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(new Error("timeout")), TIMEOUT_MS);
  try {
    const res = await fetch(check.url, { ...(check.init || {}), signal: ac.signal });
    const latency_ms = Date.now() - started;
    if (res.ok) return { source: check.source, status: "ok", http: res.status, latency_ms, last_error: null };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { source: check.source, status: "ok", http: res.status, latency_ms, last_error: null };
    }
    return { source: check.source, status: res.status >= 500 ? "down" : "degraded", http: res.status, latency_ms, last_error: `${res.status} ${res.statusText}` };
  } catch (err) {
    const latency_ms = Date.now() - started;
    const msg = String(err?.message || err);
    const kind = msg.includes("timeout") || msg.includes("aborted") ? "timeout" : "network";
    return { source: check.source, status: kind === "timeout" ? "degraded" : "down", http: null, latency_ms, last_error: msg.slice(0, 160) };
  } finally {
    clearTimeout(tid);
  }
}

export const dfwHealth = {
  name: "dfw_health",
  tier: "core",
  description:
    "Diagnostic. Pings every upstream data provider this MCP depends on (Dallas " +
    "Open Data, data.texas.gov, FEMA NFHL, PUC CCN, Dallas GIS, Census, NWS) in " +
    "parallel with a 3.5s timeout and reports per-source status, HTTP code, and " +
    "latency. Use when many tools return errors to tell which provider is down " +
    "vs which tool is broken.",
  inputSchema: {},
  outputSchema: {
    summary: z.object({
      ok: z.number(),
      degraded: z.number(),
      down: z.number(),
      checked_at: z.string(),
    }),
    checks: z.array(
      z.object({
        source: z.string(),
        status: z.enum(["ok", "degraded", "down"]),
        http: z.number().int().nullable(),
        latency_ms: z.number().int(),
        last_error: z.string().nullable(),
      })
    ),
  },
  annotations: { title: "Upstream Health Check" },
  async handler() {
    const checks = await Promise.all(CHECKS.map(probe));
    const summary = {
      ok: checks.filter((c) => c.status === "ok").length,
      degraded: checks.filter((c) => c.status === "degraded").length,
      down: checks.filter((c) => c.status === "down").length,
      checked_at: new Date().toISOString(),
    };

    const lines = [
      `# Upstream Health -- ${summary.checked_at}`,
      ``,
      `**${summary.ok} OK** / ${summary.degraded} degraded / ${summary.down} down`,
      ``,
      `| Source | Status | HTTP | Latency | Error |`,
      `|---|---|---|---|---|`,
    ];
    for (const c of checks) {
      const badge = c.status === "ok" ? "OK" : c.status === "degraded" ? "DEGRADED" : "DOWN";
      lines.push(
        `| ${c.source} | ${badge} | ${c.http ?? "—"} | ${c.latency_ms}ms | ${c.last_error ?? "—"} |`
      );
    }

    lines.push("", ATTRIBUTION_TAG);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { summary, checks },
    };
  },
};

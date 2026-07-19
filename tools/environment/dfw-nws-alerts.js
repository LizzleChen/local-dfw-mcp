import { z } from "zod";
import { geocodeAddress } from "../../lib/geocode.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { retryFetch } from "../../lib/retry.js";
import { errorResult } from "../../lib/register.js";

/**
 * Adapted from local-austin-mcp's austin-nws-alerts.js (Apache-2.0). Logic is
 * unchanged (NWS api.weather.gov is national); the default point is downtown
 * Dallas and the User-Agent identifies this project.
 */
const NWS_BASE = "https://api.weather.gov";
const UA = "local-dfw-mcp (https://github.com/LizzleChen/local-dfw-mcp)";

// Downtown Dallas.
const DEFAULT_LAT = 32.7767;
const DEFAULT_LNG = -96.797;

export const dfwNwsAlerts = {
  name: "dfw_nws_alerts",
  tier: "core",
  description: withAttributionTag(
    "Active National Weather Service alerts (severe thunderstorm, tornado, " +
      "flood, heat, freeze, fire weather) for a DFW location. Defaults to " +
      "downtown Dallas when no address is supplied. Returns severity, urgency, " +
      "headline, area, and expiration for each active alert covering the point. " +
      "This is CURRENT alerts only -- for a property's long-term flood ZONE use " +
      "dfw_fema_flood instead. Source: National Weather Service (api.weather.gov)."
  ),
  inputSchema: {
    address: z.string().min(5).optional()
      .describe('Street address to check (geocoded). Example: "1500 Marilla St Dallas TX". Defaults to downtown Dallas.'),
    lat: z.number().min(-90).max(90).optional().describe("Latitude (WGS-84). Use with lng to skip geocoding."),
    lng: z.number().min(-180).max(180).optional().describe("Longitude (WGS-84). Use with lat to skip geocoding."),
  },
  async handler({ address, lat, lng }) {
    let usedLat, usedLng, matched_address = null;

    if (typeof lat === "number" && typeof lng === "number") {
      usedLat = lat; usedLng = lng;
    } else if (address) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        return errorResult(`Could not geocode address "${address}".`, {
          reason: "geocode_failed",
          query: { address },
          recovery:
            'Check the spelling and include city and ZIP (e.g. "1500 Marilla St, Dallas, TX 75201"), or pass lat + lng directly.',
        });
      }
      usedLat = geo.lat; usedLng = geo.lng; matched_address = geo.matched_address;
    } else {
      usedLat = DEFAULT_LAT; usedLng = DEFAULT_LNG; matched_address = "Downtown Dallas (default)";
    }

    const url = `${NWS_BASE}/alerts/active?point=${usedLat},${usedLng}`;
    // UpstreamError propagates to wrapHandler's central catch, which renders
    // upstreamErrorText + the reason/recovery contract.
    const res = await retryFetch(
      (signal) => fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal }),
      { source: "National Weather Service (api.weather.gov)", profile: "fast", url }
    );
    if (!res.ok) throw new Error(`NWS API rejected: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    const normalized = features.map(normalize);

    return {
      content: [
        { type: "text", text: formatResults({ location: matched_address ?? `${usedLat},${usedLng}`, lat: usedLat, lng: usedLng, results: normalized }) },
        { type: "text", text: JSON.stringify({ query: { address, lat: usedLat, lng: usedLng, matched_address }, count: normalized.length, results: normalized }, null, 2) },
      ],
    };
  },
};

function normalize(f) {
  const p = f.properties ?? {};
  return {
    event: p.event ?? null,
    headline: p.headline ?? null,
    severity: p.severity ?? null,
    urgency: p.urgency ?? null,
    certainty: p.certainty ?? null,
    onset: p.onset ?? null,
    expires: p.expires ?? null,
    sender: p.senderName ?? null,
    area_desc: p.areaDesc ?? null,
    instruction: p.instruction ?? null,
    source: "National Weather Service",
    source_url: f.id ?? "https://api.weather.gov/alerts/active",
  };
}

function formatResults({ location, lat, lng, results }) {
  if (results.length === 0) {
    return [`# NWS Alerts: ${location}`, "", `**Coordinates:** ${lat}, ${lng}`, "", "**No active alerts.**", "", "---", "Source: National Weather Service (api.weather.gov)", ATTRIBUTION_TAG].join("\n");
  }
  const lines = [`# NWS Alerts: ${location} -- ${results.length} active`, "", `**Coordinates:** ${lat}, ${lng}`, ""];
  for (const r of results) {
    lines.push(`## ${r.event ?? "Alert"} -- ${r.severity ?? "?"} / ${r.urgency ?? "?"}`);
    if (r.headline) lines.push(`> ${r.headline}`);
    if (r.area_desc) lines.push(`- **Area:** ${r.area_desc}`);
    if (r.onset || r.expires) lines.push(`- **Active:** ${r.onset ?? "now"} -> ${r.expires ?? "?"}`);
    if (r.instruction) {
      const instruction = r.instruction.replace(/\n+/g, " ");
      lines.push(`- **Instruction:** ${instruction.length > 400 ? `${instruction.slice(0, 400)}... (full text in the JSON payload)` : instruction}`);
    }
    lines.push("");
  }
  lines.push("---", "Source: National Weather Service (api.weather.gov)", ATTRIBUTION_TAG);
  return lines.join("\n");
}

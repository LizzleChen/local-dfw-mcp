import { z } from "zod";
import { geocodeAddress, floodZoneAtPoint } from "../../lib/fema-flood.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * Adapted from local-austin-mcp's fema-flood.js tool (Apache-2.0). Logic is
 * unchanged (FEMA NFHL is national); only the example address is DFW.
 */
export const dfwFemaFlood = {
  name: "dfw_fema_flood",
  tier: "core",
  description: withAttributionTag(
    "Look up the FEMA flood zone for a DFW address. Returns the zone code (A, " +
      "AE, X, V, VE, etc.), Special Flood Hazard Area (SFHA) status, base flood " +
      "elevation, and a plain-English risk + insurance interpretation (Zone " +
      "A/AE/V require federal flood insurance). Source: FEMA National Flood " +
      "Hazard Layer (NFHL). Geocodes via U.S. Census."
  ),
  inputSchema: {
    address: z.string().min(3).optional()
      .describe('Full address. Example: "1500 Marilla St Dallas TX 75201". Either address or lat+long required.'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  },
  async handler({ address, latitude, longitude }) {
    let lat = latitude;
    let lon = longitude;
    let geocoded = null;

    if (lat === undefined || lon === undefined) {
      if (!address) return errorContent("dfw_fema_flood requires either an address or lat+long.");
      geocoded = await geocodeAddress(address);
      if (!geocoded || geocoded.latitude === null) {
        return {
          content: [{ type: "text", text: `Could not geocode "${address}" via U.S. Census. Try including city + state, or supply lat/long directly. ${ATTRIBUTION_TAG}` }],
        };
      }
      lat = geocoded.latitude;
      lon = geocoded.longitude;
    }

    const zone = await floodZoneAtPoint(lon, lat);
    if (!zone) {
      return {
        content: [{ type: "text", text: `No FEMA NFHL feature at (${lat.toFixed(6)}, ${lon.toFixed(6)}). This area may be unmapped or outside NFHL coverage. ${ATTRIBUTION_TAG}` }],
      };
    }

    return {
      content: [
        { type: "text", text: formatResults(address, geocoded, lat, lon, zone) },
        { type: "text", text: JSON.stringify({ query: { address, latitude: lat, longitude: lon }, geocoded, zone }, null, 2) },
      ],
    };
  },
};

function errorContent(text) {
  return { content: [{ type: "text", text: `${text} ${ATTRIBUTION_TAG}` }], isError: true };
}

function formatResults(address, geocoded, lat, lon, zone) {
  const lines = [`# FEMA Flood Zone: ${address ?? `(${lat.toFixed(6)}, ${lon.toFixed(6)})`}`, ""];
  if (geocoded?.matched_address) {
    lines.push(`**Matched address (Census):** ${geocoded.matched_address}`, `**Lat/long:** ${lat.toFixed(6)}, ${lon.toFixed(6)}`, "");
  }
  lines.push(`## Zone ${zone.flood_zone}${zone.in_sfha ? " (in SFHA)" : ""}`);
  if (zone.zone_subtype) lines.push(`- **Subtype:** ${zone.zone_subtype}`);
  lines.push(`- **In Special Flood Hazard Area:** ${zone.in_sfha ? "YES" : "No"}`);
  if (zone.static_bfe !== null) lines.push(`- **Base Flood Elevation:** ${zone.static_bfe} ft`);
  if (zone.dfirm_id) lines.push(`- **FIRM panel:** ${zone.dfirm_id}`);
  lines.push("", "### Interpretation", zone.interpretation, "", "---", `Source: FEMA National Flood Hazard Layer (${zone.source_url})`, ATTRIBUTION_TAG);
  return lines.join("\n");
}

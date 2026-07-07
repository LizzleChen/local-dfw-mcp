import { z } from "zod";
import { geocodeAddress } from "../../lib/geocode.js";
import { lookupUtilityProviders, SOURCE_URL } from "../../lib/utility-ccn.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * Adapted from local-austin-mcp's utility-providers.js (Apache-2.0). Same
 * geocode -> CCN point-in-polygon flow; the CCN layers are now the statewide
 * Texas PUC FeatureServers (see lib/utility-ccn.js) so it covers all of DFW, and
 * the start-service hints are generalized to DFW providers.
 */
const START_SERVICE_HINTS = [
  { match: /CITY OF DALLAS|DALLAS WATER/, how: "City of Dallas water/wastewater: start service via Dallas Water Utilities (dallascityhall.com). A deposit may apply." },
  { match: /CITY OF FORT WORTH|FORT WORTH WATER/, how: "Fort Worth Water: start service at fortworthtexas.gov/departments/water." },
  { match: /\bWCID\b|MUD|MUNICIPAL UTILITY|WATER CONTROL|SUPPLY CORP|\bWSC\b/, how: "This is a special-purpose district or water-supply corporation — contact it directly (often via an operator like Inframark) to start service; districts can add line items to the tax bill." },
  { match: /AQUA|SOUTHWEST WATER/, how: "Private utility — start new service by phone/online with the named provider." },
];

export const dfwUtilityProviders = {
  name: "dfw_utility_providers",
  tier: "core",
  description: withAttributionTag(
    "Find the WATER and SEWER (wastewater) utility obligated to serve a DFW " +
      "address — the 'who turns on my water' question. DFW is a patchwork of " +
      "cities, MUDs/WCIDs, water-supply corporations, and private utilities. " +
      "Returns the certificated (CCN) provider for the exact point. Source: " +
      "Texas PUC Certificate of Convenience and Necessity boundaries. Covers all " +
      "of Texas. Does NOT start service — it tells you who to contact."
  ),
  inputSchema: {
    address: z.string().min(3)
      .describe('Street address in DFW. Example: "6801 Warren Pkwy, Frisco TX 75034".'),
  },
  async handler({ address }) {
    const geo = await geocodeAddress(address);
    if (!geo || typeof geo.lng !== "number" || typeof geo.lat !== "number") {
      return {
        content: [{ type: "text", text: `Could not geocode "${address}". Try including city + ZIP. ${ATTRIBUTION_TAG}` }],
        isError: true,
      };
    }

    const providers = await lookupUtilityProviders(geo.lng, geo.lat);
    const result = {
      query: { address, matched_address: geo.matched_address },
      location: { lng: geo.lng, lat: geo.lat, zip: geo.zip },
      water: providers.water,
      sewer: providers.sewer,
      source_url: SOURCE_URL,
    };

    return {
      content: [
        { type: "text", text: formatResults(geo, providers) },
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};

function startHint(name) {
  for (const h of START_SERVICE_HINTS) {
    if (h.match.test(String(name).toUpperCase())) return h.how;
  }
  return null;
}

function providerLine(label, rows) {
  if (!rows || rows.length === 0) {
    return [
      `**${label}:** no certificated provider found at this point.`,
      `_This can mean a municipal utility not mapped as a CCN polygon (common in dense urban cores), a private well/septic, or an un-mapped area — confirm with the city/utility._`,
    ];
  }
  const lines = [];
  for (const p of rows) {
    const ccn = p.ccn_no ? ` (CCN #${p.ccn_no})` : "";
    lines.push(`**${label}:** ${p.utility}${ccn}`);
    const how = startHint(p.utility);
    if (how) lines.push(`- How to start: ${how}`);
  }
  return lines;
}

function formatResults(geo, providers) {
  const lines = [
    `# Water & Sewer Provider — ${geo.matched_address || "your address"}`,
    "",
    ...providerLine("Water", providers.water),
    "",
    ...providerLine("Sewer / Wastewater", providers.sewer),
    "",
    "> Septic vs. sewer: if no sewer provider is listed, the property may be on a private septic system — confirm before closing.",
    "",
    "---",
    `Source: Texas PUC CCN service-area boundaries (${SOURCE_URL})`,
    ATTRIBUTION_TAG,
  ];
  return lines.join("\n");
}

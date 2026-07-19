import { z } from "zod";
import { geocodeAddress } from "../../lib/geocode.js";
import { queryPointInPolygon } from "../../lib/arcgis.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { errorResult } from "../../lib/register.js";

/**
 * Adapted from local-austin-mcp's austin-district-lookup.js (Apache-2.0). Same
 * geocode -> point-in-polygon pipeline and keyed-object output; the layer set is
 * DFW: City of Dallas council district + city limits (City of Dallas only),
 * plus statewide Texas county and TEA school-district boundaries (all 4 core
 * counties). Returns a keyed object, not a search envelope.
 */
const LAYERS = {
  county: {
    label: "County",
    entry: ARCGIS.txCounties,
    url: ARCGIS.txCounties.url,
    field: ARCGIS.txCounties.nameField,
    extra: ARCGIS.txCounties.fipsField,
  },
  city_limits: {
    label: "City limits (City of Dallas layer)",
    entry: ARCGIS.dallasCityLimits,
    url: ARCGIS.dallasCityLimits.url,
    field: ARCGIS.dallasCityLimits.cityField,
  },
  council_district: {
    label: "Dallas City Council District",
    entry: ARCGIS.dallasCouncilDistricts,
    url: ARCGIS.dallasCouncilDistricts.url,
    field: ARCGIS.dallasCouncilDistricts.districtField,
    extra: ARCGIS.dallasCouncilDistricts.memberField,
  },
  school_district: {
    label: "School District (ISD)",
    entry: ARCGIS.txSchoolDistricts,
    url: ARCGIS.txSchoolDistricts.url,
    field: ARCGIS.txSchoolDistricts.nameField,
  },
};

export const dfwDistrictLookup = {
  name: "dfw_district_lookup",
  tier: "core",
  description: withAttributionTag(
    "Given a DFW street address, returns the districts/jurisdictions it falls " +
      "in: county (all 4 core counties), City of Dallas council district + " +
      "council member (City of Dallas only), whether it is inside City of Dallas " +
      "limits, and school district (ISD). Pipeline: U.S. Census geocoder → " +
      "point-in-polygon against Dallas GIS and statewide Texas ArcGIS layers."
  ),
  inputSchema: {
    address: z.string().min(5)
      .describe('Full street address. Example: "1500 Marilla St Dallas TX 75201".'),
  },
  async handler({ address }) {
    const geo = await geocodeAddress(address);
    if (!geo || typeof geo.lng !== "number") {
      return errorResult(`Could not geocode address "${address}".`, {
        reason: "geocode_failed",
        query: { address },
        recovery: 'Check the spelling and include city and ZIP (e.g. "1500 Marilla St, Dallas, TX 75201").',
      });
    }

    const results = {};
    const errors = {};
    const entries = Object.entries(LAYERS);
    const settled = await Promise.allSettled(
      entries.map(async ([key, layer]) => {
        // Per-layer guard: a layer flipped to verified:false in lib/sources.js
        // is disabled here (surfaces as a per-layer error, not a dead tool).
        requireVerified(layer.entry, `dfw_district_lookup (${key})`);
        return queryPointInPolygon(layer.url, geo.lng, geo.lat, {
          outFields: layer.extra ? [layer.field, layer.extra] : layer.field,
        });
      })
    );

    settled.forEach((res, i) => {
      const [key, layer] = entries[i];
      if (res.status === "rejected") {
        errors[key] = String(res.reason?.message ?? res.reason);
        return;
      }
      const rows = res.value;
      if (!rows.length) {
        results[key] = null;
        return;
      }
      results[key] = {
        label: layer.label,
        value: rows[0][layer.field] ?? null,
        extra: layer.extra ? rows[0][layer.extra] ?? null : null,
      };
    });

    return {
      content: [
        { type: "text", text: formatResults({ address, geo, results, errors }) },
        { type: "text", text: JSON.stringify({ query: { address }, geocode: { lng: geo.lng, lat: geo.lat, matched_address: geo.matched_address }, results, errors }, null, 2) },
      ],
    };
  },
};

function formatResults({ address, geo, results, errors }) {
  const lines = [
    `# District Lookup: ${address}`,
    "",
    `**Matched address:** ${geo.matched_address}`,
    `**Coordinates:** ${geo.lat}, ${geo.lng}`,
    "",
    "## Districts",
    "",
  ];

  const order = ["county", "city_limits", "council_district", "school_district"];
  for (const key of order) {
    const r = results[key];
    const layer = LAYERS[key];
    if (!r) {
      lines.push(errors[key] ? `- **${layer.label}:** (lookup failed: ${errors[key]})` : `- **${layer.label}:** (none / outside coverage)`);
      continue;
    }
    let val = r.value ?? "(unnamed)";
    if (key === "council_district" && r.extra) val = `District ${val} — ${r.extra}`;
    if (key === "county" && r.extra) val = `${val} (FIPS ${r.extra})`;
    lines.push(`- **${layer.label}:** ${val}`);
  }

  const inDallas = results.city_limits?.value;
  if (!inDallas) {
    lines.push("", "_Not inside City of Dallas limits — City-of-Dallas-only tools (dfw_311, dfw_crime) do not cover this address._");
  }

  lines.push("", "---", "Sources: U.S. Census geocoder; Dallas GIS + statewide Texas ArcGIS open-data services.", ATTRIBUTION_TAG);
  return lines.join("\n");
}

import { z } from "zod";
import { geocodeAddress } from "../../lib/geocode.js";
import { identifyAtPoint } from "../../lib/arcgis.js";
import { cached } from "../../lib/cache.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * dfw_appraisal -- county appraisal-district record (owner + values) for a DFW
 * address, sourced from TxGIO's StratMap statewide republication of CAD/CAMA
 * data (see lib/sources.js: ARCGIS.txStratmapParcels).
 *
 * Design notes (new tool for local-dfw-mcp, not ported):
 *   - Address-first by construction: the upstream /query op is disabled, so we
 *     geocode (cached 24h) then MapServer /identify. There is deliberately NO
 *     owner-name or free-text search -- that reduces people-search misuse, and
 *     is a feature, not a limitation, for a local guide.
 *   - MAIL_* fields (owner mailing address) are OMITTED on purpose, same
 *     people-search-misuse reduction rationale.
 *   - identify returns every attribute as a STRING under UPPERCASE keys, blanks
 *     as whitespace-padded strings -- normalizeParcel() trims blanks to null and
 *     parses numeric fields. Values published as 0 (a known Tarrant/TAD quirk)
 *     are surfaced as "value unavailable", never as $0.
 */
export const dfwAppraisal = {
  name: "dfw_appraisal",
  tier: "core",
  description: withAttributionTag(
    "Look up the county appraisal-district record for a DFW address (Texas " +
      "statewide; DFW's 4 core counties verified): owner, appraised land / " +
      "improvement / market value from the 2025 certified appraisal roll, year " +
      "built, land use, acreage. Appraised value is NOT a tax bill. Not a " +
      "consumer report — not for FCRA-regulated (tenant/employment) screening. " +
      "Source: TxGIO StratMap (county appraisal data)."
  ),
  inputSchema: {
    address: z.string().min(3).optional()
      .describe('Full address. Example: "1500 Marilla St Dallas TX 75201". Either address or latitude+longitude required.'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  },
  async handler({ address, latitude, longitude }) {
    let lat = latitude;
    let lng = longitude;
    let geocoded = null;

    if (lat === undefined || lng === undefined) {
      if (!address) return errorContent("dfw_appraisal requires either an address or latitude+longitude.");
      geocoded = await cached(`geo:${address}`, 24 * 3600e3, () => geocodeAddress(address));
      if (!geocoded || typeof geocoded.lng !== "number" || typeof geocoded.lat !== "number") {
        return {
          content: [{ type: "text", text: `Could not geocode "${address}" via U.S. Census. Try including city + state, or supply latitude/longitude directly. ${ATTRIBUTION_TAG}` }],
        };
      }
      lat = geocoded.lat;
      lng = geocoded.lng;
    }

    const layer = requireVerified(ARCGIS.txStratmapParcels, "dfw_appraisal");
    // The Census geocoder returns street-INTERPOLATED points that sit in the
    // road right-of-way, several metres off the parcel rooftop. A 1-2px identify
    // tolerance therefore returns "no parcel found" for most real addresses, so
    // we use a modest reach (~9m: extentPad 0.0025deg over a 400px image at tol
    // 8) that lands on the intended parcel while rarely pulling in neighbours.
    const raw = await identifyAtPoint(layer.url, lng, lat, {
      layers: `all:${layer.layer}`,
      tolerance: 8,
      extentPad: 0.0025,
    });
    const parcels = raw.map(normalizeParcel);

    if (parcels.length === 0) {
      return {
        content: [{ type: "text", text: `No parcel found at (${lat.toFixed(6)}, ${lng.toFixed(6)})${address ? ` for "${address}"` : ""}. This point may be outside the four core DFW counties, in public right-of-way, or the geocode may have landed off-parcel — try a more specific address or supply latitude/longitude. ${ATTRIBUTION_TAG}` }],
      };
    }

    const payload = {
      query: { address, latitude: lat, longitude: lng },
      geocoded,
      count: parcels.length,
      parcels,
    };

    return {
      content: [
        { type: "text", text: formatResults(address, geocoded, lat, lng, parcels, layer.layerUrl) },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  },
};

function errorContent(text) {
  return { content: [{ type: "text", text: `${text} ${ATTRIBUTION_TAG}` }], isError: true };
}

// --- normalization -------------------------------------------------------

/** Trim a whitespace-padded upstream string; blank -> null. */
function clean(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Parse a numeric string; blank/unparseable -> null. */
function num(v) {
  const t = clean(v);
  if (t === null) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "20250801" -> "2025-08-01"; anything else passed through cleaned. */
function isoDate(v) {
  const t = clean(v);
  if (t === null) return null;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

/** Compose a clean situs address from components, falling back to SITUS_ADDR. */
function composeSitus(a) {
  const num_ = clean(a.SITUS_NUM);
  const street = clean(a.SITUS_ST_1);
  const city = clean(a.SITUS_CITY);
  const state = clean(a.SITUS_STAT);
  const zip = clean(a.SITUS_ZIP);
  const line1 = [num_, street].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const line2 = [city, [state, zip].filter(Boolean).join(" ").trim()].filter(Boolean).join(", ");
  const composed = [line1, line2].filter(Boolean).join(", ");
  if (composed) return composed;
  // Fallback: collapse the raw SITUS_ADDR's padding and stray spaces-before-commas.
  const rawSitus = clean(a.SITUS_ADDR);
  return rawSitus ? rawSitus.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim() : null;
}

/**
 * Values published as 0 are a known county-publication quirk (Tarrant/TAD) --
 * never surface a real $0. Return { value, suppressed } where value is null and
 * suppressed=true when the upstream value was 0.
 */
function value(v) {
  const n = num(v);
  if (n === 0) return { value: null, suppressed: true };
  return { value: n, suppressed: false };
}

function normalizeParcel(a) {
  const land = value(a.LAND_VALUE);
  const imp = value(a.IMP_VALUE);
  const market = value(a.MKT_VALUE);
  const suppressed = land.suppressed || imp.suppressed || market.suppressed;

  const parcel = {
    prop_id: clean(a.PROP_ID),
    owner_name: clean(a.OWNER_NAME),
    name_care: clean(a.NAME_CARE),
    situs_address: composeSitus(a),
    situs: {
      number: clean(a.SITUS_NUM),
      street: clean(a.SITUS_ST_1),
      city: clean(a.SITUS_CITY),
      state: clean(a.SITUS_STAT),
      zip: clean(a.SITUS_ZIP),
    },
    land_value: land.value,
    improvement_value: imp.value,
    market_value: market.value,
    tax_year: num(a.TAX_YEAR),
    year_built: num(a.YEAR_BUILT),
    legal_description: clean(a.LEGAL_DESC),
    legal_area: clean(a.LEGAL_AREA),
    legal_area_unit: clean(a.LGL_AREA_UNIT),
    state_land_use: clean(a.STAT_LAND_USE),
    local_land_use: clean(a.LOC_LAND_USE),
    county: clean(a.COUNTY),
    fips: clean(a.FIPS),
    source: clean(a.SOURCE),
    date_acquired: isoDate(a.DATE_ACQ),
  };
  if (suppressed) {
    parcel.value_note =
      "One or more values are published as 0 by the county appraisal district (a known publication quirk); treated as unavailable rather than a real zero-dollar value.";
  }
  return parcel;
}

// --- rendering -----------------------------------------------------------

const VALUE_UNAVAILABLE = "_value unavailable (county publication quirk)_";

function usd(n) {
  if (n === null || n === undefined) return VALUE_UNAVAILABLE;
  return `$${n.toLocaleString("en-US")}`;
}

function parcelSection(p, i, total) {
  const heading = total > 1 ? `## Parcel ${i + 1} of ${total}` : `## Parcel`;
  const lines = [heading];
  if (p.situs_address) lines.push(`**Situs:** ${p.situs_address}`);
  if (p.prop_id) lines.push(`**Property ID:** ${p.prop_id}`);
  if (p.owner_name) lines.push(`**Owner:** ${p.owner_name}`);
  if (p.name_care) lines.push(`**In care of:** ${p.name_care}`);
  lines.push("");
  lines.push(`| Value (2025 certified roll) | Amount |`);
  lines.push(`|---|---|`);
  lines.push(`| Land | ${usd(p.land_value)} |`);
  lines.push(`| Improvement | ${usd(p.improvement_value)} |`);
  lines.push(`| **Market (total)** | **${usd(p.market_value)}** |`);
  lines.push("");
  if (p.year_built) lines.push(`- **Year built:** ${p.year_built}`);
  if (p.legal_area) lines.push(`- **Legal area:** ${p.legal_area}${p.legal_area_unit ? ` (${p.legal_area_unit})` : ""}`);
  if (p.legal_description) lines.push(`- **Legal description:** ${p.legal_description}`);
  const landUse = [p.state_land_use, p.local_land_use].filter(Boolean).join(" / ");
  if (landUse) lines.push(`- **Land use:** ${landUse}`);
  const countyLine = [p.county ? `${p.county} County` : null, p.source].filter(Boolean).join(" — ");
  if (countyLine) lines.push(`- **County / source:** ${countyLine}`);
  if (p.tax_year) lines.push(`- **Tax year:** ${p.tax_year}`);
  if (p.value_note) lines.push("", `> ${p.value_note}`);
  return lines.join("\n");
}

function formatResults(address, geocoded, lat, lng, parcels, sourceUrl) {
  const header = address ? `# County Appraisal: ${address}` : `# County Appraisal: (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
  const lines = [header, ""];
  if (geocoded?.matched_address) {
    lines.push(`**Matched address (Census):** ${geocoded.matched_address}`, `**Lat/long:** ${lat.toFixed(6)}, ${lng.toFixed(6)}`, "");
  }
  if (parcels.length > 1) {
    lines.push(
      `> **${parcels.length} parcels matched near this point.** This lookup finds parcels by a geocoded location (not by parcel number), so results may be stacked units (condo/duplex) **or adjacent lots** caught near the boundary — confirm which one you meant using the **Situs** address on each.`,
      ""
    );
  } else {
    lines.push(
      `> Matched by geocoded location, which can land on or beside a neighboring lot — confirm the **Situs** address below is the property you meant.`,
      ""
    );
  }
  parcels.forEach((p, i) => {
    lines.push(parcelSection(p, i, parcels.length), "");
  });
  lines.push(
    "### Caveats",
    "- **2025 certified roll** — an annual snapshot, not live data.",
    "- **Appraised value ≠ tax bill** — exemptions (homestead, over-65, etc.) and tax rates come from the county tax assessor-collector, not this layer.",
    "- **Not a consumer report** — do not use for tenant, employment, credit, or other FCRA-regulated screening.",
    "",
    "---",
    `Source: ${sourceUrl}`,
    "Texas Geographic Information Office (TxGIO) StratMap Land Parcels — data from county appraisal districts.",
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

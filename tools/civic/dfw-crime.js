import { z } from "zod";
import { sodaQuery, sodaAddressLike, sodaTextLike, encodeCursor, decodeCursor } from "../../lib/soda.js";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { datastoreSearchSql, ilikeClause, sqlEscape } from "../../lib/ckan.js";
import { SODA, ARCGIS, CKAN, requireVerified } from "../../lib/sources.js";
import { resolveCityJurisdiction, streetPart } from "../../lib/metro-router.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * City of Dallas police incidents (Socrata qv6i-rri7, "Police Incidents",
 * updated daily). Addresses are BLOCK-LEVEL (privacy-rounded upstream). Runs the
 * "no wrong-city silent success" guard before querying.
 *
 * v0.2 adds a Fort Worth branch (city="fortworth", ArcGIS "Police Crime Data"
 * layer, live-verified 2026-07-14). v0.3 adds a Denton branch (city="denton",
 * CKAN "denton-crime-data" resource, live-verified 2026-07-15). Both are
 * EXPLICIT-only overrides alongside the original Dallas path, same pattern:
 * neither has its own ground-truth city-limits polygon (only Dallas does), so
 * routing is decided entirely by the `city` argument, never auto-detected from
 * an address. Default behavior when `city` is omitted is UNCHANGED (Dallas,
 * with the v0.1 auto-detect guard).
 *
 * NOT a consumer report -- not for FCRA-regulated (tenant/employment) screening.
 */
const DS_META = SODA.dallas.police;
const BASE = SODA.dallas.base;
const SOURCE_URL = `${BASE}/d/${DS_META.id}`;

const FW_SOURCE_LABEL = "City of Fort Worth Police Department -- Crime Data";
const FW_SOURCE_URL = ARCGIS.fortWorthCrime.url;

const DENTON_SOURCE_LABEL = "City of Denton Police Department -- Crime Data (CKAN)";
const DENTON_SOURCE_URL = CKAN.denton.crime.packageUrl;

export const dfwCrime = {
  name: "dfw_crime",
  tier: "core",
  description: withAttributionTag(
    "City of Dallas (default), Fort Worth (city=\"fortworth\", v0.2), or Denton " +
      "(city=\"denton\", v0.3) -- no other city wired. Search police incidents " +
      "by (block-level) address and/or offense type. Returns incident number, " +
      "offense, date, premise (Dallas) or location type (Fort Worth) or agency " +
      "(Denton), division/sector/beat (Dallas/Fort Worth), and status. " +
      "Addresses are block-level (privacy-rounded upstream). NOT a consumer " +
      "report — do not use for tenant, employment, or other FCRA-regulated " +
      "screening. Sources: Dallas Police Department Open Data / City of Fort " +
      "Worth Police Crime Data / City of Denton Police crime data (CKAN)."
  ),
  inputSchema: {
    address: z.string().min(3).optional()
      .describe('Block-level street address, contains-match. Example: "3400 Ladd St".'),
    offense: z.string().min(2).optional()
      .describe('Free-text offense filter, e.g. "burglary", "theft", "assault".'),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("ISO date (YYYY-MM-DD); only incidents on/after it. Defaults to 90 days ago."),
    city: z.enum(["dallas", "fortworth", "denton", "auto"]).optional()
      .describe('Jurisdiction: "dallas" (default) queries Dallas PD (Socrata); "fortworth" (v0.2) queries Fort Worth PD Crime Data (ArcGIS); "denton" (v0.3) queries Denton PD crime data (CKAN, 2019-11-06 -> present); "auto" (Dallas only) resolves Dallas-vs-elsewhere from the address, unchanged from v0.1. Fort Worth/Denton are used ONLY when that exact city value is passed explicitly -- an address that geocodes into Fort Worth or Denton without that flag is still refused as "not covered" by the Dallas path.'),
    limit: z.number().int().min(1).max(200).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ address, offense, since_date, city, limit, cursor }) {
    if (city === "fortworth") {
      return handleFortWorth({ address, offense, since_date, limit, cursor });
    }
    if (city === "denton") {
      return handleDenton({ address, offense, since_date, limit, cursor });
    }

    const ds = requireVerified(DS_META, "dfw_crime");

    const jur = await resolveCityJurisdiction({ address, city }, "dallas");
    if (!jur.ok) {
      return refusal(jur.message, { address, offense, since_date });
    }

    if (!address && !offense) {
      return refusal(
        "dfw_crime requires at least one of: address or offense (an unfiltered " +
          "query over the full dataset would be too large).",
        { address, offense }
      );
    }

    const where = [];
    // Match only the street portion -- incident_address is a bare block address
    // (e.g. "3424 LADD ST"), so a full "St City TX ZIP" input would match zero rows.
    if (address) where.push(sodaAddressLike(DS_META.addressField, streetPart(address) || address));
    if (offense) where.push(sodaTextLike(DS_META.offenseField, offense));
    const effectiveSince = since_date ?? defaultSince90();
    where.push(`${DS_META.dateField} >= '${effectiveSince}'`);

    const pageSize = limit ?? 25;
    const offset = decodeCursor(cursor)?.offset ?? 0;

    const rows = await sodaQuery(ds.id, {
      base: BASE,
      where: where.join(" AND "),
      order: `${DS_META.dateField} DESC`,
      limit: pageSize + 1,
      offset,
    });

    const hasMore = rows.length > pageSize;
    const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalize);
    const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

    const payload = {
      query: { address, offense, since: effectiveSince },
      routing: jur.assumed ? "assumed City of Dallas" : `City of Dallas (${jur.resolvedBy})`,
      count: page.length,
      results: page,
      nextCursor,
      offset,
    };

    return {
      content: [
        { type: "text", text: formatResults(payload, jur, nextCursor) },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  },
};

function defaultSince90() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

// --- Fort Worth branch (v0.2) ------------------------------------------

async function handleFortWorth({ address, offense, since_date, limit, cursor }) {
  const entry = requireVerified(ARCGIS.fortWorthCrime, "dfw_crime (fortworth)");

  if (!address && !offense) {
    return refusal(
      'dfw_crime (city="fortworth") requires at least one of: address or offense ' +
        "(an unfiltered query over the full dataset would be too large).",
      { address, offense, city: "fortworth" }
    );
  }

  const whereParts = [];
  // BLOCK_ADDRESS is a bare block address (e.g. "3200 N MAIN ST"), same shape
  // as Dallas's incident_address -- strip city/state/ZIP the same way.
  if (address) whereParts.push(likeClause("BLOCK_ADDRESS", streetPart(address) || address));
  if (offense) {
    whereParts.push(
      `(${likeClause("Nature_Of_Call", offense)} OR ${likeClause("Offense_Desc", offense)})`
    );
  }
  const effectiveSince = since_date ?? defaultSince90();
  // Reported_Date is a STRING field ("YYYY-MM-DDTHH:MM:SS"), not an ArcGIS
  // date type -- compare as a plain quoted string, not a TIMESTAMP literal.
  whereParts.push(`Reported_Date >= '${effectiveSince}'`);
  const where = whereParts.join(" AND ");

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const rows = await queryLayer(entry.url, {
    where,
    outFields: [
      "Case_No", "Case_No_Offense", "Reported_Date", "From_Date", "Nature_Of_Call",
      "Offense", "Offense_Desc", "BLOCK_ADDRESS", "City", "Beat", "Division",
      "CouncilDistrict", "Attempt_Complete", "LocationTypeDescription",
    ],
    resultRecordCount: pageSize + 1,
    resultOffset: offset,
    orderByFields: "Reported_Date DESC",
    returnGeometry: false,
  });

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeFortWorth);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { address, offense, since: effectiveSince, city: "fortworth" },
    routing: "City of Fort Worth (city parameter)",
    count: page.length,
    results: page,
    nextCursor,
    offset,
  };

  return {
    content: [
      { type: "text", text: formatFortWorthResults(payload, nextCursor) },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function attemptCompleteLabel(v) {
  if (v === "C") return "Complete";
  if (v === "A") return "Attempted";
  return v ?? null;
}

function normalizeFortWorth(a) {
  return {
    incident_number: a.Case_No ?? null,
    case_no_offense: a.Case_No_Offense ?? null,
    offense: a.Nature_Of_Call ?? null,
    offense_desc: a.Offense_Desc ?? null,
    offense_code: a.Offense ?? null,
    occurred_date: dateOnly(a.From_Date),
    reported_date: dateOnly(a.Reported_Date),
    status: attemptCompleteLabel(a.Attempt_Complete),
    division: a.Division ?? null,
    beat: a.Beat ?? null,
    council_district: a.CouncilDistrict ?? null,
    address: a.BLOCK_ADDRESS ?? null,
    zip: null,
    city: a.City ?? null,
    location_type: a.LocationTypeDescription ?? null,
    source: FW_SOURCE_LABEL,
    source_url: FW_SOURCE_URL,
  };
}

function formatFortWorthResults(p, nextCursor) {
  const lines = [];
  const queryParts = [];
  if (p.query.address) queryParts.push(`"${p.query.address}"`);
  if (p.query.offense) queryParts.push(`offense=${p.query.offense}`);
  queryParts.push(`since ${p.query.since}`);
  lines.push(
    `# Fort Worth Police Crime Data: ${queryParts.join(", ")} -- ${p.count} incident${p.count === 1 ? "" : "s"}`,
    "",
  );

  const byOff = {};
  for (const r of p.results) {
    const t = r.offense ?? "Unknown";
    byOff[t] = (byOff[t] ?? 0) + 1;
  }
  const top = Object.entries(byOff).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([t, n]) => `${t} (${n})`).join(", ");
  if (top) lines.push(`**Top offenses:** ${top}`, "");

  for (const r of p.results.slice(0, 15)) {
    lines.push(`## ${r.occurred_date ?? "(no date)"} — ${r.offense ?? "Incident"}`);
    lines.push(`- **Incident #:** ${r.incident_number ?? "?"}  |  **Status:** ${r.status ?? "?"}`);
    if (r.offense_desc) lines.push(`- **Offense:** ${r.offense_desc}`);
    if (r.location_type) lines.push(`- **Location type:** ${r.location_type}`);
    if (r.address) lines.push(`- **Block:** ${r.address}`);
    if (r.division || r.beat) lines.push(`- **Division/Beat:** ${r.division ?? "?"} / ${r.beat ?? "?"}`);
    lines.push("");
  }
  if (p.results.length > 15) lines.push(`...and ${p.results.length - 15} more in the JSON payload below.`, "");

  if (nextCursor) {
    lines.push(`*More incidents available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }
  lines.push(
    "---",
    `Source: ${FW_SOURCE_LABEL} (${FW_SOURCE_URL}). Addresses are block-level. ` +
      `Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

// --- Denton branch (v0.3) ------------------------------------------------

async function handleDenton({ address, offense, since_date, limit, cursor }) {
  const entry = requireVerified(CKAN.denton.crime, "dfw_crime (denton)");

  if (!address && !offense) {
    return refusal(
      'dfw_crime (city="denton") requires at least one of: address or offense ' +
        "(an unfiltered query over the full dataset would be too large).",
      { address, offense, city: "denton" }
    );
  }

  const whereParts = [];
  // Public_Address is block-level/often house-number-free (e.g. "MORSE ST
  // DENTON TX ", trailing space) -- strip city/state/ZIP the same way as the
  // Dallas/Fort Worth branches so a full one-line input still matches.
  if (address) whereParts.push(ilikeClause('"Public_Address"', streetPart(address) || address));
  if (offense) whereParts.push(ilikeClause('"Crime"', offense));
  const effectiveSince = since_date ?? defaultSince90();
  // "Date/Time" is a TEXT field ("YYYY-MM-DD HH:MM", zero-padded) -- a plain
  // quoted string compare is correct and sorts chronologically.
  whereParts.push(`"Date/Time" >= '${sqlEscape(effectiveSince)}'`);
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const sql =
    `SELECT * FROM "${entry.resourceId}" ${where} ` +
    `ORDER BY "Date/Time" DESC LIMIT ${pageSize + 1} OFFSET ${offset}`;
  const rows = await datastoreSearchSql(CKAN.denton.base, sql);

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeDenton);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { address, offense, since: effectiveSince, city: "denton" },
    routing: "City of Denton (city parameter)",
    count: page.length,
    results: page,
    nextCursor,
    offset,
  };

  return {
    content: [
      { type: "text", text: formatDentonResults(payload, nextCursor) },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function normalizeDenton(r) {
  const dt = r["Date/Time"] ?? null;
  return {
    incident_number: r.ID ?? null,
    offense: r.Crime ?? null,
    occurred_date: dt ? String(dt).slice(0, 10) : null,
    occurred_time: dt ? String(dt).slice(11, 16) || null : null,
    address: r.Public_Address ? String(r.Public_Address).trim() : null,
    agency: r.Agency ?? null,
    zip: null,
    city: "Denton",
    source: DENTON_SOURCE_LABEL,
    source_url: DENTON_SOURCE_URL,
  };
}

function formatDentonResults(p, nextCursor) {
  const lines = [];
  const queryParts = [];
  if (p.query.address) queryParts.push(`"${p.query.address}"`);
  if (p.query.offense) queryParts.push(`offense=${p.query.offense}`);
  queryParts.push(`since ${p.query.since}`);
  lines.push(
    `# Denton Police Crime Data: ${queryParts.join(", ")} -- ${p.count} incident${p.count === 1 ? "" : "s"}`,
    "> Coverage: 2019-11-06 to present, Denton PD. Addresses are block-level and often house-number-free upstream.",
    "",
  );

  const byOff = {};
  for (const r of p.results) {
    const t = r.offense ?? "Unknown";
    byOff[t] = (byOff[t] ?? 0) + 1;
  }
  const top = Object.entries(byOff).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([t, n]) => `${t} (${n})`).join(", ");
  if (top) lines.push(`**Top offenses:** ${top}`, "");

  for (const r of p.results.slice(0, 15)) {
    lines.push(`## ${r.occurred_date ?? "(no date)"} — ${r.offense ?? "Incident"}`);
    lines.push(`- **Incident #:** ${r.incident_number ?? "?"}  |  **Time:** ${r.occurred_time ?? "?"}  |  **Agency:** ${r.agency ?? "?"}`);
    if (r.address) lines.push(`- **Block:** ${r.address}`);
    lines.push("");
  }
  if (p.results.length > 15) lines.push(`...and ${p.results.length - 15} more in the JSON payload below.`, "");

  if (nextCursor) {
    lines.push(`*More incidents available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }
  lines.push(
    "---",
    `Source: ${DENTON_SOURCE_LABEL} (${DENTON_SOURCE_URL}). Addresses are block-level. ` +
      `Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

function normalize(r) {
  return {
    incident_number: r.incidentnum ?? null,
    service_number: r.servnumid ?? null,
    offense: r.offincident ?? null,
    nibrs_crime: r.nibrs_crime ?? null,
    premise: r.premise ?? null,
    occurred_date: dateOnly(r.date1),
    reported_date: dateOnly(r.reporteddate),
    status: r.status ?? null,
    division: r.division ?? null,
    sector: r.sector ?? null,
    beat: r.beat ?? null,
    address: r.incident_address ?? null,
    zip: r.zip_code ?? null,
    city: r.city ?? null,
    source: "City of Dallas Police Department — Police Incidents",
    source_url: SOURCE_URL,
  };
}

function dateOnly(s) {
  if (!s) return null;
  return String(s).slice(0, 10);
}

function refusal(message, query) {
  return {
    content: [{ type: "text", text: `${message}\n\n---\n${ATTRIBUTION_TAG}` }],
    structuredContent: { query, not_covered: true, count: 0, results: [], message },
  };
}

function formatResults(p, jur, nextCursor) {
  const lines = [];
  if (jur.assumed && jur.note) lines.push(`> ${jur.note}`, "");
  const queryParts = [];
  if (p.query.address) queryParts.push(`"${p.query.address}"`);
  if (p.query.offense) queryParts.push(`offense=${p.query.offense}`);
  queryParts.push(`since ${p.query.since}`);
  lines.push(
    `# Dallas Police Incidents: ${queryParts.join(", ")} -- ${p.count} incident${p.count === 1 ? "" : "s"}`,
    "",
  );

  const byOff = {};
  for (const r of p.results) {
    const t = r.offense ?? "Unknown";
    byOff[t] = (byOff[t] ?? 0) + 1;
  }
  const top = Object.entries(byOff).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([t, n]) => `${t} (${n})`).join(", ");
  if (top) lines.push(`**Top offenses:** ${top}`, "");

  for (const r of p.results.slice(0, 15)) {
    lines.push(`## ${r.occurred_date ?? "(no date)"} — ${r.offense ?? "Incident"}`);
    lines.push(`- **Incident #:** ${r.incident_number ?? "?"}  |  **Status:** ${r.status ?? "?"}`);
    if (r.premise) lines.push(`- **Premise:** ${r.premise}`);
    if (r.address) lines.push(`- **Block:** ${r.address}${r.zip ? ` (${r.zip})` : ""}`);
    if (r.division) lines.push(`- **Division/Sector/Beat:** ${r.division} / ${r.sector ?? "?"} / ${r.beat ?? "?"}`);
    lines.push("");
  }
  if (p.results.length > 15) lines.push(`...and ${p.results.length - 15} more in the JSON payload below.`, "");

  if (nextCursor) {
    lines.push(`*More incidents available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }
  lines.push(
    "---",
    `Source: Dallas Police Incidents (${SOURCE_URL}). Addresses are block-level. ` +
      `Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

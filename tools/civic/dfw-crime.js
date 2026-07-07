import { z } from "zod";
import { sodaQuery, sodaAddressLike, sodaTextLike, encodeCursor, decodeCursor } from "../../lib/soda.js";
import { SODA, requireVerified } from "../../lib/sources.js";
import { resolveCityJurisdiction, streetPart } from "../../lib/metro-router.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * City of Dallas police incidents (Socrata qv6i-rri7, "Police Incidents",
 * updated daily). Addresses are BLOCK-LEVEL (privacy-rounded upstream). Runs the
 * "no wrong-city silent success" guard before querying.
 *
 * NOT a consumer report -- not for FCRA-regulated (tenant/employment) screening.
 */
const DS_META = SODA.dallas.police;
const BASE = SODA.dallas.base;
const SOURCE_URL = `${BASE}/d/${DS_META.id}`;

export const dfwCrime = {
  name: "dfw_crime",
  tier: "core",
  description: withAttributionTag(
    "City of Dallas only (v0.1). Search Dallas Police incidents by (block-level) " +
      "address and/or offense type. Returns incident number, offense, date, " +
      "premise, division/sector/beat, and status. Addresses are block-level " +
      "(privacy-rounded upstream). NOT a consumer report — do not use for " +
      "tenant, employment, or other FCRA-regulated screening. Source: Dallas " +
      "Police Department Open Data."
  ),
  inputSchema: {
    address: z.string().min(3).optional()
      .describe('Block-level street address, contains-match. Example: "3400 Ladd St".'),
    offense: z.string().min(2).optional()
      .describe('Free-text offense filter, e.g. "burglary", "theft", "assault".'),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("ISO date (YYYY-MM-DD); only incidents on/after it. Defaults to 90 days ago."),
    city: z.enum(["dallas", "auto"]).optional()
      .describe('Jurisdiction override. v0.1 covers "dallas" only; "auto" (default) resolves from the address.'),
    limit: z.number().int().min(1).max(200).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ address, offense, since_date, city, limit, cursor }) {
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

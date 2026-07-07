import { z } from "zod";
import { sodaQuery, sodaAddressLike, sodaTextLike, sodaTextEq, encodeCursor, decodeCursor } from "../../lib/soda.js";
import { SODA, requireVerified } from "../../lib/sources.js";
import { resolveCityJurisdiction, streetPart } from "../../lib/metro-router.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * City of Dallas 311 service requests (Socrata d7e7-envw, "311 Service Requests
 * October 1, 2020 to Present", updated daily). Address contains-match. Runs the
 * "no wrong-city silent success" pre-flight guard before querying.
 */
const DS_META = SODA.dallas.sr311;
const BASE = SODA.dallas.base;
const SOURCE_URL = `${BASE}/d/${DS_META.id}`;

export const dfw311 = {
  name: "dfw_311",
  tier: "core",
  description: withAttributionTag(
    "City of Dallas only (v0.1). Search Dallas 311 service requests by address " +
      "and/or type (code complaints, potholes, illegal dumping, dead animals, " +
      "etc.). Returns request number, type, department, status, dates, and " +
      "council district. Use for neighborhood quality-of-life research. " +
      "Authoritative source: City of Dallas Open Data."
  ),
  inputSchema: {
    address: z.string().min(3).optional()
      .describe('Street address, contains-match. Example: "1500 Marilla St".'),
    service_type: z.string().min(2).optional()
      .describe('Free-text type filter, e.g. "pothole", "illegal dumping", "code".'),
    status: z.string().min(2).optional()
      .describe('Filter by status, e.g. "Open", "Closed", "In Progress".'),
    since_year: z.number().int().min(2020).max(2100).optional()
      .describe("Only requests created on/after this year. Defaults to 2 years back."),
    city: z.enum(["dallas", "auto"]).optional()
      .describe('Jurisdiction override. v0.1 covers "dallas" only; "auto" (default) resolves from the address.'),
    limit: z.number().int().min(1).max(200).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ address, service_type, status, since_year, city, limit, cursor }) {
    const ds = requireVerified(DS_META, "dfw_311");

    // Hard rule: never silently query City of Dallas data for a wrong-city address.
    const jur = await resolveCityJurisdiction({ address, city }, "dallas");
    if (!jur.ok) {
      return refusal(jur.message, { address, service_type, status, since_year });
    }

    if (!address && !service_type && !status) {
      return refusal(
        "dfw_311 requires at least one of: address, service_type, or status " +
          "(an unfiltered query over the full dataset would be too large).",
        { address, service_type, status }
      );
    }

    const where = [];
    // Match only the street portion -- the dataset stores comma-separated
    // addresses, so a full "St City TX ZIP" input would match zero rows.
    if (address) where.push(sodaAddressLike(DS_META.addressField, streetPart(address) || address));
    if (service_type) where.push(sodaTextLike(DS_META.typeField, service_type));
    if (status) where.push(sodaTextEq(DS_META.statusField, status));
    const effectiveSince = since_year ?? new Date().getFullYear() - 2;
    where.push(`${DS_META.dateField} >= '${effectiveSince}-01-01T00:00:00.000'`);

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
      query: { address, service_type, status, since_year: effectiveSince },
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

function normalize(r) {
  return {
    service_request_number: r.service_request_number ?? null,
    type: r.service_request_type ?? null,
    department: r.department ?? null,
    status: r.status ?? null,
    priority: r.priority ?? null,
    method_received: r.method_received_description ?? null,
    council_district: r.city_council_district ?? null,
    created_date: dateOnly(r.created_date),
    due_date: dateOnly(r.overall_service_request_due_date),
    closed_date: dateOnly(r.closed_date),
    updated_date: dateOnly(r.update_date),
    outcome: r.outcome ?? null,
    address: r.address ?? null,
    source: "City of Dallas Open Data — 311 Service Requests",
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
  if (p.query.service_type) queryParts.push(`type=${p.query.service_type}`);
  if (p.query.status) queryParts.push(`status=${p.query.status}`);
  lines.push(
    `# Dallas 311: ${queryParts.join(", ") || "recent"} -- ${p.count} request${p.count === 1 ? "" : "s"}`,
    "",
  );

  const byType = {};
  for (const r of p.results) {
    const t = r.type ?? "Unknown";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([t, n]) => `${t} (${n})`).join(", ");
  if (top) lines.push(`**Top types:** ${top}`, "");

  for (const r of p.results) {
    lines.push(`## ${r.created_date ?? "(no date)"} — ${r.type ?? "311 Request"}`);
    lines.push(`- **Request #:** ${r.service_request_number ?? "?"}  |  **Status:** ${r.status ?? "?"}`);
    if (r.department) lines.push(`- **Department:** ${r.department}`);
    if (r.council_district) lines.push(`- **Council District:** ${r.council_district}`);
    if (r.address) lines.push(`- **Address:** ${r.address}`);
    if (r.closed_date) lines.push(`- **Closed:** ${r.closed_date}`);
    lines.push("");
  }

  if (nextCursor) {
    lines.push(`*More results available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }
  lines.push("---", `Source: City of Dallas 311 (${SOURCE_URL})`, ATTRIBUTION_TAG);
  return lines.join("\n");
}

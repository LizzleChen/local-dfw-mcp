import { z } from "zod";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { streetPart } from "../../lib/metro-router.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * dfw_code_cases -- new for local-dfw-mcp (v0.2 priority-4, Fort Worth-first
 * per the plan). Dallas's code-compliance publication stalled 2025-01-31 (see
 * resources/datasets-index.md), so Dallas is deliberately NOT wired here.
 * City of Fort Worth's Code Violations ArcGIS layer is live and actively
 * maintained (verified 2026-07-14, newest Case_Created_Date 2026-06-16) and
 * is the only source this tool queries.
 *
 * Unlike dfw_permits, Fort Worth's code-violations Violation_Address field is
 * a single string (NOT componentized), so a normal contains-match works here.
 *
 * NOT a consumer report -- not for FCRA-regulated (tenant/employment) screening.
 */
const ENTRY_LABEL = "dfw_code_cases";
const SOURCE_LABEL = "City of Fort Worth Open Data -- Code Violations";
const SOURCE_URL = ARCGIS.fortWorthCodeViolations.url;

export const dfwCodeCases = {
  name: "dfw_code_cases",
  tier: "core",
  description: withAttributionTag(
    "Fort Worth ONLY (v0.2) -- Dallas's code-compliance publication stalled " +
      "2025-01-31 and is not wired (see project plan); do not claim Dallas " +
      "coverage here. Search City of Fort Worth code-compliance (property " +
      "maintenance / high grass / zoning / animal / solid waste, etc.) cases " +
      "by address, complaint type, or open/closed status. Returns case ID, " +
      "complaint type, violation/case status, created/updated dates, next " +
      "activity due date, and the assigned code officer. NOT a consumer " +
      "report -- do not use for tenant, employment, or other FCRA-regulated " +
      "screening. Source: City of Fort Worth Open Data (ArcGIS)."
  ),
  inputSchema: {
    city: z.enum(["fortworth", "dallas"]).optional()
      .describe('Only "fortworth" is wired. Omit or pass "fortworth"; "dallas" is refused -- Dallas code-case publication stalled 2025-01-31, not covered (see project plan).'),
    address: z.string().min(3).optional()
      .describe('Contains-match against the violation address (a single field, e.g. "500 Main St" or just "Main St").'),
    complaint_type: z.string().min(2).optional()
      .describe('Free text, contains-match against the complaint type, e.g. "high grass", "property maintenance", "zoning", "animal", "solid waste".'),
    status: z.enum(["open", "closed"]).optional()
      .describe("Filter by the violation's current status (open or closed)."),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("ISO date (YYYY-MM-DD); only cases created on/after it. Omit for the most recent cases regardless of date."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ city, address, complaint_type, status, since_date, limit, cursor }) {
    if (city && city !== "fortworth") {
      return refusal(
        'Not covered: Fort Worth only (Dallas not yet wired -- see project plan). Omit `city` or set city="fortworth".',
        { city, address, complaint_type, status, since_date }
      );
    }

    const entry = requireVerified(ARCGIS.fortWorthCodeViolations, ENTRY_LABEL);

    const whereParts = [];
    if (address) whereParts.push(likeClause("Violation_Address", streetPart(address) || address));
    if (complaint_type) whereParts.push(likeClause("Complaint_Type_Description", complaint_type));
    if (status) whereParts.push(`UPPER(Violation_Current_Status) = '${status.toUpperCase()}'`);
    if (since_date) whereParts.push(`Case_Created_Date >= TIMESTAMP '${since_date} 00:00:00'`);
    const where = whereParts.length ? whereParts.join(" AND ") : "1=1";

    const pageSize = limit ?? 25;
    const offset = decodeCursor(cursor)?.offset ?? 0;

    const rows = await queryLayer(entry.url, {
      where,
      outFields: [
        "Case_ID", "Complaint_Type_Description", "Violation_Address", "City",
        "Violation_Current_Status", "Case_Current_Status", "Case_Created_Date",
        "Update_Date", "Next_Activity_Due_Date", "Code_Officer",
        "Code_Officer_PhoneNo", "Latitude", "Longitude",
      ],
      resultRecordCount: pageSize + 1,
      resultOffset: offset,
      orderByFields: "Case_Created_Date DESC",
      returnGeometry: false,
    });

    const hasMore = rows.length > pageSize;
    const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalize);
    const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

    const payload = {
      query: { address, complaint_type, status, since_date },
      count: page.length,
      results: page,
      nextCursor,
      offset,
    };

    return {
      content: [
        { type: "text", text: formatResults(payload, nextCursor) },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  },
};

// --- helpers ---------------------------------------------------------------

function orNull(v) {
  return v === undefined || v === null || v === "" ? null : v;
}

function epochToDate(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
}

// Next_Activity_Due_Date arrives as a plain string like "2026-07-01 00:00:00"
// (not an ArcGIS date field) -- just take the date portion.
function dateOnlyString(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function normalize(a) {
  return {
    case_id: orNull(a.Case_ID),
    complaint_type: orNull(a.Complaint_Type_Description),
    violation_status: orNull(a.Violation_Current_Status),
    case_status: orNull(a.Case_Current_Status),
    address: orNull(a.Violation_Address),
    city: orNull(a.City),
    created: epochToDate(a.Case_Created_Date),
    updated: epochToDate(a.Update_Date),
    next_activity_due: dateOnlyString(a.Next_Activity_Due_Date),
    officer: orNull(a.Code_Officer),
    officer_phone: orNull(a.Code_Officer_PhoneNo),
    lat: a.Latitude ?? null,
    lng: a.Longitude ?? null,
    source: SOURCE_LABEL,
    source_url: SOURCE_URL,
  };
}

function refusal(message, query) {
  return {
    content: [{ type: "text", text: `${message}\n\n---\n${ATTRIBUTION_TAG}` }],
    structuredContent: { query, not_covered: true, count: 0, results: [], message },
  };
}

function resultBlock(r) {
  const lines = [`## ${r.case_id ?? "(no case id)"} -- ${r.complaint_type ?? "Code Case"}`];
  const meta = [];
  if (r.violation_status) meta.push(`**Violation status:** ${r.violation_status}`);
  if (r.case_status) meta.push(`**Case status:** ${r.case_status}`);
  if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
  // Complaint type/officer name are effectively free text (a controlled
  // vocabulary today, but upstream-authored) -- render as quoted table data
  // rather than bare prose (prompt-injection hygiene).
  if (r.address) lines.push(`- **Address:** \`${r.address}\``);
  if (r.created) lines.push(`- **Created:** ${r.created}`);
  if (r.updated) lines.push(`- **Updated:** ${r.updated}`);
  if (r.next_activity_due) lines.push(`- **Next activity due:** ${r.next_activity_due}`);
  if (r.officer) lines.push(`- **Officer:** ${r.officer}${r.officer_phone ? ` (${r.officer_phone})` : ""}`);
  lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
  return lines.join("\n");
}

function formatResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.address) parts.push(`"${q.address}"`);
  if (q.complaint_type) parts.push(`type=${q.complaint_type}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.since_date) parts.push(`since ${q.since_date}`);

  const lines = [
    `# Fort Worth Code Cases: ${parts.join(", ") || "recent"} -- ${p.count} case${p.count === 1 ? "" : "s"}`,
    "> Coverage: Fort Worth only (Dallas code-case publication stalled 2025-01-31, not wired -- see project plan).",
    "",
  ];

  if (p.count === 0) {
    lines.push(
      "No cases matched. Try a broader address, a different complaint type, or omit `since_date`.",
      ""
    );
  }

  for (const r of p.results) {
    lines.push(resultBlock(r), "");
  }

  if (nextCursor) {
    lines.push(`*More results available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }

  lines.push(
    "---",
    `Source: ${SOURCE_LABEL} (${SOURCE_URL}). Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

import { z } from "zod";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * dfw_permits -- new for local-dfw-mcp (v0.2 priority-4, Fort Worth-first per
 * the plan). Every City of Dallas permit feed is stale/dead (Socrata
 * e7gq-4sah maxes out at issued_date 2019-12-31; the best ArcGIS candidate
 * caps at 2024-11-12) -- see resources/datasets-index.md -- so Dallas is
 * deliberately NOT wired here. City of Fort Worth's Development Permits
 * ArcGIS layer is live and current (verified 2026-07-14, newest File_Date
 * same day) and is the only source this tool queries.
 *
 * Fort Worth addresses are COMPONENTIZED upstream -- there is no single situs
 * string field (Full_Street_Address is usually null). Search is therefore
 * `street` (contains-match on Street_Name) + optional `addr_no` (exact match),
 * never a contains-match against one combined address string.
 */
const ENTRY_LABEL = "dfw_permits";
const SOURCE_LABEL = "City of Fort Worth Open Data -- Development Permits";
const SOURCE_URL = ARCGIS.fortWorthPermits.url;

export const dfwPermits = {
  name: "dfw_permits",
  tier: "core",
  description: withAttributionTag(
    "Fort Worth ONLY (v0.2) -- Dallas building-permit feeds are stale/dead and " +
      "not yet wired (see project plan); do not claim Dallas coverage here. " +
      "Search City of Fort Worth building/development permits by street name " +
      "(+ optional house number), permit type, or status. Fort Worth addresses " +
      "are componentized upstream (no single situs-address field) -- match on " +
      "`street` (+ optional `addr_no`), not a one-line address. Returns permit " +
      "number, type/subtype/category, status, file/status dates, job value, " +
      "owner, and use type. Source: City of Fort Worth Open Data (ArcGIS)."
  ),
  inputSchema: {
    city: z.enum(["fortworth", "dallas"]).optional()
      .describe('Only "fortworth" is wired. Omit or pass "fortworth"; "dallas" is refused -- Dallas permit feeds are stale/dead, not covered (see project plan).'),
    street: z.string().min(2).optional()
      .describe('Street name only, contains-match against Street_Name (address is componentized -- do not include house number or suffix). Example: "Main", not "500 Main St".'),
    addr_no: z.number().int().positive().optional()
      .describe("House/building number (Addr_No), exact match. Combine with `street` to scope to one address."),
    permit_type: z.string().min(2).optional()
      .describe('Free text, contains-match against Permit_Type / Permit_SubType / Permit_Category, e.g. "electrical", "residential building", "remodel".'),
    status: z.string().min(2).optional()
      .describe('Free text, contains-match against Current_Status, e.g. "issued", "finaled", "in review".'),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("ISO date (YYYY-MM-DD); only permits filed on/after it (File_Date). Omit for the most recent permits regardless of date."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ city, street, addr_no, permit_type, status, since_date, limit, cursor }) {
    if (city && city !== "fortworth") {
      return refusal(
        'Not covered: Fort Worth only (Dallas not yet wired -- see project plan). Omit `city` or set city="fortworth".',
        { city, street, addr_no, permit_type, status, since_date }
      );
    }

    const entry = requireVerified(ARCGIS.fortWorthPermits, ENTRY_LABEL);

    const whereParts = [];
    if (street) whereParts.push(likeClause("Street_Name", street));
    if (typeof addr_no === "number") whereParts.push(`Addr_No = ${Math.trunc(addr_no)}`);
    if (permit_type) {
      whereParts.push(
        `(${likeClause("Permit_Type", permit_type)} OR ${likeClause("Permit_SubType", permit_type)} OR ${likeClause("Permit_Category", permit_type)})`
      );
    }
    if (status) whereParts.push(likeClause("Current_Status", status));
    if (since_date) whereParts.push(`File_Date >= TIMESTAMP '${since_date} 00:00:00'`);
    const where = whereParts.length ? whereParts.join(" AND ") : "1=1";

    const pageSize = limit ?? 25;
    const offset = decodeCursor(cursor)?.offset ?? 0;

    const rows = await queryLayer(entry.url, {
      where,
      outFields: [
        "Permit_No", "Permit_Type", "Permit_SubType", "Permit_Category",
        "B1_SPECIAL_TEXT", "B1_WORK_DESC", "Addr_No", "Direction", "Street_Name",
        "Street_Suffix", "Street_Suffix_Dir", "Full_Street_Address", "Zip_Code",
        "Owner_Full_Name", "File_Date", "Current_Status", "Status_Date",
        "Location_1", "JobValue", "Use_Type", "Specific_Use", "Units", "SqFt",
      ],
      resultRecordCount: pageSize + 1,
      resultOffset: offset,
      orderByFields: "File_Date DESC",
      returnGeometry: false,
    });

    const hasMore = rows.length > pageSize;
    const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalize);
    const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

    const payload = {
      query: { street, addr_no, permit_type, status, since_date },
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

function orNullNA(v) {
  const n = orNull(v);
  return n === "NA" ? null : n;
}

function epochToDate(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
}

// B1_WORK_DESC carries a real free-text description on older permits but is
// literally the placeholder string "B1_WORK_DESC" on most modern rows (an
// upstream field-mapping bug) -- filter that placeholder out rather than
// surfacing it as if it were a description.
function cleanWorkDesc(v) {
  const n = orNull(v);
  return n === "B1_WORK_DESC" ? null : n;
}

function parseLatLng(loc) {
  if (!loc || typeof loc !== "string") return null;
  const m = loc.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

function parseJobValue(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Componentized address -> a display string, for humans only (never used for
// matching -- Fort Worth publishes no single situs field to match against).
function buildAddress(a) {
  const parts = [a.Addr_No, a.Direction, a.Street_Name, a.Street_Suffix, a.Street_Suffix_Dir]
    .filter((v) => v !== null && v !== undefined && v !== "");
  if (parts.length) return parts.join(" ");
  return orNull(a.Full_Street_Address);
}

function normalize(a) {
  const loc = parseLatLng(a.Location_1);
  return {
    permit_no: orNull(a.Permit_No),
    permit_type: orNull(a.Permit_Type),
    permit_subtype: orNull(a.Permit_SubType),
    permit_category: orNullNA(a.Permit_Category),
    status: orNull(a.Current_Status),
    file_date: epochToDate(a.File_Date),
    status_date: epochToDate(a.Status_Date),
    address: buildAddress(a),
    addr_no: a.Addr_No ?? null,
    street_name: orNull(a.Street_Name),
    street_suffix: orNull(a.Street_Suffix),
    zip: a.Zip_Code ?? null,
    owner: orNull(a.Owner_Full_Name),
    job_value: parseJobValue(a.JobValue),
    use_type: orNull(a.Use_Type),
    specific_use: orNull(a.Specific_Use),
    units: orNull(a.Units),
    sqft: orNull(a.SqFt),
    special_text: orNull(a.B1_SPECIAL_TEXT),
    work_description: cleanWorkDesc(a.B1_WORK_DESC),
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
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

function truncated(text, max = 300) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function resultBlock(r) {
  const title = [r.permit_no ?? "(no permit #)", "--", r.permit_type ?? "Permit"].join(" ");
  const lines = [`## ${title}${r.permit_subtype ? ` (${r.permit_subtype})` : ""}`];
  const meta = [];
  if (r.status) meta.push(`**Status:** ${r.status}`);
  if (r.file_date) meta.push(`**Filed:** ${r.file_date}`);
  if (r.status_date) meta.push(`**Status date:** ${r.status_date}`);
  if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
  if (r.address) lines.push(`- **Address:** ${r.address}${r.zip ? ` (${r.zip})` : ""}`);
  if (r.owner) lines.push(`- **Owner:** ${r.owner}`);
  if (r.job_value !== null) lines.push(`- **Job value:** $${r.job_value.toLocaleString("en-US")}`);
  if (r.use_type) lines.push(`- **Use:** ${r.use_type}${r.specific_use ? ` / ${r.specific_use}` : ""}`);
  // Upstream free text is third-party authored -- keep it visibly quoted, not
  // rendered as bare prose (prompt-injection hygiene).
  if (r.special_text) lines.push(`> ${truncated(r.special_text)}`);
  if (r.work_description) lines.push(`> ${truncated(r.work_description)}`);
  lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
  return lines.join("\n");
}

function formatResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.street) parts.push(`street="${q.street}"`);
  if (q.addr_no) parts.push(`addr_no=${q.addr_no}`);
  if (q.permit_type) parts.push(`type=${q.permit_type}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.since_date) parts.push(`since ${q.since_date}`);

  const lines = [
    `# Fort Worth Permits: ${parts.join(", ") || "recent"} -- ${p.count} permit${p.count === 1 ? "" : "s"}`,
    "> Coverage: Fort Worth only (Dallas permit feeds are stale/dead, not wired -- see project plan).",
    "",
  ];

  if (p.count === 0) {
    lines.push(
      "No permits matched. Try a broader `street` name, drop `addr_no`, or omit `since_date`.",
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
    `Source: ${SOURCE_LABEL} (${SOURCE_URL})`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

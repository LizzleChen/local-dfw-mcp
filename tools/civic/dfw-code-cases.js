import { z } from "zod";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { streetPart } from "../../lib/metro-router.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { refusalResult } from "../../lib/register.js";

/**
 * dfw_code_cases -- new for local-dfw-mcp (v0.2 priority-4, Fort Worth-first
 * per the plan). Dallas's code-compliance publication stalled 2025-01-31 (see
 * resources/datasets-index.md), so Dallas is deliberately NOT wired here.
 * City of Fort Worth's Code Violations ArcGIS layer is live and actively
 * maintained (verified 2026-07-14, newest Case_Created_Date 2026-06-16) and
 * was the only source this tool queried until v0.3.
 *
 * v0.3 adds a McKinney branch (city="mckinney", ArcGIS "Code Enforcement
 * Cases" layer on McKinney's on-prem ArcGIS server, live-verified
 * 2026-07-15). Like Fort Worth's, McKinney's Address field is a single
 * string (not componentized), so a normal contains-match works there too.
 *
 * Unlike dfw_permits, Fort Worth's code-violations Violation_Address field is
 * a single string (NOT componentized), so a normal contains-match works here.
 *
 * v0.3 also adds an Arlington branch (city="arlington", ArcGIS "Code
 * Complaint" layer on Arlington's on-prem server, live-verified 2026-07-15).
 * FOLDERNAME is a single string address. INDATE/FINALDATE are STRING date
 * fields (zero-padded "YYYY-MM-DD") mapped to created/closed respectively;
 * LastUpdateAmanda is a genuine last-modified esriFieldTypeDate mapped to
 * `updated` -- same created/closed/updated separation just fixed for
 * McKinney (CloseDate must never be mislabeled "updated"). There is no
 * public case-ID field on this layer -- the internal ArcGIS OBJECTID is
 * surfaced labeled as an internal ID, never implied to be an official case
 * number.
 *
 * NOT a consumer report -- not for FCRA-regulated (tenant/employment) screening.
 */
const ENTRY_LABEL = "dfw_code_cases";
const SOURCE_LABEL = "City of Fort Worth Open Data -- Code Violations";
const SOURCE_URL = ARCGIS.fortWorthCodeViolations.url;

const MCK_ENTRY_LABEL = "dfw_code_cases (mckinney)";
const MCK_SOURCE_LABEL = "City of McKinney -- Code Enforcement Cases";
const MCK_SOURCE_URL = ARCGIS.mckinneyCodeCases.url;

const ARL_ENTRY_LABEL = "dfw_code_cases (arlington)";
const ARL_SOURCE_LABEL = "City of Arlington -- Code Complaint";
const ARL_SOURCE_URL = ARCGIS.arlingtonCodeComplaints.url;

export const dfwCodeCases = {
  name: "dfw_code_cases",
  tier: "core",
  description: withAttributionTag(
    "Fort Worth (default), McKinney (city=\"mckinney\", v0.3), or Arlington " +
      "(city=\"arlington\", v0.3) -- Dallas's code-compliance publication " +
      "stalled 2025-01-31 and is not wired (see project plan); do not claim " +
      "Dallas coverage here. Search code-compliance (property maintenance / " +
      "high grass / zoning / animal / solid waste, etc.) cases by address, " +
      "complaint type, or status. Returns case ID, complaint type, status, " +
      "created/updated/closed dates, and the assigned officer (Fort " +
      "Worth/McKinney only). NOT a consumer report -- do not use for " +
      "tenant, employment, or other FCRA-regulated screening. Sources: " +
      "City of Fort Worth / McKinney / Arlington Open Data (ArcGIS)."
  ),
  inputSchema: {
    city: z.enum(["fortworth", "mckinney", "arlington", "dallas"]).optional()
      .describe('Jurisdiction: "fortworth" (default), "mckinney" (v0.3), or "arlington" (v0.3) are wired; "dallas" is refused -- Dallas code-case publication stalled 2025-01-31, not covered (see project plan).'),
    address: z.string().min(3).optional()
      .describe('Contains-match against the violation address (a single field for all three cities, e.g. "500 Main St" or just "Main St").'),
    complaint_type: z.string().min(2).optional()
      .describe('Free text, contains-match against the complaint/case type, e.g. "high grass", "property maintenance", "zoning", "animal", "solid waste".'),
    status: z.string().min(2).optional()
      .describe('Free text, contains-match against the case status, e.g. "open", "closed". Fort Worth uses a clean Open/Closed enum; McKinney/Arlington status text may vary.'),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("ISO date (YYYY-MM-DD); only cases created/opened on/after it. Omit for the most recent cases regardless of date."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ city, address, complaint_type, status, since_date, limit, cursor }) {
    if (city === "mckinney") {
      return handleMcKinney({ address, complaint_type, status, since_date, limit, cursor });
    }
    if (city === "arlington") {
      return handleArlington({ address, complaint_type, status, since_date, limit, cursor });
    }
    if (city && city !== "fortworth") {
      return refusalResult(
        'Not covered: Fort Worth, McKinney, or Arlington only (Dallas not yet wired -- see project plan). Omit `city`, or set city="fortworth", city="mckinney", or city="arlington".',
        {
          query: { city, address, complaint_type, status, since_date },
          recovery:
            'Retry with city:"fortworth" (default), city:"mckinney", or city:"arlington". ' +
            "Dallas's code-case publication stalled 2025-01-31 -- say Dallas is not covered rather than guessing.",
        }
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
    closed: null,
    next_activity_due: dateOnlyString(a.Next_Activity_Due_Date),
    officer: orNull(a.Code_Officer),
    officer_phone: orNull(a.Code_Officer_PhoneNo),
    lat: a.Latitude ?? null,
    lng: a.Longitude ?? null,
    source: SOURCE_LABEL,
    source_url: SOURCE_URL,
  };
}

// --- McKinney branch (v0.3) -------------------------------------------

async function handleMcKinney({ address, complaint_type, status, since_date, limit, cursor }) {
  const entry = requireVerified(ARCGIS.mckinneyCodeCases, MCK_ENTRY_LABEL);

  const whereParts = [];
  // Address is a SINGLE string field here (like Fort Worth's), so a normal
  // contains-match works -- no componentization to worry about.
  if (address) whereParts.push(likeClause("Address", streetPart(address) || address));
  if (complaint_type) whereParts.push(likeClause("CaseType", complaint_type));
  if (status) whereParts.push(likeClause("CaseStatus", status));
  if (since_date) whereParts.push(`OpenDate >= TIMESTAMP '${since_date} 00:00:00'`);
  const where = whereParts.length ? whereParts.join(" AND ") : "1=1";

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const rows = await queryLayer(entry.url, {
    where,
    outFields: [
      "CaseNumber", "CaseType", "CaseStatus", "AssignedTo", "OpenDate",
      "CloseDate", "Address", "Parcel",
    ],
    resultRecordCount: pageSize + 1,
    resultOffset: offset,
    orderByFields: "OpenDate DESC",
    returnGeometry: false,
  });

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeMcKinney);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { city: "mckinney", address, complaint_type, status, since_date },
    count: page.length,
    results: page,
    nextCursor,
    offset,
  };

  return {
    content: [
      { type: "text", text: formatMcKinneyResults(payload, nextCursor) },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

// Reuses most of the shape resultBlock() expects (violation_status/
// case_status/created/officer/...) so the same renderer works for both
// cities. NOTE: CloseDate is a genuine case-closed date, not a last-modified
// timestamp -- mapped to `closed` (rendered "**Closed:**"), NOT `updated`
// (which Fort Worth's Update_Date -- a true last-modified field -- still
// owns), to avoid misreading a closed date as "last touched".
function normalizeMcKinney(a) {
  return {
    case_id: orNull(a.CaseNumber),
    complaint_type: orNull(a.CaseType),
    violation_status: orNull(a.CaseStatus),
    case_status: null,
    address: orNull(a.Address),
    city: "McKinney",
    created: epochToDate(a.OpenDate),
    updated: null,
    closed: epochToDate(a.CloseDate),
    next_activity_due: null,
    officer: orNull(a.AssignedTo),
    officer_phone: null,
    lat: null,
    lng: null,
    source: MCK_SOURCE_LABEL,
    source_url: MCK_SOURCE_URL,
  };
}

function formatMcKinneyResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.address) parts.push(`"${q.address}"`);
  if (q.complaint_type) parts.push(`type=${q.complaint_type}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.since_date) parts.push(`since ${q.since_date}`);

  const lines = [
    `# McKinney Code Cases: ${parts.join(", ") || "recent"} -- ${p.count} case${p.count === 1 ? "" : "s"}`,
    "> Coverage: City of McKinney only.",
    "",
  ];

  if (p.count === 0) {
    lines.push(
      "No cases matched. Try a broader address, a different case type, or omit `since_date`.",
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
    `Source: ${MCK_SOURCE_LABEL} (${MCK_SOURCE_URL}). Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

// --- Arlington branch (v0.3) -------------------------------------------

async function handleArlington({ address, complaint_type, status, since_date, limit, cursor }) {
  const entry = requireVerified(ARCGIS.arlingtonCodeComplaints, ARL_ENTRY_LABEL);

  const whereParts = [];
  if (address) whereParts.push(likeClause("FOLDERNAME", streetPart(address) || address));
  if (complaint_type) whereParts.push(likeClause("VIOLDESCRIPTION", complaint_type));
  if (status) whereParts.push(likeClause("STATUSCODE", status));
  // INDATE is a STRING field ("YYYY-MM-DD", zero-padded) -- plain quoted
  // string compare, not a TIMESTAMP literal.
  if (since_date) whereParts.push(`INDATE >= '${since_date}'`);
  const where = whereParts.length ? whereParts.join(" AND ") : "1=1";

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const rows = await queryLayer(entry.url, {
    where,
    outFields: [
      "OBJECTID", "INDATE", "FINALDATE", "STATUSCODE", "VIOLDESCRIPTION",
      "FOLDERNAME", "PROACTIVE", "LastUpdateAmanda",
    ],
    resultRecordCount: pageSize + 1,
    resultOffset: offset,
    // INDATE is a string, not an ArcGIS date type -- ORDER BY on it still
    // sorts correctly because the format is zero-padded "YYYY-MM-DD".
    orderByFields: "INDATE DESC",
    returnGeometry: false,
  });

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeArlington);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { city: "arlington", address, complaint_type, status, since_date },
    count: page.length,
    results: page,
    nextCursor,
    offset,
  };

  return {
    content: [
      { type: "text", text: formatArlingtonResults(payload, nextCursor) },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

// Reuses resultBlock()'s shape (violation_status/created/updated/closed/...).
// NOTE: INDATE -> created, FINALDATE -> closed (NOT `updated` -- mirrors the
// McKinney fix: a case-closed date must never be mislabeled last-modified).
// LastUpdateAmanda is the genuine last-modified field -> `updated`. There is
// no public case-ID field here -- OBJECTID is an internal ArcGIS row ID,
// surfaced labeled as such.
function normalizeArlington(a) {
  return {
    case_id: a.OBJECTID !== undefined && a.OBJECTID !== null ? `internal #${a.OBJECTID}` : null,
    complaint_type: orNull(a.VIOLDESCRIPTION),
    violation_status: orNull(a.STATUSCODE),
    case_status: null,
    address: orNull(a.FOLDERNAME),
    city: "Arlington",
    created: dateOnlyString(a.INDATE),
    updated: epochToDate(a.LastUpdateAmanda),
    closed: dateOnlyString(a.FINALDATE),
    next_activity_due: null,
    officer: null,
    officer_phone: null,
    lat: null,
    lng: null,
    source: ARL_SOURCE_LABEL,
    source_url: ARL_SOURCE_URL,
  };
}

function formatArlingtonResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.address) parts.push(`"${q.address}"`);
  if (q.complaint_type) parts.push(`type=${q.complaint_type}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.since_date) parts.push(`since ${q.since_date}`);

  const lines = [
    `# Arlington Code Cases: ${parts.join(", ") || "recent"} -- ${p.count} case${p.count === 1 ? "" : "s"}`,
    "> Coverage: City of Arlington only. Case IDs are internal (this layer publishes no public case number).",
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
    `Source: ${ARL_SOURCE_LABEL} (${ARL_SOURCE_URL}). Not a consumer report; not for FCRA-regulated screening.`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
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
  if (r.closed) lines.push(`- **Closed:** ${r.closed}`);
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

import { z } from "zod";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ARCGIS, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { refusalResult } from "../../lib/register.js";

/**
 * dfw_permits -- new for local-dfw-mcp (v0.2 priority-4, Fort Worth-first per
 * the plan). Every City of Dallas permit feed is stale/dead (Socrata
 * e7gq-4sah maxes out at issued_date 2019-12-31; the best ArcGIS candidate
 * caps at 2024-11-12) -- see resources/datasets-index.md -- so Dallas is
 * deliberately NOT wired here. City of Fort Worth's Development Permits
 * ArcGIS layer is live and current (verified 2026-07-14, newest File_Date
 * same day) and was the only source this tool queried until v0.3.
 *
 * Fort Worth addresses are COMPONENTIZED upstream -- there is no single situs
 * string field (Full_Street_Address is usually null). Search is therefore
 * `street` (contains-match on Street_Name) + optional `addr_no` (exact match),
 * never a contains-match against one combined address string.
 *
 * v0.3 adds a McKinney branch (city="mckinney", ArcGIS "Energov Records"
 * layer on McKinney's on-prem server, live-verified 2026-07-15) WITH A
 * CAVEAT: that layer has NO DATE FIELD at all, so `address` is REQUIRED for
 * city="mckinney" (there is no newest-first browsing/listing there) and
 * results are ordered by ENT_NUMBER DESC, which only roughly groups recent
 * cases (not a true chronological sort) -- both facts are surfaced in the
 * output. `since_date` is accepted but ignored (with a note) for McKinney.
 *
 * v0.3 also adds an Arlington branch (city="arlington", ArcGIS "Issued
 * Permits" layer on Arlington's on-prem server, live-verified 2026-07-15).
 * Arlington's FOLDERNAME field IS a single string address (like McKinney,
 * unlike Fort Worth's componentized fields) -- `address` contains-matches it.
 * There is no single "permit number" field; a display ID is synthesized from
 * FOLDERTYPE+FOLDERYEAR+FOLDERSEQUENCE. A separate, smaller "Permit
 * Applications" layer exists upstream but is deliberately NOT wired (issued
 * permits only, matching the Fort Worth/McKinney contract) -- see
 * lib/sources.js `arlingtonPermitApplications` and resources/datasets-index.md.
 */
const ENTRY_LABEL = "dfw_permits";
const SOURCE_LABEL = "City of Fort Worth Open Data -- Development Permits";
const SOURCE_URL = ARCGIS.fortWorthPermits.url;

const MCK_ENTRY_LABEL = "dfw_permits (mckinney)";
const MCK_SOURCE_LABEL = "City of McKinney -- Energov Permits";
const MCK_SOURCE_URL = ARCGIS.mckinneyEnergov.url;

const ARL_ENTRY_LABEL = "dfw_permits (arlington)";
const ARL_SOURCE_LABEL = "City of Arlington -- Issued Permits";
const ARL_SOURCE_URL = ARCGIS.arlingtonPermits.url;

export const dfwPermits = {
  name: "dfw_permits",
  tier: "core",
  description: withAttributionTag(
    "Fort Worth (default), McKinney (city=\"mckinney\", v0.3), or Arlington " +
      "(city=\"arlington\", v0.3) -- Dallas building-permit feeds are " +
      "stale/dead and not wired (see project plan); do not claim Dallas " +
      "coverage here. Search building/development permits. Fort Worth " +
      "addresses are componentized upstream -- match on `street` (+ " +
      "optional `addr_no`), not a one-line address. McKinney's source has " +
      "NO DATE FIELD, so `address` is REQUIRED for city=\"mckinney\" and " +
      "results are ordered by case number (not strictly chronological), not " +
      "File_Date. Arlington's `address` IS a single string (like McKinney), " +
      "issued permits only. Returns permit number/ID, type, status, dates " +
      "or filed-YYYY-MM (McKinney), address, and owner/job value (Fort " +
      "Worth only). Sources: City of Fort Worth / McKinney / Arlington Open " +
      "Data (ArcGIS)."
  ),
  inputSchema: {
    city: z.enum(["fortworth", "mckinney", "arlington", "dallas"]).optional()
      .describe('Jurisdiction: "fortworth" (default), "mckinney" (v0.3), or "arlington" (v0.3) are wired; "dallas" is refused -- Dallas permit feeds are stale/dead, not covered (see project plan).'),
    street: z.string().min(2).optional()
      .describe('Fort Worth only. Street name only, contains-match against Street_Name (address is componentized -- do not include house number or suffix). Example: "Main", not "500 Main St".'),
    addr_no: z.number().int().positive().optional()
      .describe("Fort Worth only. House/building number (Addr_No), exact match. Combine with `street` to scope to one address."),
    address: z.string().min(3).optional()
      .describe('McKinney (REQUIRED for city="mckinney" -- the McKinney source has no date field, so browsing/newest-first listing is not possible there) or Arlington (optional). Contains-match against the permit address (McKinney: ENT_MA1; Arlington: FOLDERNAME). Ignored for Fort Worth (use `street`/`addr_no` there).'),
    permit_type: z.string().min(2).optional()
      .describe('Free text, contains-match against Permit_Type / Permit_SubType / Permit_Category (Fort Worth), Work Class (McKinney), or FOLDERTYPE/WORKDESC (Arlington), e.g. "electrical", "residential building", "remodel".'),
    status: z.string().min(2).optional()
      .describe('Free text, contains-match against Current_Status (Fort Worth), ENT_STATUS (McKinney), or STATUSDESC (Arlington), e.g. "issued", "finaled", "in review".'),
    since_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("Fort Worth/Arlington. ISO date (YYYY-MM-DD); only permits filed/issued on/after it (File_Date / ISSUEDATE). Ignored (with a note) for city=\"mckinney\", which has no date field. Omit for the most recent permits regardless of date."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ city, street, addr_no, address, permit_type, status, since_date, limit, cursor }) {
    if (city === "mckinney") {
      return handleMcKinney({ address, permit_type, status, since_date, limit, cursor });
    }
    if (city === "arlington") {
      return handleArlington({ address, permit_type, status, since_date, limit, cursor });
    }
    if (city && city !== "fortworth") {
      return refusalResult(
        'Not covered: Fort Worth, McKinney, or Arlington only (Dallas not yet wired -- see project plan). Omit `city`, or set city="fortworth", city="mckinney", or city="arlington".',
        {
          query: { city, street, addr_no, permit_type, status, since_date },
          recovery:
            'Retry with city:"fortworth" (default), city:"mckinney", or city:"arlington". ' +
            "Dallas permit feeds are stale/dead upstream -- say Dallas is not covered rather than guessing.",
        }
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

// --- McKinney branch (v0.3) -------------------------------------------

async function handleMcKinney({ address, permit_type, status, since_date, limit, cursor }) {
  if (!address) {
    return refusalResult(
      'dfw_permits (city="mckinney") requires `address` -- the McKinney ' +
        "Energov source publishes no date field, so newest-first " +
        "browsing/listing isn't possible there. Search by address instead " +
        '(contains-match, e.g. address:"216 W Virginia St").',
      {
        query: { city: "mckinney", address, permit_type, status, since_date },
        reason: "missing_required_filter",
        recovery:
          'Retry with address:"..." (contains-match). Date-based browsing is impossible for McKinney -- ' +
          "the upstream layer has no date field.",
      }
    );
  }

  const entry = requireVerified(ARCGIS.mckinneyEnergov, MCK_ENTRY_LABEL);

  const notes = [];
  if (since_date) {
    notes.push(
      `\`since_date\` is ignored for city="mckinney" -- that source has no ` +
        `date field to filter by. Results are ordered by case number ` +
        `(ENT_NUMBER DESC), which only roughly groups recent cases.`
    );
  }

  const whereParts = ["UPPER(MODULE) = 'PERMIT'"];
  whereParts.push(likeClause("ENT_MA1", address));
  if (permit_type) whereParts.push(likeClause("ENT_WORK_CLASS", permit_type));
  if (status) whereParts.push(likeClause("ENT_STATUS", status));
  const where = whereParts.join(" AND ");

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const rows = await queryLayer(entry.url, {
    where,
    outFields: [
      "MODULE", "ENT_NUMBER", "ENT_WORK_CLASS", "ENT_DESCRIPTION",
      "ENT_STATUS", "ENT_PARCEL", "ENT_MA1", "ENT_MA2",
    ],
    resultRecordCount: pageSize + 1,
    resultOffset: offset,
    // No date field exists on this layer -- ENT_NUMBER DESC only roughly
    // groups recent cases (the year-month is embedded in the case number
    // prefix, e.g. "COM2026-07-00990"), it is NOT a true chronological sort.
    orderByFields: "ENT_NUMBER DESC",
    returnGeometry: false,
  });

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeMcKinney);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { city: "mckinney", address, permit_type, status, since_date },
    count: page.length,
    results: page,
    nextCursor,
    offset,
    notes,
  };

  return {
    content: [
      { type: "text", text: formatMcKinneyResults(payload, nextCursor) },
      { type: "text", text: JSON.stringify(payload, null, 2) },
    ],
  };
}

// "COM2026-07-00990" -> "2026-07"; else null. This is the only "date" this
// source offers -- surfaced as "filed (from case number)", never implied to
// be an authoritative filing date.
function extractYearMonth(entNumber) {
  if (!entNumber) return null;
  const m = String(entNumber).match(/((?:19|20)\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function buildMcKinneyAddress(a) {
  const parts = [a.ENT_MA1, a.ENT_MA2]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

function normalizeMcKinney(a) {
  return {
    permit_no: orNull(a.ENT_NUMBER),
    permit_type: orNull(a.ENT_WORK_CLASS),
    description: orNull(a.ENT_DESCRIPTION),
    status: orNull(a.ENT_STATUS),
    filed_from_case_number: extractYearMonth(a.ENT_NUMBER),
    address: buildMcKinneyAddress(a),
    parcel: orNull(a.ENT_PARCEL),
    source: MCK_SOURCE_LABEL,
    source_url: MCK_SOURCE_URL,
  };
}

function resultBlockMcKinney(r) {
  const title = [r.permit_no ?? "(no permit #)", "--", r.permit_type ?? "Permit"].join(" ");
  const lines = [`## ${title}`];
  const meta = [];
  if (r.status) meta.push(`**Status:** ${r.status}`);
  if (r.filed_from_case_number) meta.push(`**Filed (from case number):** ${r.filed_from_case_number}`);
  if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
  if (r.address) lines.push(`- **Address:** ${r.address}`);
  if (r.parcel) lines.push(`- **Parcel:** ${r.parcel}`);
  // Upstream free text is third-party authored -- keep it visibly quoted.
  if (r.description) lines.push(`> ${truncated(r.description)}`);
  lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
  return lines.join("\n");
}

function formatMcKinneyResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.address) parts.push(`address="${q.address}"`);
  if (q.permit_type) parts.push(`type=${q.permit_type}`);
  if (q.status) parts.push(`status=${q.status}`);

  const lines = [
    `# McKinney Permits: ${parts.join(", ") || "recent"} -- ${p.count} permit${p.count === 1 ? "" : "s"}`,
    "> Coverage: City of McKinney only (permits, MODULE='PERMIT' rows only -- plans excluded).",
    "> Caveat: results are NOT date-sorted -- the McKinney source publishes no date field. " +
      "Ordered by case number (roughly newest-first, not strictly chronological).",
    "",
  ];
  for (const n of p.notes ?? []) lines.push(`> ${n}`, "");

  if (p.count === 0) {
    lines.push("No permits matched. Try a broader `address`.", "");
  }

  for (const r of p.results) {
    lines.push(resultBlockMcKinney(r), "");
  }

  if (nextCursor) {
    lines.push(`*More results available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }

  lines.push(
    "---",
    `Source: ${MCK_SOURCE_LABEL} (${MCK_SOURCE_URL})`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

// --- Arlington branch (v0.3) -------------------------------------------

async function handleArlington({ address, permit_type, status, since_date, limit, cursor }) {
  const entry = requireVerified(ARCGIS.arlingtonPermits, ARL_ENTRY_LABEL);

  const whereParts = [];
  if (address) whereParts.push(likeClause("FOLDERNAME", address));
  if (permit_type) {
    whereParts.push(
      `(${likeClause("FOLDERTYPE", permit_type)} OR ${likeClause("WORKDESC", permit_type)} OR ${likeClause("SUBDESC", permit_type)})`
    );
  }
  if (status) whereParts.push(likeClause("STATUSDESC", status));
  if (since_date) whereParts.push(`ISSUEDATE >= TIMESTAMP '${since_date} 00:00:00'`);
  const where = whereParts.length ? whereParts.join(" AND ") : "1=1";

  const pageSize = limit ?? 25;
  const offset = decodeCursor(cursor)?.offset ?? 0;

  const rows = await queryLayer(entry.url, {
    where,
    outFields: [
      "FOLDERTYPE", "FOLDERYEAR", "FOLDERSEQUENCE", "STATUSDESC", "ISSUEDATE",
      "FINALDATE", "SUBDESC", "WORKDESC", "FOLDERNAME",
      "ConstructionValuationDeclared", "MainUse",
    ],
    resultRecordCount: pageSize + 1,
    resultOffset: offset,
    orderByFields: "ISSUEDATE DESC",
    returnGeometry: false,
  });

  const hasMore = rows.length > pageSize;
  const page = (hasMore ? rows.slice(0, pageSize) : rows).map(normalizeArlington);
  const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

  const payload = {
    query: { city: "arlington", address, permit_type, status, since_date },
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

// No single "permit number" field is published -- synthesize a readable
// display ID from FOLDERTYPE+FOLDERYEAR+FOLDERSEQUENCE (e.g. "CP22-062954").
// Never presented as an official permit number, just a stable display ID.
function buildArlingtonPermitId(a) {
  const parts = [a.FOLDERTYPE, a.FOLDERYEAR].filter((v) => v !== null && v !== undefined && v !== "");
  const prefix = parts.join("");
  return a.FOLDERSEQUENCE ? `${prefix}-${a.FOLDERSEQUENCE}` : orNull(prefix || null);
}

function normalizeArlington(a) {
  return {
    permit_id: buildArlingtonPermitId(a),
    permit_type: orNull(a.FOLDERTYPE),
    work_description: orNull(a.WORKDESC),
    sub_description: orNull(a.SUBDESC),
    status: orNull(a.STATUSDESC),
    issue_date: epochToDate(a.ISSUEDATE),
    final_date: epochToDate(a.FINALDATE),
    address: orNull(a.FOLDERNAME),
    valuation: parseJobValue(a.ConstructionValuationDeclared),
    main_use: orNull(a.MainUse),
    source: ARL_SOURCE_LABEL,
    source_url: ARL_SOURCE_URL,
  };
}

function resultBlockArlington(r) {
  const title = [r.permit_id ?? "(no permit id)", "--", r.permit_type ?? "Permit"].join(" ");
  const lines = [`## ${title}`];
  const meta = [];
  if (r.status) meta.push(`**Status:** ${r.status}`);
  if (r.issue_date) meta.push(`**Issued:** ${r.issue_date}`);
  if (r.final_date) meta.push(`**Final:** ${r.final_date}`);
  if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
  if (r.address) lines.push(`- **Address:** ${r.address}`);
  if (r.valuation !== null) lines.push(`- **Valuation:** $${r.valuation.toLocaleString("en-US")}`);
  if (r.main_use) lines.push(`- **Main use:** ${r.main_use}`);
  if (r.sub_description) lines.push(`- **Sub type:** ${r.sub_description}`);
  if (r.work_description) lines.push(`> ${truncated(r.work_description)}`);
  lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
  return lines.join("\n");
}

function formatArlingtonResults(p, nextCursor) {
  const q = p.query;
  const parts = [];
  if (q.address) parts.push(`address="${q.address}"`);
  if (q.permit_type) parts.push(`type=${q.permit_type}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.since_date) parts.push(`since ${q.since_date}`);

  const lines = [
    `# Arlington Permits: ${parts.join(", ") || "recent"} -- ${p.count} permit${p.count === 1 ? "" : "s"}`,
    "> Coverage: City of Arlington only (issued permits; a separate Permit Applications layer exists but is not wired).",
    "",
  ];

  if (p.count === 0) {
    lines.push("No permits matched. Try a broader `address`, or omit `since_date`.", "");
  }

  for (const r of p.results) {
    lines.push(resultBlockArlington(r), "");
  }

  if (nextCursor) {
    lines.push(`*More results available. Re-call with \`cursor: "${nextCursor}"\`.*`, "");
  }

  lines.push(
    "---",
    `Source: ${ARL_SOURCE_LABEL} (${ARL_SOURCE_URL})`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

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

import { z } from "zod";
import { queryLayer, likeClause } from "../../lib/arcgis.js";
import { sodaQuery, encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ARCGIS, SODA, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { refusalResult } from "../../lib/register.js";

/**
 * dfw_traffic -- new for local-dfw-mcp (v0.2 priority-2), not ported. Merges
 * four genuinely different upstreams under one tool, each with real coverage
 * gaps that must be stated plainly rather than silently guessed over:
 *   - incidents: City of Fort Worth "Current Traffic Accidents" ArcGIS layer
 *     (real-time-ish, small rolling table -- FORT WORTH ONLY, no other city
 *     publishes a live incident feed keyless).
 *   - closures: City of Dallas right-of-way (ROW) permits, Socrata -- street /
 *     lane work. Two datasets (line-segment "block range" permits and point
 *     "specific address" permits) fetched in parallel and merged. v0.3 adds
 *     City of Arlington ROW Permits Issued (ArcGIS, on-prem server) as a
 *     THIRD closures sub-source -- Dallas + Arlington are merged by default
 *     (no city filter); Arlington's `ProjectStart`/`ProjectEnd` are the
 *     SCHEDULED work window and are often forward-dated to a future date --
 *     not a staleness signal -- so that sub-source sorts/pages by the true
 *     freshness field `UpdatedInGIS` instead. Every closure result now
 *     carries a `city` field ("dallas" | "arlington") so a metro-wide merge
 *     never blurs which city a record belongs to.
 *   - counts: TxDOT 5-Year Statewide AADT (annual traffic counts) by station,
 *     scoped to the 4 core counties. No road-name field on this layer -- do
 *     not imply road-name search works here.
 *   - projects: TxDOT highway construction/improvement projects, scoped to the
 *     4 core counties. HWY_NBR is searchable free text.
 *
 * Pagination design: the closures / counts / projects upstreams are each
 * thousands to tens-of-thousands of rows -- too large to fetch in full like
 * dfw_events' small RSS feeds. Instead every sub-source is queried sorted by
 * its own recency field with a `topN = offset + limit + 1` cap starting at
 * offset 0 (a standard top-K merge: the true top-N of a union is always a
 * subset of the top-N of each input list, so fetching top-N from every
 * sub-source and merging is sufficient to render *this* page correctly). The
 * "+1" is the classic hasMore probe. `total_matched` is therefore an honest
 * lower bound (exact once hasMore is false), not a full COUNT(*) -- shown that
 * way to avoid an extra full-table-scan request per call.
 */

const COUNTY_LABEL = { dallas: "Dallas", tarrant: "Tarrant", collin: "Collin", denton: "Denton" };
const ALL_COUNTY_LABELS = Object.values(COUNTY_LABEL);

const ROW_LINES = SODA.dallas.rowPermitsLines;
const ROW_POINTS = SODA.dallas.rowPermitsPoints;
const ROW_BASE = SODA.dallas.base;

const INCIDENT_SOURCE = "City of Fort Worth -- Current Traffic Accidents";
const CLOSURE_SOURCE = "City of Dallas -- Right-of-Way Permits";
const ARL_CLOSURE_SOURCE = "City of Arlington -- ROW Permits Issued";
const COUNT_SOURCE = "TxDOT -- 5-Year Statewide AADT Traffic Counts";
const PROJECT_SOURCE = "TxDOT -- Projects Info";

export const dfwTraffic = {
  name: "dfw_traffic",
  tier: "core",
  description: withAttributionTag(
    "DFW-area traffic: real-time incidents (Fort Worth only), street/lane closures " +
      "from right-of-way permits (Dallas + Arlington, merged and labeled by city), " +
      "TxDOT annual traffic counts (AADT) by county, and TxDOT highway construction " +
      "projects by county. Counties: Dallas, Tarrant, Collin, Denton. Default kind=all " +
      "merges live incidents+closures only (counts/projects need an explicit kind)."
  ),
  inputSchema: {
    kind: z.enum(["incidents", "closures", "counts", "projects", "all"]).default("all")
      .describe('"incidents" (Fort Worth), "closures" (Dallas + Arlington ROW permits, merged), "counts" (TxDOT AADT), "projects" (TxDOT construction), or "all" (default: merges incidents+closures only).'),
    city: z.enum(["fortworth", "dallas", "arlington"]).optional()
      .describe('Scopes incidents (fortworth only) / closures (dallas or arlington). Omit with kind="closures" to merge both cities (each result is labeled with its `city`). With kind="all", narrows the merge to just that city\'s subtype.'),
    county: z.enum(["dallas", "tarrant", "collin", "denton"]).optional()
      .describe("Scopes counts/projects to one of the 4 core counties; omit to query all four."),
    search: z.string().optional()
      .describe('Free text: matches street/cross-street/address for incidents, address/location for closures (Arlington also matches its ScopeOfWork/Segment free-text fields, which do not reliably carry an address), or highway number (e.g. "US 67") for projects. Not supported for counts (no road-name field on that layer) -- ignored with a note.'),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ kind, city, county, search, limit, cursor }) {
    if (kind === "incidents" && city && city !== "fortworth") {
      return refusalResult(
        "Not covered: real-time traffic incidents are Fort Worth only. Omit `city` or set city=\"fortworth\".",
        {
          query: { kind, city, county, search },
          recovery:
            'Retry without city, or with city:"fortworth". For street/lane closures in Dallas or Arlington use kind:"closures".',
        }
      );
    }
    if (kind === "closures" && city && city !== "dallas" && city !== "arlington") {
      return refusalResult(
        "Not covered: street/lane closures (right-of-way permits) are Dallas + Arlington only. Omit `city`, or set city=\"dallas\" or city=\"arlington\".",
        {
          query: { kind, city, county, search },
          recovery: 'Retry without city (merges both), or with city:"dallas" or city:"arlington".',
        }
      );
    }

    const notes = [];
    if (kind === "counts" && search) {
      notes.push('The TxDOT AADT layer has no road-name field -- "search" was ignored. Use `county` to scope instead.');
    }

    const pageSize = limit ?? 25;
    const offset = decodeCursor(cursor)?.offset ?? 0;
    const topN = offset + pageSize + 1;

    const subsources = pickSubsources(kind, city);
    const settled = await Promise.allSettled(
      subsources.map((sub) => FETCHERS[sub]({ county, search, topN }))
    );

    let pool = [];
    settled.forEach((s, i) => {
      const sub = subsources[i];
      if (s.status === "fulfilled") {
        pool.push(...s.value);
      } else {
        notes.push(`${SUBSOURCE_LABEL[sub]} unavailable (${String(s.reason?.message ?? s.reason).slice(0, 120)}); some ${kind === "all" ? "results" : kind} may be missing.`);
      }
    });

    // Sources that natively return sorted-by-recency pages (counts, projects,
    // and a single incidents/closures sub-source) are already in order; a
    // multi-sub-source merge (closures' 2 datasets, or "all") needs a final
    // re-sort by the shared sortKey.
    pool.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0));

    const hasMore = pool.length > offset + pageSize;
    const page = pool.slice(offset, offset + pageSize).map(stripSortKey);
    const nextCursor = hasMore ? encodeCursor(offset + pageSize) : null;

    // Arlington's ROW layer publishes no per-record issued/created date (see
    // lib/sources.js `arlingtonRowPermits`) -- surface that in `notes`
    // whenever an Arlington closure actually made it into this page, same
    // mechanism as the AADT no-road-name note above.
    if (page.some((r) => r.type === "closure" && r.city === "arlington")) {
      notes.push(
        "Arlington closures are ordered by an approximation derived from the " +
          "permit ID's embedded year+sequence, not a true date -- that source " +
          "publishes no per-record issued/created date."
      );
    }

    const payload = {
      query: { kind, city, county, search },
      count: page.length,
      total_matched: pool.length,
      results: page,
      nextCursor,
      offset,
      notes,
    };

    return {
      content: [
        { type: "text", text: formatResults(payload) },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  },
};

// --- subsource selection ---------------------------------------------------

const SUBSOURCE_LABEL = {
  incidents: INCIDENT_SOURCE,
  closuresLines: `${CLOSURE_SOURCE} (line permits)`,
  closuresPoints: `${CLOSURE_SOURCE} (point permits)`,
  closuresArlington: ARL_CLOSURE_SOURCE,
  counts: COUNT_SOURCE,
  projects: PROJECT_SOURCE,
};

function pickSubsources(kind, city) {
  if (kind === "incidents") return ["incidents"];
  if (kind === "closures") {
    if (city === "dallas") return ["closuresLines", "closuresPoints"];
    if (city === "arlington") return ["closuresArlington"];
    return ["closuresLines", "closuresPoints", "closuresArlington"]; // merge both cities
  }
  if (kind === "counts") return ["counts"];
  if (kind === "projects") return ["projects"];
  // kind === "all"
  if (city === "fortworth") return ["incidents"];
  if (city === "dallas") return ["closuresLines", "closuresPoints"];
  if (city === "arlington") return ["closuresArlington"];
  return ["incidents", "closuresLines", "closuresPoints", "closuresArlington"];
}

function stripSortKey(item) {
  const { sortKey, ...rest } = item;
  return rest;
}

// --- county / search where-clause helpers ----------------------------------

function countyWhere(field, county) {
  if (county) return `${field} = '${COUNTY_LABEL[county]}'`;
  return `${field} IN (${ALL_COUNTY_LABELS.map((c) => `'${c}'`).join(",")})`;
}

function incidentWhere(search) {
  if (!search) return "1=1";
  return `(${likeClause("Street", search)} OR ${likeClause("Cross_Street", search)} OR ${likeClause("Address", search)})`;
}

// --- per-source fetchers (each returns a normalized, sortKey-tagged array) --

const FETCHERS = {
  async incidents({ search, topN }) {
    const entry = requireVerified(ARCGIS.fortWorthAccidents, "dfw_traffic (incidents)");
    const rows = await queryLayer(entry.url, {
      where: incidentWhere(search),
      outFields: [
        "Event_Number", "Type_", "Description", "Severity", "Address", "Street",
        "Cross_Street", "CreationTime", "UpdateTime", "City", "State", "Zip",
        "Location_Description", "SubType_",
      ],
      resultRecordCount: topN,
      resultOffset: 0,
      orderByFields: "UpdateTime DESC",
      returnGeometry: false,
    });
    return rows.map((a) => normalizeIncident(a, entry.url));
  },

  async closuresLines({ search, topN }) {
    const ds = requireVerified(ROW_LINES, "dfw_traffic (closures/lines)");
    const rows = await sodaQuery(ds.id, {
      base: ROW_BASE,
      where: search ? sodaLocationLike(search) : undefined,
      order: "createddate DESC",
      limit: topN,
      offset: 0,
    });
    return rows.map((r) => normalizeClosure(r, "line", ds.id));
  },

  async closuresPoints({ search, topN }) {
    const ds = requireVerified(ROW_POINTS, "dfw_traffic (closures/points)");
    const rows = await sodaQuery(ds.id, {
      base: ROW_BASE,
      where: search ? sodaLocationLike(search) : undefined,
      order: "createddate DESC",
      limit: topN,
      offset: 0,
    });
    return rows.map((r) => normalizeClosure(r, "point", ds.id));
  },

  async closuresArlington({ search, topN }) {
    const entry = requireVerified(ARCGIS.arlingtonRowPermits, "dfw_traffic (closures/arlington)");
    const whereParts = [];
    if (search) {
      // Segment is the closest analog to Dallas's locationnames block range;
      // ScopeOfWork sometimes but not reliably carries an address (confirmed
      // live -- some rows are a bare address, others multi-sentence work
      // descriptions). Permit is also matched for exact/partial permit-ID lookups.
      whereParts.push(
        `(${likeClause("Segment", search)} OR ${likeClause("ScopeOfWork", search)} OR ${likeClause("Permit", search)})`
      );
    }
    const where = whereParts.length ? whereParts.join(" AND ") : "1=1";
    const rows = await queryLayer(entry.url, {
      where,
      outFields: [
        "Permit", "Status", "Sub", "ScopeOfWork", "ProjectStart", "ProjectEnd",
        "ServiceProvider", "ROWContractor", "Segment", "UpdatedInGIS",
      ],
      resultRecordCount: topN,
      resultOffset: 0,
      // DEVIATION FROM THE ORIGINAL PLAN, confirmed live: neither candidate
      // "recency" field actually works.
      //   - UpdatedInGIS turns out to be a whole-TABLE batch-sync timestamp:
      //     live-verified 2026-07-15, all 23,971 rows fall within a
      //     ~20-SECOND window (min 1784095212077ms, max 1784095231693ms) --
      //     it cannot differentiate individual records at all.
      //   - ProjectStart/ProjectEnd are the SCHEDULED work window and are
      //     often forward-dated months into the future (confirmed live, up
      //     to 2026-09) -- sorting by it (or merging it numerically against
      //     Dallas's genuinely-current createddate) would rank far-future
      //     scheduled work above today's real Dallas permits, an apples-to-
      //     oranges comparison.
      // This layer has NO created/issued-date field at all. Falls back, like
      // dfw_permits' McKinney branch (no date field there either), to the
      // Permit ID's embedded "YYYY-NNNNNN-ROW" sequence, which DOES increase
      // monotonically with filing order (confirmed live). Order here by
      // Permit DESC (roughly newest-filed first); the cross-source merge key
      // (permitFilingSortKey below) derives a comparable epoch-scale proxy
      // from the same pattern so it interleaves sanely with Dallas's real
      // dates instead of using ProjectStart or UpdatedInGIS for that purpose.
      orderByFields: "Permit DESC",
      returnGeometry: false,
    });
    return rows.map((a) => normalizeArlingtonClosure(a, entry.url));
  },

  async counts({ county, topN }) {
    const entry = requireVerified(ARCGIS.txdotAadt, "dfw_traffic (counts)");
    const rows = await queryLayer(entry.url, {
      where: countyWhere("CNTY_NM", county),
      outFields: [
        "DIST_NM", "CNTY_NM", "TRFC_STATN_ID", "LATEST_AADT_YR", "AADT_RPT_QTY",
        "AADT_RPT_HIST_01_QTY", "AADT_RPT_HIST_02_QTY", "AADT_RPT_HIST_03_QTY",
        "AADT_RPT_HIST_04_QTY",
      ],
      resultRecordCount: topN,
      resultOffset: 0,
      orderByFields: "LATEST_AADT_YR DESC",
      returnGeometry: false,
    });
    return rows.map((a) => normalizeCount(a, entry.url));
  },

  async projects({ county, search, topN }) {
    const entry = requireVerified(ARCGIS.txdotProjects, "dfw_traffic (projects)");
    const whereParts = [countyWhere("COUNTY_NAME", county)];
    if (search) whereParts.push(likeClause("HWY_NBR", search));
    const rows = await queryLayer(entry.url, {
      where: whereParts.join(" AND "),
      outFields: [
        "PROJ_ID", "HWY_NBR", "LIMITS_FROM", "LIMITS_TO", "COUNTY_NAME",
        "DISTRICT_NAME", "PROJ_STAT", "PROJ_STG", "PT_PHASE", "TYPE_OF_WORK",
        "CNST_EST_CMPLT_DT", "EST_CONSTRUCTION_COST", "LAST_PROJ_UPDATE_DT",
      ],
      resultRecordCount: topN,
      resultOffset: 0,
      orderByFields: "LAST_PROJ_UPDATE_DT DESC",
      returnGeometry: false,
    });
    return rows.map((a) => normalizeProject(a, entry.url));
  },
};

function sodaLocationLike(search) {
  const safe = String(search).toUpperCase().replace(/'/g, "''");
  return `upper(locationnames) like '%${safe}%'`;
}

// --- normalization -----------------------------------------------------

function epochToIso(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function orNull(v) {
  return v === undefined || v === "" ? null : v;
}

function normalizeIncident(a, sourceUrl) {
  return {
    type: "incident",
    event_number: orNull(a.Event_Number),
    category: orNull(a.Type_),
    description: orNull(a.Description),
    severity: orNull(a.Severity),
    address: orNull(a.Address),
    street: orNull(a.Street),
    cross_street: orNull(a.Cross_Street),
    created: epochToIso(a.CreationTime),
    updated: epochToIso(a.UpdateTime),
    source: INCIDENT_SOURCE,
    source_url: sourceUrl,
    sortKey: Number(a.UpdateTime) || 0,
  };
}

function normalizeClosure(r, geometryType, datasetId) {
  return {
    type: "closure",
    city: "dallas",
    permit_number: orNull(r.externalfilenum),
    permit_type: orNull(r.permittype),
    category: orNull(r.commercialorresidential),
    status: orNull(r.statusdescription),
    created: orNull(r.createddate),
    requested_start: orNull(r.rowrequestedstartdate),
    estimated_completion: orNull(r.rowestimatedcompletiondate),
    reason: orNull(r.rowreasonforjob),
    improvement_repair: orNull(r.rowimprovementrepair),
    work_description: orNull(r.workdescription),
    applicant_name: orNull(r.applicantnamestored),
    applicant_company: orNull(r.applicantcompanynamestored),
    contractors: orNull(r.allcontractorsname),
    location: orNull(r.locationnames),
    specific_location: orNull(r.specificlocation),
    council_districts: orNull(r.council_districts),
    case_id: orNull(r.caseid),
    geometry_type: geometryType,
    updated: null,
    source: CLOSURE_SOURCE,
    source_url: `${ROW_BASE}/d/${datasetId}`,
    sortKey: Date.parse(r.createddate) || 0,
  };
}

// Permit format observed live: "YYYY-NNNNNN-ROW" (e.g. "2026-027119-ROW").
// No created/issued-date field exists on this layer at all (confirmed via a
// full field-list dump) -- the year+sequence embedded in the Permit ID is
// the only per-record signal that increases monotonically with filing
// order, mirroring how dfw_permits' McKinney branch already leans on its
// case-number pattern when no date field exists. Used ONLY as an internal
// merge sortKey (stripped before the response goes out, like every other
// sortKey in this file) -- never displayed as a real date. Using the
// forward-dated ProjectStart or the batch-synced UpdatedInGIS here would
// have skewed the cross-source merge against Dallas's genuinely-dated rows
// (see the closuresArlington fetcher comment above for the full reasoning).
//
// The raw sequence number alone is too small relative to a real epoch (a
// bare `+seq` offset from Jan 1 is only ever a few minutes into the year --
// it would sort every Arlington row before any real mid-year Dallas date).
// Spread the sequence proportionally across the year instead: live-verified
// 2026-07-15, the 2026 sequence had reached ~58,500 by day ~196 of the year
// (~300/day) -- ASSUMED_ANNUAL_SEQ_CEILING extrapolates that rate to a full
// year as a rough calibration constant, not a claimed exact count.
const ASSUMED_ANNUAL_SEQ_CEILING = 110000;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

function permitFilingSortKey(permit) {
  const m = /^(\d{4})-(\d+)/.exec(String(permit ?? ""));
  if (!m) return 0;
  const year = Number(m[1]);
  const seq = Number(m[2]);
  const yearStart = Date.UTC(year, 0, 1);
  if (!Number.isFinite(seq)) return yearStart;
  const fraction = Math.min(seq / ASSUMED_ANNUAL_SEQ_CEILING, 1);
  return yearStart + fraction * MS_PER_YEAR;
}

// City of Arlington ROW Permits Issued. ProjectStart/ProjectEnd are the
// SCHEDULED closure window and are often forward-dated to a future date
// (confirmed live) -- rendered as the window, never mistaken for a recency
// signal. UpdatedInGIS turned out (live-verified 2026-07-15) to be a
// whole-table batch-sync timestamp shared by ~all 23,971 rows within a
// ~20-second window, NOT a per-record last-modified field, so it is surfaced
// as `updated` (informational) but NOT used for sorting -- see
// permitFilingSortKey() above for what the sortKey actually uses.
function normalizeArlingtonClosure(a, sourceUrl) {
  return {
    type: "closure",
    city: "arlington",
    permit_number: orNull(a.Permit),
    permit_type: orNull(a.Sub),
    category: null,
    status: orNull(a.Status),
    created: null,
    requested_start: epochToIso(a.ProjectStart),
    estimated_completion: epochToIso(a.ProjectEnd),
    reason: null,
    improvement_repair: null,
    work_description: orNull(a.ScopeOfWork),
    applicant_name: null,
    applicant_company: orNull(a.ServiceProvider),
    contractors: orNull(a.ROWContractor),
    location: orNull(a.Segment),
    specific_location: null,
    council_districts: null,
    case_id: null,
    geometry_type: "line",
    updated: epochToIso(a.UpdatedInGIS),
    source: ARL_CLOSURE_SOURCE,
    source_url: sourceUrl,
    sortKey: permitFilingSortKey(a.Permit),
  };
}

function pickAadt(a) {
  const candidates = [
    a.AADT_RPT_QTY, a.AADT_RPT_HIST_01_QTY, a.AADT_RPT_HIST_02_QTY,
    a.AADT_RPT_HIST_03_QTY, a.AADT_RPT_HIST_04_QTY,
  ];
  for (const c of candidates) {
    if (c !== null && c !== undefined) return c;
  }
  return null;
}

function normalizeCount(a, sourceUrl) {
  return {
    type: "count",
    station_id: orNull(a.TRFC_STATN_ID),
    district: orNull(a.DIST_NM),
    county: orNull(a.CNTY_NM),
    latest_year: orNull(a.LATEST_AADT_YR),
    aadt: pickAadt(a),
    source: COUNT_SOURCE,
    source_url: sourceUrl,
    sortKey: Number(a.LATEST_AADT_YR) || 0,
  };
}

function normalizeProject(a, sourceUrl) {
  return {
    type: "project",
    proj_id: orNull(a.PROJ_ID),
    hwy: orNull(a.HWY_NBR),
    limits_from: orNull(a.LIMITS_FROM),
    limits_to: orNull(a.LIMITS_TO),
    county: orNull(a.COUNTY_NAME),
    district: orNull(a.DISTRICT_NAME),
    status: orNull(a.PROJ_STAT),
    stage: orNull(a.PROJ_STG),
    phase: orNull(a.PT_PHASE),
    type_of_work: orNull(a.TYPE_OF_WORK),
    est_completion: epochToIso(a.CNST_EST_CMPLT_DT),
    est_cost: orNull(a.EST_CONSTRUCTION_COST),
    last_updated: epochToIso(a.LAST_PROJ_UPDATE_DT),
    source: PROJECT_SOURCE,
    source_url: sourceUrl,
    sortKey: Number(a.LAST_PROJ_UPDATE_DT) || 0,
  };
}

// --- rendering -----------------------------------------------------------

const COUNT_UNAVAILABLE = "_count unavailable_";

function coverageLine(kind, city) {
  if (kind === "incidents") return "Fort Worth only (real-time incidents)";
  if (kind === "closures") {
    if (city === "dallas") return "Dallas only (right-of-way permits)";
    if (city === "arlington") return "Arlington only (right-of-way permits)";
    return "Dallas + Arlington (right-of-way permits, merged and labeled by city)";
  }
  if (kind === "counts") return "Dallas, Tarrant, Collin, Denton counties (TxDOT AADT)";
  if (kind === "projects") return "Dallas, Tarrant, Collin, Denton counties (TxDOT projects)";
  // all
  if (city === "fortworth") return "Fort Worth incidents only";
  if (city === "dallas") return "Dallas closures only";
  if (city === "arlington") return "Arlington closures only";
  return "Fort Worth incidents + Dallas/Arlington closures merged (counts/projects need an explicit kind)";
}

function resultBlock(r) {
  if (r.type === "incident") {
    const lines = [`## Incident ${r.event_number ?? ""} -- ${r.category ?? "Accident"}`.trim()];
    const meta = [];
    if (r.severity) meta.push(`**Severity:** ${r.severity}`);
    if (r.street) meta.push(`**Street:** ${r.street}`);
    if (r.cross_street) meta.push(`**Cross street:** ${r.cross_street}`);
    if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
    if (r.description) lines.push(`- **Description:** ${r.description}`);
    if (r.updated) lines.push(`- **Updated:** ${r.updated}`);
    lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
    return lines.join("\n");
  }
  if (r.type === "closure") {
    const cityLabel = r.city === "arlington" ? "Arlington" : "Dallas";
    const lines = [`## Closure ${r.permit_number ?? ""} -- ${r.status ?? "?"} [${cityLabel}]`.trim()];
    const meta = [];
    if (r.reason) meta.push(`**Reason:** ${r.reason}`);
    if (r.work_description) meta.push(`**Work:** ${r.work_description}`);
    if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
    if (r.location) lines.push(`- **Location:** ${r.location} (${r.geometry_type})`);
    if (r.created) lines.push(`- **Created:** ${r.created}`);
    if (r.city === "arlington") {
      // ProjectStart/ProjectEnd are the SCHEDULED closure window and are
      // often forward-dated to a future date -- present as a window, not a
      // recency claim. `r.updated` (UpdatedInGIS) is deliberately NOT
      // rendered here: live verification found it's a whole-TABLE batch-sync
      // timestamp shared by ~all 23,971 rows within a ~20-second window, not
      // a per-record freshness signal -- printing it per-record would read
      // as "this record was last touched at HH:MM:SS," which is false. It's
      // still present in the JSON payload (labeled `updated`) for callers
      // that want the raw value, and the closures-notes caveat (added when
      // an Arlington row is in the page) explains the approximated ordering.
      if (r.requested_start || r.estimated_completion) {
        lines.push(`- **Scheduled closure window:** ${r.requested_start ?? "?"} to ${r.estimated_completion ?? "?"}`);
      }
    } else if (r.estimated_completion) {
      lines.push(`- **Est. completion:** ${r.estimated_completion}`);
    }
    lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
    return lines.join("\n");
  }
  if (r.type === "count") {
    const lines = [`## Count station ${r.station_id ?? "?"} -- ${r.county ?? "?"} County`];
    lines.push(`- **Latest year:** ${r.latest_year ?? "?"}`);
    lines.push(`- **AADT:** ${r.aadt === null ? COUNT_UNAVAILABLE : r.aadt.toLocaleString("en-US")}`);
    lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
    return lines.join("\n");
  }
  // project
  const lines = [`## ${r.hwy ?? "Project"} -- ${r.proj_id ?? "?"}`];
  const limits = [r.limits_from, r.limits_to].filter(Boolean).join(" to ");
  if (limits) lines.push(`- **Limits:** ${limits}`);
  const meta = [];
  if (r.status) meta.push(`**Status:** ${r.status}`);
  if (r.stage) meta.push(`**Stage:** ${r.stage}`);
  if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
  if (r.phase) lines.push(`- **Phase:** ${r.phase}`);
  if (r.type_of_work) lines.push(`- **Type of work:** ${r.type_of_work}`);
  if (r.county) lines.push(`- **County:** ${r.county}`);
  if (r.est_completion) lines.push(`- **Est. completion:** ${r.est_completion}`);
  if (r.last_updated) lines.push(`- **Last updated:** ${r.last_updated}`);
  lines.push(`- **Source:** ${r.source} -- ${r.source_url}`);
  return lines.join("\n");
}

function formatResults(p) {
  const q = p.query;
  const lines = [
    `# DFW Traffic: ${q.kind}${q.county ? ` (${COUNTY_LABEL[q.county]} County)` : ""} -- ${p.count} of ${p.total_matched}${p.nextCursor ? "+" : ""} matches`,
    `> Coverage: ${coverageLine(q.kind, q.city)}`,
    "",
  ];
  for (const n of p.notes) lines.push(`> ${n}`);
  if (p.notes.length) lines.push("");

  if (p.count === 0) {
    lines.push("No results matched. Try a different kind, county, city, or search term.", "");
  }

  for (const r of p.results) {
    lines.push(resultBlock(r), "");
  }

  if (p.nextCursor) {
    lines.push(`*More results available. Re-call with \`cursor: "${p.nextCursor}"\`.*`, "");
  }

  const sources = new Set(p.results.map((r) => r.source));
  lines.push(
    "---",
    `Sources: ${sources.size ? [...sources].join(", ") : "(none queried)"}`,
    ATTRIBUTION_TAG
  );
  return lines.join("\n");
}

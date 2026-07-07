import { z } from "zod";
import { sodaQuery, sodaTextEq } from "../../lib/soda.js";
import { SODA, requireVerified } from "../../lib/sources.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";

/**
 * Adapted from local-austin-mcp's tea-schools.js (Apache-2.0). Same statewide
 * TEA Accountability Ratings dataset (data.texas.gov nui6-x374); the AskTED
 * campus-directory join was dropped for v0.1 (the current hzek-udky publication
 * is district-level, so it added no campus address/phone) and the example
 * filters point at DFW ISDs/counties.
 *
 * NOTE: TEA does not publish address-to-assigned-school mapping (attendance
 * zones live with individual ISDs). Search by campus name, district, or county.
 */
const BASE = SODA.texas.base;
const RATINGS_DATASET = SODA.texas.teaRatings.id;
const RATINGS_URL = `${BASE}/d/${RATINGS_DATASET}`;

export const dfwTeaSchools = {
  name: "dfw_tea_schools",
  tier: "core",
  description: withAttributionTag(
    "Texas public schools + TEA A-F accountability ratings (latest published: " +
      "2022-2023). Search by campus name, district, or county (e.g. DALLAS, " +
      "TARRANT, COLLIN, DENTON). Returns overall rating, sub-scores (Student " +
      "Achievement, School Progress, Closing the Gaps), enrollment, and " +
      "demographics. Does NOT map an address to its assigned schools — " +
      "attendance zones are managed by individual ISDs. Source: Texas Education Agency."
  ),
  inputSchema: {
    campus: z.string().min(2).optional()
      .describe('Campus name, contains-match. Example: "Booker T Washington", "Frisco HS".'),
    district: z.string().min(2).optional()
      .describe('District name, contains-match. Example: "Dallas ISD", "Frisco ISD", "Plano".'),
    county: z.string().min(2).optional()
      .describe('County name. Example: "DALLAS", "TARRANT", "COLLIN", "DENTON".'),
    rating: z.enum(["A", "B", "C", "D", "F"]).optional()
      .describe("Filter by overall A-F rating."),
    school_type: z.enum(["Elementary School", "Middle School", "High School", "District", "Other"]).optional()
      .describe("Filter by campus level."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
  },
  async handler(args) {
    requireVerified(SODA.texas.teaRatings, "dfw_tea_schools");
    const { campus, district, county, rating, school_type, limit } = args;
    if (!campus && !district && !county) {
      return errorContent("dfw_tea_schools requires at least one of: campus, district, or county.");
    }

    const where = ["campus_number IS NOT NULL"];
    if (campus) where.push(`upper(campus) like '%${esc(campus)}%'`);
    if (district) where.push(`upper(district) like '%${esc(district)}%'`);
    if (county) where.push(`upper(county) like '%${esc(county)}%'`);
    if (rating) where.push(`overall_rating = '${rating}'`);
    if (school_type) where.push(sodaTextEq("school_type", school_type));

    const rows = await sodaQuery(RATINGS_DATASET, {
      base: BASE,
      where: where.join(" AND "),
      order: "overall_score DESC NULLS LAST",
      limit: limit ?? 25,
    });

    const results = rows.map(normalize);
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No TEA campuses matched the filters. ${ATTRIBUTION_TAG}` }],
        structuredContent: { query: args, count: 0, results: [] },
      };
    }

    return {
      content: [
        { type: "text", text: formatResults(args, results) },
        { type: "text", text: JSON.stringify({ query: args, count: results.length, results }, null, 2) },
      ],
    };
  },
};

function esc(s) {
  return String(s).toUpperCase().replace(/'/g, "''");
}

function normalize(r) {
  return {
    campus: r.campus ?? null,
    campus_number: r.campus_number ?? null,
    school_type: r.school_type ?? null,
    grades_served: r.grades_served ?? null,
    district: r.district ?? null,
    district_number: r.district_number ?? null,
    county: r.county ?? null,
    region: r.region ?? null,
    enrollment: numOrNull(r.number_of_students),
    economically_disadvantaged_pct: pctOrNull(r.economically_disadvantaged),
    rating: {
      overall: r.overall_rating ?? null,
      overall_score: numOrNull(r.overall_score),
      student_achievement: r.student_achievement_rating ?? null,
      school_progress: r.school_progress_rating ?? null,
      closing_the_gaps: r.closing_the_gaps_rating ?? null,
      year: "2022-2023",
    },
    source: "Texas Education Agency — Statewide Accountability Ratings",
    source_url: RATINGS_URL,
  };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctOrNull(v) {
  const n = numOrNull(v);
  if (n === null) return null;
  return Math.round(n * 1000) / 10;
}

function errorContent(text) {
  return { content: [{ type: "text", text: `${text} ${ATTRIBUTION_TAG}` }], isError: true };
}

function formatResults(args, results) {
  const filterParts = [];
  if (args.campus) filterParts.push(`campus="${args.campus}"`);
  if (args.district) filterParts.push(`district="${args.district}"`);
  if (args.county) filterParts.push(`county="${args.county}"`);
  if (args.rating) filterParts.push(`rating=${args.rating}`);
  if (args.school_type) filterParts.push(`type=${args.school_type}`);

  const lines = [
    `# TEA Schools: ${filterParts.join(", ")} -- ${results.length} campus${results.length === 1 ? "" : "es"}`,
    "",
  ];

  const byRating = {};
  for (const r of results) {
    const g = r.rating?.overall ?? "?";
    byRating[g] = (byRating[g] ?? 0) + 1;
  }
  const dist = ["A", "B", "C", "D", "F", "?"].filter((g) => byRating[g]).map((g) => `${g}: ${byRating[g]}`).join("  |  ");
  if (dist) lines.push(`**2022-2023 rating distribution:** ${dist}`, "");

  for (const r of results.slice(0, 25)) {
    lines.push(`## ${r.campus ?? "(unknown)"} (${r.rating?.overall ?? "?"})`);
    lines.push(`- **District:** ${r.district ?? "?"} (${r.district_number ?? ""})`);
    if (r.school_type) lines.push(`- **Type:** ${r.school_type}${r.grades_served ? ` (grades ${r.grades_served})` : ""}`);
    if (r.county) lines.push(`- **County:** ${r.county}`);
    if (r.enrollment !== null) lines.push(`- **Enrollment:** ${r.enrollment}`);
    if (r.economically_disadvantaged_pct !== null) lines.push(`- **Econ. disadvantaged:** ${r.economically_disadvantaged_pct}%`);
    const x = r.rating;
    lines.push(
      `- **2022-23:** Overall ${x.overall ?? "?"} (${x.overall_score ?? "?"}) | ` +
        `Achievement ${x.student_achievement ?? "?"} | Progress ${x.school_progress ?? "?"} | ` +
        `Closing Gaps ${x.closing_the_gaps ?? "?"}`
    );
    lines.push("");
  }
  if (results.length > 25) lines.push(`...and ${results.length - 25} more in the JSON payload below.`, "");

  lines.push("---", `Source: TEA Statewide Accountability Ratings 2022-2023 (${RATINGS_URL}).`, ATTRIBUTION_TAG);
  return lines.join("\n");
}

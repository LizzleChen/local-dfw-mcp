/**
 * Minimal CKAN datastore client -- new for local-dfw-mcp (no Austin
 * equivalent). Style-matched to lib/soda.js: named retry profile, semaphore
 * bucket, URL building, and errors that read cleanly as an UpstreamError once
 * thrown through retryFetch.
 *
 * Targets OpenGov-managed city CKAN portals (e.g. data.cityofdenton.com).
 * `datastore_search` only supports exact-match `filters`, so flexible
 * contains-matching (address / offense free text) goes through
 * `datastore_search_sql` instead (standard CKAN SQL over the resource).
 *
 * SQL SAFETY: sql strings are built by hand here -- ONLY escaped string
 * literals (via sqlEscape/ilikeClause, single quotes doubled) are ever
 * interpolated into a query. Column names with special characters (e.g.
 * "Date/Time") must be double-quoted by the caller. Never interpolate raw,
 * unescaped user input.
 */

import { retryFetch } from "./retry.js";
import { withLimit } from "./semaphore.js";

const UA = "local-dfw-mcp (https://github.com/LizzleChen/local-dfw-mcp)";

/** Escape a string for safe interpolation inside a single-quoted SQL literal. */
export function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Build a `"Column" ILIKE '%value%'` contains-match clause. `column` is
 * interpolated verbatim -- pass a literal, double-quoted column name, never
 * user input.
 */
export function ilikeClause(column, value) {
  return `${column} ILIKE '%${sqlEscape(value)}%'`;
}

/**
 * Run a `datastore_search_sql` query (arbitrary SELECT over one resource).
 * @param {string} base - CKAN portal base, e.g. "https://data.cityofdenton.com".
 * @param {string} sql - full SQL SELECT statement.
 * @returns {Promise<Array<object>>} the `result.records` array.
 */
export async function datastoreSearchSql(base, sql) {
  const url = new URL("/api/3/action/datastore_search_sql", base);
  url.searchParams.set("sql", sql);

  const res = await withLimit("ckan", () =>
    retryFetch(
      (signal) => fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal }),
      { source: "CKAN Open Data", profile: "soda", url: url.toString() }
    )
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `CKAN datastore_search_sql rejected: ${res.status} ${res.statusText} -- ${body.slice(0, 200)}`
    );
  }

  const data = await res.json();
  if (data?.success !== true) {
    throw new Error(
      `CKAN datastore_search_sql error: ${JSON.stringify(data?.error ?? data).slice(0, 200)}`
    );
  }
  return Array.isArray(data.result?.records) ? data.result.records : [];
}

/**
 * Run a `datastore_search` query (exact-match filters only, no free-text
 * contains-matching -- kept for cheap health-check pings / callers that only
 * need exact filters).
 */
export async function datastoreSearch(base, resourceId, opts = {}) {
  const { filters, limit = 1, offset = 0, sort } = opts;
  const url = new URL("/api/3/action/datastore_search", base);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (filters) url.searchParams.set("filters", JSON.stringify(filters));
  if (sort) url.searchParams.set("sort", sort);

  const res = await withLimit("ckan", () =>
    retryFetch(
      (signal) => fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal }),
      { source: "CKAN Open Data", profile: "soda", url: url.toString() }
    )
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `CKAN datastore_search rejected: ${res.status} ${res.statusText} -- ${body.slice(0, 200)}`
    );
  }

  const data = await res.json();
  if (data?.success !== true) {
    throw new Error(
      `CKAN datastore_search error: ${JSON.stringify(data?.error ?? data).slice(0, 200)}`
    );
  }
  return Array.isArray(data.result?.records) ? data.result.records : [];
}

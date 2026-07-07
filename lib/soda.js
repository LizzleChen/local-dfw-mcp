/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: DEFAULT_BASE -> https://www.dallasopendata.com;
 * app-token env var AUSTIN_SODA_APP_TOKEN -> DFW_SODA_APP_TOKEN; source label
 * generalized; added sodaTextEqCI (case-insensitive equality). Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Generic Socrata Open Data API (SODA) client. Works against any Socrata portal
 * via the `base` param. Optional app token (DFW_SODA_APP_TOKEN) raises the
 * anonymous rate-limit ceiling.
 */

import { retryFetch } from "./retry.js";
import { withLimit } from "./semaphore.js";

const DEFAULT_BASE = "https://www.dallasopendata.com";

/**
 * Run a SODA $where / $q / $order query against a Socrata dataset.
 */
export async function sodaQuery(resourceId, params = {}) {
  const {
    where,
    q,
    order,
    limit = 25,
    offset = 0,
    select,
    base = DEFAULT_BASE,
  } = params;

  if (!resourceId || !/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(resourceId)) {
    throw new Error(`SODA resourceId must look like "abcd-1234", got "${resourceId}"`);
  }

  const url = new URL(`/resource/${resourceId}.json`, base);
  if (where) url.searchParams.set("$where", where);
  if (q) url.searchParams.set("$q", q);
  if (order) url.searchParams.set("$order", order);
  if (limit !== undefined) url.searchParams.set("$limit", String(Math.min(Math.max(limit, 1), 5000)));
  if (offset !== undefined) url.searchParams.set("$offset", String(Math.max(offset, 0)));
  if (Array.isArray(select) && select.length > 0) {
    url.searchParams.set("$select", select.join(","));
  }

  const headers = { Accept: "application/json" };
  const token = process.env.DFW_SODA_APP_TOKEN;
  if (token) headers["X-App-Token"] = token;

  const res = await withLimit("soda", () =>
    retryFetch(
      (signal) => fetch(url, { headers, signal }),
      {
        source: "Open Data (Socrata)",
        profile: "soda",
        url: url.toString(),
      }
    )
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SODA query rejected: ${res.status} ${res.statusText} -- ${body.slice(0, 200)}`
    );
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("SODA response was not an array");
  }
  return data;
}

/**
 * Build a SoQL LIKE clause for an address-style contains-match.
 */
export function sodaAddressLike(field, address) {
  return sodaTextLike(field, address, { errorLabel: "sodaAddressLike" });
}

/**
 * Generic case-insensitive contains-match for free-text filters.
 */
export function sodaTextLike(field, value, { errorLabel = "sodaTextLike" } = {}) {
  if (!field || value === undefined || value === null || value === "") {
    throw new Error(`${errorLabel} requires field and value`);
  }
  const safe = String(value).toUpperCase().replace(/'/g, "''").trim();
  return `upper(${field}) like '%${safe}%'`;
}

/**
 * Cursor is a base64url-encoded JSON object `{ offset: <number> }`.
 */
export function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = Number(parsed?.offset);
    if (!Number.isInteger(offset) || offset < 0) return null;
    return { offset };
  } catch (_) {
    return null;
  }
}

/**
 * Safe equality match -- escapes single quotes. Case-SENSITIVE: use only for
 * values with known exact casing (e.g. zod enum literals).
 */
export function sodaTextEq(field, value) {
  if (!field || value === undefined || value === null || value === "") {
    throw new Error("sodaTextEq requires field and value");
  }
  const safe = String(value).replace(/'/g, "''").trim();
  return `${field} = '${safe}'`;
}

/**
 * Case-INSENSITIVE exact equality match -- upper(field) = 'VALUE'. Use for
 * user-supplied category values ("open" must match the stored "Open") where a
 * contains-match would over-match (e.g. LIKE '%OPEN%' also hits "Reopened").
 */
export function sodaTextEqCI(field, value) {
  if (!field || value === undefined || value === null || value === "") {
    throw new Error("sodaTextEqCI requires field and value");
  }
  const safe = String(value).toUpperCase().replace(/'/g, "''").trim();
  return `upper(${field}) = '${safe}'`;
}

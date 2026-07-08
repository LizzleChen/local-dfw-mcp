/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: added identifyAtPoint() -- a MapServer /identify
 * client for keyless point lookups on services whose /query op is disabled
 * (TxGIO StratMap parcels). The generic /query client is otherwise unchanged
 * and source-agnostic.
 * See LICENSE and NOTICE in the repository root.
 *
 * Generic ArcGIS REST FeatureServer / MapServer client. Public, no auth.
 * Wraps /query with sane defaults and one transient-failure retry.
 */

import { currentSignal } from "./request-context.js";
import { withLimit } from "./semaphore.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Query an ArcGIS FeatureServer / MapServer layer.
 */
export async function queryLayer(layerUrl, opts = {}) {
  const {
    where = "1=1",
    outFields = "*",
    resultRecordCount = 10,
    resultOffset,
    orderByFields,
    returnGeometry = false,
  } = opts;

  const params = new URLSearchParams({
    where,
    outFields: Array.isArray(outFields) ? outFields.join(",") : outFields,
    returnGeometry: String(returnGeometry),
    f: "json",
    resultRecordCount: String(resultRecordCount),
  });
  if (resultOffset !== undefined) {
    params.set("resultOffset", String(resultOffset));
  }
  if (orderByFields) {
    params.set("orderByFields", orderByFields);
  }

  const url = `${layerUrl.replace(/\/$/, "")}/query?${params.toString()}`;

  return withLimit("arcgis", () => retry(async () => {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: currentSignal(),
    });
    if (!res.ok) {
      throw new Error(`ArcGIS query failed: ${res.status} ${res.statusText} -- ${url}`);
    }
    const data = await res.json();
    if (data?.error) {
      throw new Error(
        `ArcGIS query error: ${data.error.code} ${data.error.message ?? ""}`
      );
    }
    const features = Array.isArray(data?.features) ? data.features : [];
    return features.map((f) => f.attributes ?? {});
  }));
}

/**
 * Point-in-polygon spatial query. Returns attributes of every polygon feature
 * that contains the point.
 */
export async function queryPointInPolygon(layerUrl, lng, lat, opts = {}) {
  const { outFields = "*" } = opts;
  if (typeof lng !== "number" || typeof lat !== "number") {
    throw new Error("queryPointInPolygon requires numeric lng + lat");
  }

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "1=1",
    outFields: Array.isArray(outFields) ? outFields.join(",") : outFields,
    returnGeometry: "false",
    f: "json",
  });

  const url = `${layerUrl.replace(/\/$/, "")}/query?${params.toString()}`;

  return withLimit("arcgis", () => retry(async () => {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: currentSignal(),
    });
    if (!res.ok) {
      throw new Error(
        `ArcGIS point query failed: ${res.status} ${res.statusText} -- ${url}`
      );
    }
    const data = await res.json();
    if (data?.error) {
      throw new Error(
        `ArcGIS point query error: ${data.error.code} ${data.error.message ?? ""}`
      );
    }
    const features = Array.isArray(data?.features) ? data.features : [];
    return features.map((f) => f.attributes ?? {});
  }));
}

/**
 * MapServer /identify at a point. For services whose /query capability is
 * disabled (e.g. TxGIO StratMap parcels, which 400 on /query but serve
 * /identify keyless). Builds the required mapExtent bbox around the point
 * internally, so callers just pass a WGS84 lng/lat.
 *
 * Returns an array of `results[].attributes` objects (one per matched feature;
 * multiple are possible for stacked/condo parcels). NOTE: many such services
 * return every attribute value as a STRING under UPPERCASE keys -- normalize in
 * the caller.
 *
 * @param {string} mapServerUrl - the MapServer root (…/MapServer), NOT a layer.
 * @param {number} lng
 * @param {number} lat
 * @param {object} [opts]
 * @param {string} [opts.layers="all:0"] - ArcGIS `layers` param (e.g. "all:0").
 * @param {number} [opts.tolerance=2] - pixel tolerance.
 * @param {number} [opts.extentPad=0.001] - half-width (deg) of the mapExtent bbox.
 * @param {string} [opts.imageDisplay="400,400,96"] - required width,height,dpi.
 */
export async function identifyAtPoint(mapServerUrl, lng, lat, opts = {}) {
  const {
    layers = "all:0",
    tolerance = 2,
    extentPad = 0.001,
    imageDisplay = "400,400,96",
  } = opts;
  if (typeof lng !== "number" || typeof lat !== "number") {
    throw new Error("identifyAtPoint requires numeric lng + lat");
  }

  const xmin = lng - extentPad;
  const ymin = lat - extentPad;
  const xmax = lng + extentPad;
  const ymax = lat + extentPad;

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers,
    tolerance: String(tolerance),
    mapExtent: `${xmin},${ymin},${xmax},${ymax}`,
    imageDisplay,
    returnGeometry: "false",
    f: "json",
  });

  const url = `${mapServerUrl.replace(/\/$/, "")}/identify?${params.toString()}`;

  return withLimit("arcgis", () => retry(async () => {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: currentSignal(),
    });
    if (!res.ok) {
      throw new Error(
        `ArcGIS identify failed: ${res.status} ${res.statusText} -- ${url}`
      );
    }
    const data = await res.json();
    if (data?.error) {
      throw new Error(
        `ArcGIS identify error: ${data.error.code} ${data.error.message ?? ""}`
      );
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r) => r.attributes ?? {});
  }));
}

/**
 * Build an ArcGIS-safe SQL LIKE clause. Escapes single quotes by doubling.
 */
export function likeClause(column, value, opts = {}) {
  const { uppercase = true } = opts;
  const safe = String(value).replace(/'/g, "''").toUpperCase();
  return uppercase
    ? `UPPER(${column}) LIKE '%${safe}%'`
    : `${column} LIKE '%${safe}%'`;
}

/**
 * One retry on 5xx / network glitches with a 600ms delay.
 */
async function retry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/50\d|timeout|GATEWAY|ENOTFOUND|ECONNRESET/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 600));
      return await fn();
    }
    throw err;
  }
}

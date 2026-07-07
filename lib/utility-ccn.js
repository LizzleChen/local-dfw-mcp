/**
 * Adapted from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: swapped the Travis-County-rehosted CCN MapServer
 * for the statewide Texas PUC CCN FeatureServers (water layer 210 / sewer
 * layer 230, from lib/sources.js). lookupUtilityProviders / normalizeProvider
 * shape unchanged.
 * See LICENSE and NOTICE in the repository root.
 *
 * Water & sewer service-provider lookup by point. Texas utilities hold a CCN
 * (Certificate of Convenience and Necessity) from the PUC obligating them to
 * serve every address inside a certificated boundary. A point-in-polygon query
 * returns the obligated provider -- the "who turns on my water" question.
 */

import { queryPointInPolygon } from "./arcgis.js";
import { ARCGIS } from "./sources.js";

export const WATER_LAYER = ARCGIS.waterCCN.url;
export const SEWER_LAYER = ARCGIS.sewerCCN.url;
export const SOURCE_URL = ARCGIS.waterCCN.source_url;

/**
 * Look up the water and sewer providers obligated to serve a point.
 *
 * @param {number} lng  Longitude (WGS-84 / EPSG:4326)
 * @param {number} lat  Latitude (WGS-84 / EPSG:4326)
 * @returns {Promise<{ water: Array<Provider>, sewer: Array<Provider> }>}
 * @typedef {{ utility: string, ccn_no: string|null, county: string|null }} Provider
 */
export async function lookupUtilityProviders(lng, lat) {
  const fields = ["UTILITY", "CCN_NO", "COUNTY"];

  const [waterRows, sewerRows] = await Promise.all([
    queryPointInPolygon(WATER_LAYER, lng, lat, { outFields: fields }),
    queryPointInPolygon(SEWER_LAYER, lng, lat, { outFields: fields }),
  ]);

  return {
    water: waterRows.map(normalizeProvider),
    sewer: sewerRows.map(normalizeProvider),
  };
}

function normalizeProvider(attrs) {
  return {
    utility: cleanName(attrs.UTILITY),
    ccn_no: attrs.CCN_NO ?? null,
    county: attrs.COUNTY ?? null,
  };
}

function cleanName(name) {
  if (!name) return "Unknown";
  return String(name).trim().replace(/\s+/g, " ");
}

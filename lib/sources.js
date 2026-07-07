/**
 * Single source of truth for dataset IDs and ArcGIS layer URLs.
 *
 * Every entry marked `verified: false` MUST be confirmed against the live portal
 * before its tool ships; tools guard on requireVerified(). Tools import from here
 * only -- nothing is hardcoded in tool files.
 *
 * "verified: true" entries below were each confirmed with a live query on
 * 2026-07-06 (see resources/datasets-index.md for the evidence). This file is
 * new for local-dfw-mcp (Austin kept these constants inline in each tool).
 */

// ---------------------------------------------------------------------------
// Socrata (SODA) portals
// ---------------------------------------------------------------------------
export const SODA = {
  dallas: {
    base: "https://www.dallasopendata.com",
    // 311 Service Requests Oct 1 2020 to Present. Updated daily.
    // Alternate identical-schema sibling: gc4d-8a49.
    sr311: {
      id: "d7e7-envw",
      addressField: "address",
      typeField: "service_request_type",
      dateField: "created_date",
      statusField: "status",
      verified: true,
    },
    // Police Incidents. Updated daily. Addresses are block-level
    // (privacy-rounded upstream).
    police: {
      id: "qv6i-rri7",
      addressField: "incident_address",
      offenseField: "offincident",
      dateField: "date1",
      statusField: "status",
      verified: true,
    },
    // Building permits: e7gq-4sah is DEAD (max issued_date 2019-12-31 despite
    // fresh catalog metadata). Not shipped. See ARCGIS.dallasPermits below and
    // resources/datasets-index.md.
    permits: {
      id: "e7gq-4sah",
      addressField: "address",
      dateField: "issued_date",
      verified: false,
    },
  },
  // Texas statewide portal (TEA schools).
  texas: {
    base: "https://data.texas.gov",
    // Statewide Accountability Ratings (A-F, latest published year: 2022-2023).
    teaRatings: { id: "nui6-x374", verified: true },
    // AskTED district directory (best-effort join for address/phone/website).
    askted: { id: "hzek-udky", verified: true },
  },
  // Fort Worth portal -- reserved for v0.2.
  fortworth: { base: "https://data.fortworthtexas.gov" },
};

// ---------------------------------------------------------------------------
// ArcGIS FeatureServer / MapServer layers
// ---------------------------------------------------------------------------
export const ARCGIS = {
  // Statewide PUC Certificate of Convenience & Necessity (CCN) service areas.
  // Authoritative water/sewer provider boundaries, published by the Texas PUC
  // (AGOL owner gis.user.puct). Note the non-zero layer indexes.
  waterCCN: {
    url: "https://services6.arcgis.com/N6Lzvtb46cpxThhu/arcgis/rest/services/Water_CCN_Service_Areas/FeatureServer/210",
    fields: ["UTILITY", "CCN_NO", "COUNTY"],
    source_url:
      "https://services6.arcgis.com/N6Lzvtb46cpxThhu/arcgis/rest/services/Water_CCN_Service_Areas/FeatureServer",
    verified: true,
  },
  sewerCCN: {
    url: "https://services6.arcgis.com/N6Lzvtb46cpxThhu/arcgis/rest/services/Sewer_CCN_Service_Areas/FeatureServer/230",
    fields: ["UTILITY", "CCN_NO", "COUNTY"],
    source_url:
      "https://services6.arcgis.com/N6Lzvtb46cpxThhu/arcgis/rest/services/Sewer_CCN_Service_Areas/FeatureServer",
    verified: true,
  },

  // City of Dallas council districts (owner dallascrm_DallasGIS -> CouncilAreas).
  dallasCouncilDistricts: {
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/CouncilAreas/FeatureServer/0",
    districtField: "DISTRICT",
    memberField: "COUNCILPER",
    verified: true,
  },
  // City of Dallas city limits -- authority for the "is this City of Dallas"
  // ground-truth check used by city-scoped tools.
  dallasCityLimits: {
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/CityLimits/FeatureServer/0",
    cityField: "CITY",
    verified: true,
  },
  // Statewide Texas county boundaries (owner TPP_GIS).
  txCounties: {
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0",
    nameField: "CNTY_NM",
    fipsField: "FIPS_ST_CNTY_CD",
    verified: true,
  },
  // Statewide TEA school-district boundaries (owner suhan.li_TEA_Texas,
  // "Current Districts").
  txSchoolDistricts: {
    url: "https://services2.arcgis.com/5MVN2jsqIrNZD4tP/arcgis/rest/services/Districts1920/FeatureServer/0",
    nameField: "NAME",
    verified: true,
  },

  // Dallas building permits -- BOTH candidate AGOL layers cap at late 2024
  // (max ISSUE_DATE 2024-11-12), ~20 months stale. Left verified:false and
  // excluded from the registry so dfw_permits does not ship plausible garbage.
  // See resources/datasets-index.md.
  dallasPermits: {
    url: "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/NewPermit_2008_2024/FeatureServer/0",
    addressField: "ADDRESS",
    dateField: "ISSUE_DATE",
    verified: false,
  },
};

export function requireVerified(entry, label) {
  if (!entry?.verified) {
    throw new Error(`${label} dataset not verified yet -- see lib/sources.js`);
  }
  return entry;
}

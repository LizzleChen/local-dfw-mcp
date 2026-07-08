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
    // Right-of-way (ROW) permits -- street/lane closures. Powers dfw_traffic's
    // "closures" kind. Live-verified 2026-07-08.
    // NOTE: the plan doc's original IDs (yi5a-ym5z for lines, xum9-x6px for
    // points) are DEAD -- empty shell views with zero columns. These are the
    // underlying `modifyingViewUid` datasets that actually carry data.
    rowPermitsLines: { id: "xd3q-ipis", verified: true },
    rowPermitsPoints: { id: "bw6g-a3ur", verified: true },
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

  // TxGIO StratMap Land Parcels -- statewide Texas parcels republished by the
  // Texas Geographic Information Office from county appraisal districts
  // (CAD/CAMA). Powers dfw_appraisal. Live-verified 2026-07-07:
  //   - Public + keyless; 2025 certified roll for all 4 core DFW counties
  //     (Dallas/Tarrant/Collin/Denton), each SOURCE = the county appraisal dist.
  //   - The /query op is DISABLED on the public layer (400 "requested capability
  //     is not supported"); the vintage-named twins (stratmap23/24/25_...) are
  //     token-gated. Only MapServer /identify works keyless -> address-first by
  //     construction (geocode -> identify), no owner-name / free-text search.
  //   - identify returns EVERY attribute value as a STRING under UPPERCASE keys;
  //     blank fields are whitespace-padded strings (" "). Normalize in the tool.
  //   - Some Tarrant parcels publish MKT_VALUE (or LAND/IMP) as 0 (TAD quirk) --
  //     render as "value unavailable", never $0.
  //   - copyrightText: "Texas Geographic Information Office, Various Counties,
  //     Various Vendors".
  txStratmapParcels: {
    // MapServer ROOT -- identify operates here (pass to identifyAtPoint).
    url: "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer",
    layer: 0,
    // The layer URL, used as the human-facing source_url in output footers.
    layerUrl: "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0",
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

  // City of Fort Worth real-time traffic accidents. Small rolling live table
  // (only a handful of active records at any time) -- powers dfw_traffic's
  // "incidents" kind, Fort Worth only. Live-verified 2026-07-08: UpdateTime
  // matched same-day, 4 active records.
  fortWorthAccidents: {
    url: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Current_Traffic_Accidents/FeatureServer/0",
    verified: true,
  },
  // TxDOT 5-Year Statewide AADT (Annual Average Daily Traffic) counts.
  // Live-verified 2026-07-08: 3210 Dallas-county records; county field is
  // CNTY_NM and is TITLE CASE ("Dallas", not "DALLAS").
  txdotAadt: {
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0",
    verified: true,
  },
  // TxDOT highway construction/improvement projects. Live-verified
  // 2026-07-08: non-zero records in all 4 core counties (COUNTY_NAME field,
  // also title case).
  txdotProjects: {
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Projects_Info/FeatureServer/0",
    verified: true,
  },
};

// ---------------------------------------------------------------------------
// Event sources (dfw_events)
// ---------------------------------------------------------------------------
// Tier 1 -- official city calendars on the CivicPlus CMS, exposed as keyless
// RSS at /RSSFeed.aspx?ModID=58&CID=All-calendar.xml. Each feed live-verified
// 2026-07-07 (HTTP 200, populated <item>s with calendarEvent:EventDates /
// EventTimes / Location namespaced tags). Higher churn risk than Socrata /
// ArcGIS (CMS feeds) -- every feed is pinged by dfw_health.
//   - Dallas has NO citywide calendar feed (dallascityhall.com is SharePoint);
//     the Parks & Recreation calendar is the Dallas slice. Say so in output.
//   - Irving redirects to irvingtx.gov and 403s; Plano is a different CMS;
//     Fort Worth + Arlington bot-block plain fetches. All excluded.
export const EVENTS_RSS = {
  dallas: {
    base: "https://www.dallasparks.org",
    label: "City of Dallas Parks & Recreation",
    cityLabel: "Dallas (Parks & Rec calendar only)",
    verified: true,
  },
  garland: {
    base: "https://www.garlandtx.gov",
    label: "City of Garland",
    cityLabel: "Garland",
    verified: true,
  },
  frisco: {
    base: "https://www.friscotexas.gov",
    label: "City of Frisco",
    cityLabel: "Frisco",
    verified: true,
  },
  mesquite: {
    base: "https://www.cityofmesquite.com",
    label: "City of Mesquite",
    cityLabel: "Mesquite",
    verified: true,
  },
};

// Tier 2 -- commercial events (concerts, sports, theater) via the Ticketmaster
// Discovery API. Optional key (DFW_TICKETMASTER_API_KEY, free at
// developer.ticketmaster.com, 5000 calls/day): keyless installs get city
// calendars only plus a one-line hint. DMA 222 = Dallas-Fort Worth.
export const EVENTS_TICKETMASTER = {
  base: "https://app.ticketmaster.com/discovery/v2",
  dmaId: "222",
  envKey: "DFW_TICKETMASTER_API_KEY",
  verified: true,
};

export function requireVerified(entry, label) {
  if (!entry?.verified) {
    throw new Error(`${label} dataset not verified yet -- see lib/sources.js`);
  }
  return entry;
}

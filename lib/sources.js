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

  // City of Fort Worth building/development permits -- powers dfw_permits
  // (Fort Worth-first per the v0.2 plan; Dallas's Socrata feed is dead/stale,
  // see SODA.dallas.permits above, and is deliberately NOT wired here).
  // Live-verified 2026-07-14: 1,600,274 rows, newest File_Date same-day
  // (2026-07-14). Address is COMPONENTIZED (Addr_No, Direction, Street_Name,
  // Street_Suffix, Street_Suffix_Dir) -- Full_Street_Address is usually null.
  // Match on Street_Name (+ optional Addr_No), never a contains-match on one
  // combined field. JobValue/Units/SqFt are typed as strings upstream; parse
  // before use. B1_WORK_DESC is a genuine free-text field for older permits
  // but is literally the placeholder string "B1_WORK_DESC" on most modern
  // rows (upstream data-quality quirk) -- filter that placeholder out.
  fortWorthPermits: {
    url: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0",
    verified: true,
  },
  // City of Fort Worth code-compliance violations -- powers dfw_code_cases
  // (Fort Worth-first; Dallas's code-violations publication stalled
  // 2025-01-31 and is not wired). Live-verified 2026-07-14: 65,718 rows,
  // newest Case_Created_Date 2026-06-16 (~4 weeks old at verification but an
  // actively-maintained feed, unlike Dallas's stalled one). Violation_Address
  // is a single string field here (NOT componentized, unlike the permits
  // layer above) -- a normal contains-match works.
  fortWorthCodeViolations: {
    url: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Code_Violations_Table_view/FeatureServer/0",
    verified: true,
  },
  // City of Fort Worth Police crime data -- powers dfw_crime's city="fortworth"
  // branch. Live-verified 2026-07-14: 1,449,465 rows, newest Reported_Date
  // 2026-07-12 (2 days old). Reported_Date/From_Date are STRING fields
  // (ISO-ish "YYYY-MM-DDTHH:MM:SS"), not esriFieldTypeDate -- compare and sort
  // as strings, do not wrap in TIMESTAMP literals. BLOCK_ADDRESS is a single
  // string field (block-level, like Dallas). The City field is dirty free
  // text (mostly "FORT WORTH" -- 1,445,109 of 1,449,465 rows -- but includes
  // FWPD mutual-aid/typo rows for neighboring jurisdictions); not filtered on.
  fortWorthCrime: {
    url: "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Police_Crime_Data_Table_view/FeatureServer/0",
    verified: true,
  },

  // City of McKinney code-enforcement cases -- powers dfw_code_cases' city=
  // "mckinney" branch. ON-PREM city ArcGIS server (not AGOL) -- same risk
  // profile as Fort Worth's on-prem twin above. Live-verified 2026-07-15:
  // 166,053 rows, max OpenDate 2026-07-14. Address is a SINGLE string field
  // (Address) -- a normal contains-match works, unlike McKinney's permits
  // layer below. Order newest-first by OpenDate DESC.
  mckinneyCodeCases: {
    url: "https://maps.mckinneytexas.org/mckinney/rest/services/MapServices/CodeServices/MapServer/1",
    verified: true,
  },
  // City of McKinney Energov Records -- PERMITS and PLANS share one layer
  // (MODULE = 'PERMIT' | 'PLAN'); powers dfw_permits' city="mckinney" branch,
  // always filtered to MODULE='PERMIT'. Same on-prem risk profile as above.
  // Live-verified 2026-07-15: 328,308 rows, live through the current month
  // (2026-07 ENT_NUMBER case numbers observed, e.g. "COM2026-07-00990") BUT
  // THE LAYER HAS NO DATE FIELD -- dfw_permits therefore REQUIRES `address`
  // for city="mckinney" (no newest-first browsing/listing is possible) and
  // orders by ENT_NUMBER DESC, which only roughly groups recent cases (the
  // year-month is embedded in the case number prefix, not a true date sort).
  // ENT_MA1/ENT_MA2 are address line 1/2; `address` contains-matches ENT_MA1.
  mckinneyEnergov: {
    url: "https://maps.mckinneytexas.org/mckinney/rest/services/MapServices/EnergovRecords/MapServer/0",
    verified: true,
  },

  // City of Arlington Issued Permits -- powers dfw_permits' city="arlington"
  // branch. ON-PREM city ArcGIS server (gis2.arlingtontx.gov, not AGOL) --
  // same on-prem flakiness caveat as Fort Worth's / McKinney's on-prem twins;
  // use the standard "arcgis" retry profile. Live-verified 2026-07-15:
  // 18,952 rows, max ISSUEDATE 2026-07-14. FOLDERNAME is a SINGLE string
  // address field (e.g. "4501 W PLEASANT RIDGE ROAD", confirmed live) -- a
  // normal contains-match works, unlike McKinney's permits layer. There is no
  // single "permit number" field; the tool synthesizes a display ID from
  // FOLDERTYPE + FOLDERYEAR + FOLDERSEQUENCE (e.g. "CP22-062954"). Order
  // newest-first by ISSUEDATE DESC.
  arlingtonPermits: {
    url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1",
    verified: true,
  },
  // City of Arlington Permit Applications -- a SEPARATE, smaller layer (426
  // rows, max InDate 2026-07-14 at verification) covering applications
  // in-process rather than issued permits. Deliberately left OUT of
  // dfw_permits' contract (issued permits only, matching Fort Worth's and
  // McKinney's "issued" scope) -- documented here as available-but-not-wired.
  // No `verified` flag set/used since nothing queries it; revisit if a future
  // "applications in review" feature is wanted.
  arlingtonPermitApplications: {
    url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/9",
  },
  // City of Arlington Code Complaint -- powers dfw_code_cases' city=
  // "arlington" branch. Same on-prem server/risk profile as the permits layer
  // above. Live-verified 2026-07-15: 66,559 rows, max LastUpdateAmanda
  // 2026-07-14. FOLDERNAME is a SINGLE string address field (sometimes
  // trailing-space padded, e.g. "932 N COOPER STREET "). INDATE/FINALDATE are
  // STRING fields ("YYYY-MM-DD", zero-padded so string compare/sort is
  // chronologically correct) -- INDATE maps to `created`, FINALDATE to
  // `closed` (mirrors the McKinney code-cases created/closed fix, NOT
  // `updated`). LastUpdateAmanda is a genuine esriFieldTypeDate last-modified
  // timestamp in the source system -- maps to `updated`. There is no public
  // case-ID field on this layer (only the internal ArcGIS OBJECTID); surfaced
  // labeled as an internal ID, never implied to be an official case number.
  arlingtonCodeComplaints: {
    url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Community/MapServer/6",
    verified: true,
  },
  // City of Arlington ROW Permits Issued -- powers dfw_traffic's kind=
  // "closures" Arlington branch (merged alongside Dallas's two ROW datasets).
  // Same on-prem server/risk profile as the layers above. Live-verified
  // 2026-07-15: 23,971 rows, max UpdatedInGIS 2026-07-15. NEITHER candidate
  // "recency" field from the original plan actually works, both confirmed
  // live:
  //   - `ProjectStart`/`ProjectEnd` are the SCHEDULED work window and are
  //     often FORWARD-DATED to a future date (e.g. a 2026-07 permit with
  //     ProjectStart in 2026-09) -- that is by design (the scheduled closure
  //     window), NOT a staleness signal, and using it as a sort/merge key
  //     would rank far-future scheduled work above today's real Dallas
  //     permits when merged.
  //   - `UpdatedInGIS` LOOKS like the freshness/recency field but is
  //     actually a WHOLE-TABLE batch-sync timestamp: all 23,971 rows fall
  //     inside a ~20-SECOND window (min 1784095212077ms, max
  //     1784095231693ms) -- every row gets touched on each daily sync, so it
  //     cannot rank individual records at all.
  //   - This layer has NO created/issued-date field of any kind.
  // The tool sorts/pages by the `Permit` field ("YYYY-NNNNNN-ROW", e.g.
  // "2026-027119-ROW") instead -- confirmed live to increase monotonically
  // with filing order -- same fallback pattern as dfw_permits' McKinney
  // branch (ENT_NUMBER DESC) when no date field exists. ProjectStart/
  // ProjectEnd are still rendered as the closure window; UpdatedInGIS is
  // still surfaced as informational `updated`; neither drives sort order.
  // There is no dedicated address field -- `Segment` carries a block-range
  // road segment (e.g. "101-199 E INTERSTATE 20 HWY", the closest analog to
  // Dallas's `locationnames`) and `ScopeOfWork` is free text that sometimes
  // but not reliably contains a street address (confirmed live: some rows
  // are a bare address, others are multi-sentence work descriptions) --
  // both are contains-matched by `search`, never used for wrong-city routing.
  arlingtonRowPermits: {
    url: "https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Transportation/MapServer/9",
    verified: true,
  },

  // City of Irving -- residential + commercial permits. Deliberately left
  // verified:false and NOT wired into dfw_permits. Irving's whole open-data
  // pipeline froze 2025-02-28 -- THREE independent Irving datasets share this
  // exact freeze date, which is a strong signal of a stopped publication job
  // rather than three coincidental staleness events:
  //   - Residential/Commercial permits (below): max Issued_Date 2025-02-28,
  //     despite the "...Present" layer name implying it's current.
  //   - Code violations: annual-snapshot services, frozen since 2022 with no
  //     2023+ sibling published.
  //   - Police incidents: static CSV items frozen at the same 2025-02-28
  //     date, with no query API to page through them.
  //   - Events RSS: Akamai bot-blocks plain (non-browser) fetches with a 403
  //     (see EVENTS_RSS comment above -- also excluded).
  // Revisit trigger: Irving resumes publication (re-verify freshness first).
  irvingResidentialPermits: {
    url: "https://services3.arcgis.com/OfsJXUlu8pSkbl7B/arcgis/rest/services/Residential_Permits_Issued_Feb_15_2022_Present/FeatureServer/0",
    verified: false,
  },
  irvingCommercialPermits: {
    url: "https://services3.arcgis.com/OfsJXUlu8pSkbl7B/arcgis/rest/services/Commercial_Permits_Issued_2_15_22_Present/FeatureServer/0",
    verified: false,
  },
};

// ---------------------------------------------------------------------------
// CKAN (OpenGov-managed) portals -- new for local-dfw-mcp
// ---------------------------------------------------------------------------
export const CKAN = {
  denton: {
    base: "https://data.cityofdenton.com",
    // Denton PD crime incidents ("denton-crime-data" package). Powers
    // dfw_crime's city="denton" branch. Live-verified 2026-07-15: 77,979
    // records, 2019-11-06 -> present, max "Date/Time" = "2026-07-14 16:45".
    // Fields are ALL TEXT, including "Date/Time" -- its "YYYY-MM-DD HH:MM"
    // format is zero-padded, so lexicographic string compare/sort ==
    // chronological. Public_Address is block-level/often house-number-free
    // (e.g. "MORSE ST DENTON TX ", trailing space) -- do not require a house
    // number to match. datastore_search_sql (standard CKAN SQL over the
    // resource) is enabled -- used for ILIKE contains-matching.
    crime: {
      resourceId: "34f60f26-b458-48d0-9e40-d4f83fee3563",
      packageUrl: "https://data.cityofdenton.com/dataset/denton-crime-data",
      verified: true,
    },
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
  // Added v0.3: live-verified 2026-07-15 (HTTP 200, 41 items, same CivicPlus
  // labeled description fields -- Event dates / Event Time / Location -- as
  // the other shipped feeds).
  mckinney: {
    base: "https://www.mckinneytexas.org",
    label: "City of McKinney",
    cityLabel: "McKinney",
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

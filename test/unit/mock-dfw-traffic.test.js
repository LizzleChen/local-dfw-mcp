/**
 * Offline handler tests for dfw_traffic using undici's MockAgent: incidents
 * (Fort Worth ArcGIS), closures (Dallas ROW permits, 2 Socrata datasets
 * merged), counts (TxDOT AADT), projects (TxDOT Projects Info), the "all"
 * merge, and the verified:false guard. No network.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwTraffic } from "../../tools/traffic/dfw-traffic.js";
import { ARCGIS } from "../../lib/sources.js";

let mockAgent;
let prevDispatcher;

before(() => {
  process.env.DFW_CACHE_DISABLED = "1";
  prevDispatcher = getGlobalDispatcher();
});

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

after(async () => {
  await mockAgent.close();
  setGlobalDispatcher(prevDispatcher);
  delete process.env.DFW_CACHE_DISABLED;
});

// --- mock helpers ------------------------------------------------------

function mockIncidents(attrsList, status = 200) {
  mockAgent
    .get("https://services5.arcgis.com")
    .intercept({ path: (p) => p.includes("/CFW_Current_Traffic_Accidents/FeatureServer/0/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

function mockRowLines(records, status = 200) {
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({ path: (p) => p.startsWith("/resource/xd3q-ipis.json"), method: "GET" })
    .reply(status, status === 200 ? records : "server error", { headers: { "content-type": "application/json" } })
    .persist();
}

function mockRowPoints(records, status = 200) {
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({ path: (p) => p.startsWith("/resource/bw6g-a3ur.json"), method: "GET" })
    .reply(status, status === 200 ? records : "server error", { headers: { "content-type": "application/json" } })
    .persist();
}

function mockArlingtonRow(attrsList, status = 200) {
  mockAgent
    .get("https://gis2.arlingtontx.gov")
    .intercept({ path: (p) => p.includes("/OD_Transportation/MapServer/9/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

function mockAadt(attrsList) {
  mockAgent
    .get("https://services.arcgis.com")
    .intercept({ path: (p) => p.includes("/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0/query"), method: "GET" })
    .reply(200, { features: attrsList.map((attributes) => ({ attributes })) }, { headers: { "content-type": "application/json" } })
    .persist();
}

function mockProjects(attrsList) {
  mockAgent
    .get("https://services.arcgis.com")
    .intercept({ path: (p) => p.includes("/TxDOT_Projects_Info/FeatureServer/0/query"), method: "GET" })
    .reply(200, { features: attrsList.map((attributes) => ({ attributes })) }, { headers: { "content-type": "application/json" } })
    .persist();
}

// --- fixtures ------------------------------------------------------------

const FW_INCIDENTS = [
  {
    Event_Number: "FW-2026-0456", Type_: "Vehicle Accident", Severity: "Minor",
    Address: "100 Main St", Street: "Main St", Cross_Street: "5th Ave",
    CreationTime: 1783296000000, UpdateTime: 1783299600000,
  },
  {
    Event_Number: "FW-2026-0457", Type_: "Vehicle Accident", Severity: "Major",
    Address: "200 Elm St", Street: "Elm St", Cross_Street: "6th Ave",
    CreationTime: 1783296100000, UpdateTime: 1783299700000,
  },
];

const ROW_LINE_RECORD = {
  objectid: "1001", externalfilenum: "ROW2026-0001", permittype: "Street Cut",
  statusdescription: "Active", createddate: "2026-07-01T00:00:00.000",
  locationnames: "Main St from Elm to Commerce", rowreasonforjob: "Utility repair",
  rowimprovementrepair: "Water line",
};

const ROW_POINT_RECORD = {
  objectid: "2002", externalfilenum: "ROW2026-0002", permittype: "Sidewalk Closure",
  statusdescription: "Active", createddate: "2026-07-02T00:00:00.000",
  locationnames: "123 Elm St", rowreasonforjob: "Sidewalk repair",
  rowimprovementrepair: "Sidewalk",
};

const ARLINGTON_ROW_RECORD = {
  Permit: "2026-026398-ROW", Status: "Issued", Sub: "New Service",
  ScopeOfWork: "137 W I 20", ProjectStart: 1775710800000, ProjectEnd: 1778475600000,
  ServiceProvider: "ONCOR || 2798943", ROWContractor: "Primoris(Carol Jackson) || 2748075",
  Segment: "101-199 E INTERSTATE 20 HWY", UpdatedInGIS: 1784095231693,
};

// --- incidents -------------------------------------------------------------

test("dfw_traffic: kind=incidents normalizes Fort Worth accident records", async () => {
  mockIncidents(FW_INCIDENTS);
  const res = await dfwTraffic.handler({ kind: "incidents", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 2);
  assert.ok(payload.results.every((r) => r.type === "incident"));
  assert.equal(payload.results[0].event_number, "FW-2026-0457"); // sorted by UpdateTime DESC
  assert.equal(payload.results[1].event_number, "FW-2026-0456");
});

test("dfw_traffic: kind=incidents with city=dallas is refused, no network call", async () => {
  // No incidents mock registered: disableNetConnect() would throw if the
  // handler tried to hit the network, proving the refusal short-circuits.
  const res = await dfwTraffic.handler({ kind: "incidents", city: "dallas", limit: 25 });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.structuredContent.message, /Fort Worth only/);
  assert.equal(res.structuredContent.count, 0);
});

// --- closures ----------------------------------------------------------

test("dfw_traffic: kind=closures merges both Dallas ROW permit datasets (+ Arlington, empty here)", async () => {
  mockRowLines([ROW_LINE_RECORD]);
  mockRowPoints([ROW_POINT_RECORD]);
  mockArlingtonRow([]);
  const res = await dfwTraffic.handler({ kind: "closures", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 2);
  const types = payload.results.map((r) => r.geometry_type).sort();
  assert.deepEqual(types, ["line", "point"]);
  assert.ok(payload.results.every((r) => r.type === "closure"));
  assert.ok(payload.results.every((r) => r.city === "dallas"));
  // No Arlington rows made it into this page -- the approximated-ordering
  // caveat must NOT appear (it would be a non-sequitur with no Arlington
  // results to explain).
  assert.ok(!payload.notes.some((n) => /approximat/i.test(n)));
});

test("dfw_traffic: kind=closures degrades gracefully when one Socrata dataset errors", async () => {
  mockRowLines([ROW_LINE_RECORD], 500);
  mockRowPoints([ROW_POINT_RECORD]);
  mockArlingtonRow([]);
  const res = await dfwTraffic.handler({ kind: "closures", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  assert.equal(payload.results[0].geometry_type, "point");
  assert.ok(payload.notes.some((n) => n.includes("line permits") && n.includes("unavailable")));
});

// --- closures: Arlington (v0.3) -----------------------------------------

test("dfw_traffic: kind=closures city=arlington queries only the Arlington ROW layer and normalizes fields", async () => {
  mockArlingtonRow([ARLINGTON_ROW_RECORD]);
  const res = await dfwTraffic.handler({ kind: "closures", city: "arlington", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.type, "closure");
  assert.equal(r.city, "arlington");
  assert.equal(r.permit_number, "2026-026398-ROW");
  assert.equal(r.status, "Issued");
  assert.equal(r.location, "101-199 E INTERSTATE 20 HWY");
  assert.equal(typeof r.requested_start, "string"); // ProjectStart -> requested_start (the closure window)
  assert.equal(typeof r.updated, "string"); // UpdatedInGIS still in the JSON payload (informational, not sort key)
  assert.match(res.content[0].text, /\[Arlington\]/);
  assert.match(res.content[0].text, /Scheduled closure window/);
  // The per-record "Last updated in GIS" line was removed from the markdown
  // render -- UpdatedInGIS is a whole-table batch-sync stamp, not a
  // per-record freshness signal, and printing it per-record was misleading.
  assert.doesNotMatch(res.content[0].text, /Last updated in GIS/);
  // A notes-array caveat must explain the approximated (permit-ID-derived)
  // ordering whenever an Arlington closure is actually in the page.
  assert.ok(payload.notes.some((n) => /approximat/i.test(n) && /Arlington/i.test(n)));
  assert.match(res.content[0].text, /approximat/i);
});

test("dfw_traffic: kind=closures with city=fortworth is refused (not a closures city), no network call", async () => {
  const res = await dfwTraffic.handler({ kind: "closures", city: "fortworth", limit: 25 });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.structuredContent.message, /Dallas \+ Arlington only/);
});

test("dfw_traffic: kind=closures merges Dallas + Arlington and labels each result's city", async () => {
  mockRowLines([ROW_LINE_RECORD]);
  mockRowPoints([ROW_POINT_RECORD]);
  mockArlingtonRow([ARLINGTON_ROW_RECORD]);
  const res = await dfwTraffic.handler({ kind: "closures", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 3);
  const cities = new Set(payload.results.map((r) => r.city));
  assert.ok(cities.has("dallas"));
  assert.ok(cities.has("arlington"));
  // Every closure result must be labeled with a city so a metro-wide merge
  // never blurs which city a record belongs to.
  assert.ok(payload.results.every((r) => r.city === "dallas" || r.city === "arlington"));
  assert.match(res.content[0].text, /Dallas \+ Arlington/);
});

// --- counts --------------------------------------------------------------

test("dfw_traffic: kind=counts prefers a non-null historical AADT over a null current-year value", async () => {
  mockAadt([
    {
      DIST_NM: "Fort Worth", CNTY_NM: "Tarrant", TRFC_STATN_ID: "0501",
      LATEST_AADT_YR: 2023, AADT_RPT_QTY: null, AADT_RPT_HIST_01_QTY: 15000,
      AADT_RPT_HIST_02_QTY: 14500, AADT_RPT_HIST_03_QTY: null, AADT_RPT_HIST_04_QTY: null,
    },
  ]);
  const res = await dfwTraffic.handler({ kind: "counts", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const c = payload.results[0];
  assert.equal(c.type, "count");
  assert.equal(c.latest_year, 2023);
  assert.equal(c.aadt, 15000);
  assert.notEqual(c.aadt, 0);
  assert.notEqual(c.aadt, null);
});

test("dfw_traffic: kind=counts with search ignores it and notes why", async () => {
  mockAadt([
    { DIST_NM: "Fort Worth", CNTY_NM: "Tarrant", TRFC_STATN_ID: "0501", LATEST_AADT_YR: 2023, AADT_RPT_QTY: 9000 },
  ]);
  const res = await dfwTraffic.handler({ kind: "counts", search: "I-35", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.ok(payload.notes.some((n) => /search/i.test(n) && /ignored/i.test(n)));
});

// --- projects --------------------------------------------------------------

test("dfw_traffic: kind=projects normalizes TxDOT project records", async () => {
  mockProjects([
    {
      PROJ_ID: "P123", HWY_NBR: "US 67", LIMITS_FROM: "IH 20", LIMITS_TO: "FM 1382",
      COUNTY_NAME: "Dallas", PROJ_STAT: "Under Construction", PROJ_STG: "Construction",
      PT_PHASE: "Phase 1", TYPE_OF_WORK: "Widening", LAST_PROJ_UPDATE_DT: 1783296000000,
    },
  ]);
  const res = await dfwTraffic.handler({ kind: "projects", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const p = payload.results[0];
  assert.equal(p.type, "project");
  assert.equal(p.proj_id, "P123");
  assert.equal(p.hwy, "US 67");
  assert.equal(p.limits_from, "IH 20");
  assert.equal(p.limits_to, "FM 1382");
  assert.equal(p.county, "Dallas");
  assert.equal(p.status, "Under Construction");
  assert.equal(p.stage, "Construction");
  assert.equal(p.phase, "Phase 1");
  assert.equal(p.type_of_work, "Widening");
  assert.equal(typeof p.last_updated, "string");
});

// --- all -------------------------------------------------------------------

test('dfw_traffic: kind=all merges incidents + closures, and notes counts/projects need an explicit kind', async () => {
  mockIncidents([FW_INCIDENTS[0]]);
  mockRowLines([ROW_LINE_RECORD]);
  mockRowPoints([ROW_POINT_RECORD]);
  mockArlingtonRow([]);
  const res = await dfwTraffic.handler({ kind: "all", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  const types = new Set(payload.results.map((r) => r.type));
  assert.ok(types.has("incident"));
  assert.ok(types.has("closure"));
  assert.match(res.content[0].text, /counts\/projects need an explicit kind/);
});

// --- verified guard ----------------------------------------------------

test("dfw_traffic: flipping fortWorthAccidents to verified:false degrades that subsource with a note", async () => {
  ARCGIS.fortWorthAccidents.verified = false;
  try {
    // No incidents mock registered: if the handler tried to hit the network
    // anyway, disableNetConnect() would throw and fail this test.
    const res = await dfwTraffic.handler({ kind: "incidents", limit: 25 });
    const payload = JSON.parse(res.content[1].text);
    assert.equal(payload.count, 0);
    assert.ok(payload.notes.some((n) => /not verified/.test(n)));
  } finally {
    ARCGIS.fortWorthAccidents.verified = true;
  }
});

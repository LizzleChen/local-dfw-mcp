/**
 * Offline handler test for dfw_crime using undici's MockAgent (no live network).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwCrime } from "../../tools/civic/dfw-crime.js";

process.env.DFW_CACHE_DISABLED = "1";

let mockAgent;
let prevDispatcher;

before(() => {
  prevDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

after(async () => {
  await mockAgent.close();
  setGlobalDispatcher(prevDispatcher);
  delete process.env.DFW_CACHE_DISABLED;
});

const ROW = {
  incidentnum: "097813-2026",
  servnumid: "097813-2026-01",
  offincident: "BURGLARY OF HABITATION",
  nibrs_crime: "BURGLARY/ BREAKING & ENTERING",
  premise: "Single Family Residence - Occupied",
  incident_address: "3400 LADD ST",
  beat: "423",
  division: "SOUTHWEST",
  sector: "420",
  date1: "2026-07-05 00:00:00.0000000",
  reporteddate: "2026-07-05 20:08:00.0000000",
  status: "Suspended",
  zip_code: "75212",
  city: "DALLAS",
};

test("dfw_crime: explicit city override queries SODA and normalizes fields", async () => {
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({ path: (p) => p.startsWith("/resource/qv6i-rri7.json"), method: "GET" })
    .reply(200, [ROW], { headers: { "content-type": "application/json" } });

  const res = await dfwCrime.handler({ offense: "burglary", city: "dallas", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.incident_number, "097813-2026");
  assert.equal(r.offense, "BURGLARY OF HABITATION");
  assert.equal(r.occurred_date, "2026-07-05");
  assert.equal(r.division, "SOUTHWEST");
  assert.equal(payload.nextCursor, null);
  // FCRA note must be visible in the human output.
  assert.match(res.content[0].text, /Not a consumer report/i);
});

test("dfw_crime: Plano address is refused without any network call", async () => {
  const res = await dfwCrime.handler({ address: "123 Legacy Dr, Plano TX 75023", offense: "theft" });
  assert.ok(res.structuredContent.not_covered);
  assert.match(res.content[0].text, /Not covered/);
  assert.match(res.content[0].text, /Plano/);
});

test("dfw_crime: refuses unfiltered query", async () => {
  const res = await dfwCrime.handler({ city: "dallas" });
  assert.ok(res.structuredContent.not_covered || res.structuredContent.count === 0);
  assert.match(res.content[0].text, /requires at least one/);
});

// --- Fort Worth branch (v0.2) --------------------------------------------

const FW_ROW = {
  Case_No: "260052181",
  Case_No_Offense: "260052181-23C",
  Reported_Date: "2026-07-12T13:01:00",
  From_Date: "2026-07-12T11:48:00",
  Nature_Of_Call: "THEFT",
  Offense: "23C",
  Offense_Desc: "GC 085-07 Theft under $100- Shoplifting",
  BLOCK_ADDRESS: "4100 MARTIN ST",
  City: "FORT WORTH",
  Beat: "G18",
  Division: null,
  CouncilDistrict: "11",
  Attempt_Complete: "C",
  LocationTypeDescription: "08 DEPARTMENT/DISCOUNT STORE",
};

function mockFortWorthCrime(attrsList, status = 200) {
  mockAgent
    .get("https://services5.arcgis.com")
    .intercept({ path: (p) => p.includes("/CFW_Open_Data_Police_Crime_Data_Table_view/FeatureServer/0/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

test('dfw_crime: city="fortworth" queries the ArcGIS crime layer and normalizes fields', async () => {
  mockFortWorthCrime([FW_ROW]);
  const res = await dfwCrime.handler({ offense: "theft", city: "fortworth", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.incident_number, "260052181");
  assert.equal(r.offense, "THEFT");
  assert.equal(r.status, "Complete"); // "C" -> "Complete"
  assert.equal(r.address, "4100 MARTIN ST");
  assert.equal(r.occurred_date, "2026-07-12");
  assert.match(res.content[0].text, /Fort Worth Police Crime Data/);
  assert.match(res.content[0].text, /Not a consumer report/i);
});

test('dfw_crime: city="fortworth" refuses an unfiltered query, no network call', async () => {
  const res = await dfwCrime.handler({ city: "fortworth" });
  assert.ok(res.structuredContent.not_covered);
  assert.match(res.content[0].text, /requires at least one/);
});

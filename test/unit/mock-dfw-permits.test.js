/**
 * Offline handler test for dfw_permits using undici's MockAgent (no live network).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwPermits } from "../../tools/civic/dfw-permits.js";
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

const PERMIT_ATTRS = {
  Permit_No: "PB26-10179",
  Permit_Type: "Residential Building Permit",
  Permit_SubType: "New Construction",
  Permit_Category: "NA",
  B1_SPECIAL_TEXT: null,
  B1_WORK_DESC: "B1_WORK_DESC",
  Addr_No: 500,
  Direction: null,
  Street_Name: "MAIN",
  Street_Suffix: "ST",
  Street_Suffix_Dir: null,
  Full_Street_Address: null,
  Zip_Code: 76102,
  Owner_Full_Name: "ASTUTE REALTY LLC",
  File_Date: 1783987200000,
  Current_Status: "Issued",
  Status_Date: 1783987200000,
  Location_1: "(32.7555, -97.3308)",
  JobValue: "220000.0",
  Use_Type: "Single Family Residence",
  Specific_Use: null,
  Units: "1",
  SqFt: "2400",
};

function mockPermitsQuery(attrsList, status = 200) {
  mockAgent
    .get("https://services5.arcgis.com")
    .intercept({ path: (p) => p.includes("/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

test("dfw_permits: normalizes Fort Worth permit records, builds componentized address, cleans placeholder work_desc", async () => {
  mockPermitsQuery([PERMIT_ATTRS]);
  const res = await dfwPermits.handler({ street: "Main", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.permit_no, "PB26-10179");
  assert.equal(r.address, "500 MAIN ST");
  assert.equal(r.permit_category, null); // "NA" -> null
  assert.equal(r.work_description, null); // placeholder filtered out
  assert.equal(r.job_value, 220000);
  assert.equal(r.lat, 32.7555);
  assert.equal(r.lng, -97.3308);
  assert.match(res.content[0].text, /Fort Worth only/);
});

test("dfw_permits: real work description passes through, rendered as quoted block", async () => {
  mockPermitsQuery([{ ...PERMIT_ATTRS, B1_WORK_DESC: "Demolish detached garage" }]);
  const res = await dfwPermits.handler({ street: "Main", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.results[0].work_description, "Demolish detached garage");
  assert.match(res.content[0].text, /> Demolish detached garage/);
});

test("dfw_permits: city=dallas is refused, no network call", async () => {
  const res = await dfwPermits.handler({ city: "dallas", street: "Main" });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.structuredContent.message, /Fort Worth or McKinney only/);
  assert.equal(res.structuredContent.count, 0);
});

test("dfw_permits: flipping fortWorthPermits to verified:false throws a clear error", async () => {
  ARCGIS.fortWorthPermits.verified = false;
  try {
    await assert.rejects(() => dfwPermits.handler({ street: "Main" }), /not verified/);
  } finally {
    ARCGIS.fortWorthPermits.verified = true;
  }
});

// --- McKinney branch (v0.3) -------------------------------------------

const MCKINNEY_PERMIT_ATTRS = {
  MODULE: "PERMIT",
  ENT_NUMBER: "SIGN2023-08-00454",
  ENT_WORK_CLASS: "Wall Sign",
  ENT_DESCRIPTION: "WALL SIGN - LOYO BURGER (Sign 1)",
  ENT_STATUS: "Complete",
  ENT_PARCEL: "R-10486-00A-0010-1",
  ENT_MA1: "216 W VIRGINIA ST 102",
  ENT_MA2: "MCKINNEY, TX 75069",
};

function mockMcKinneyPermits(attrsList, status = 200) {
  mockAgent
    .get("https://maps.mckinneytexas.org")
    .intercept({ path: (p) => p.includes("/EnergovRecords/MapServer/0/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

test('dfw_permits: city="mckinney" requires address, no network call', async () => {
  const res = await dfwPermits.handler({ city: "mckinney" });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.structuredContent.message, /requires `address`/);
  assert.match(res.structuredContent.message, /no date field/);
});

test('dfw_permits: city="mckinney" queries the McKinney Energov layer, filters to MODULE=PERMIT, parses filed YYYY-MM', async () => {
  mockMcKinneyPermits([MCKINNEY_PERMIT_ATTRS]);
  const res = await dfwPermits.handler({ city: "mckinney", address: "216 W Virginia St", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.permit_no, "SIGN2023-08-00454");
  assert.equal(r.permit_type, "Wall Sign");
  assert.equal(r.filed_from_case_number, "2023-08");
  assert.equal(r.address, "216 W VIRGINIA ST 102, MCKINNEY, TX 75069");
  assert.match(res.content[0].text, /McKinney Permits/);
  assert.match(res.content[0].text, /NOT date-sorted/);
});

test('dfw_permits: city="mckinney" where clause always filters MODULE=PERMIT (PLAN rows excluded at the query layer)', async () => {
  let capturedWhere = null;
  mockAgent
    .get("https://maps.mckinneytexas.org")
    .intercept({
      path: (p) => {
        if (!p.includes("/EnergovRecords/MapServer/0/query")) return false;
        capturedWhere = new URL(`https://maps.mckinneytexas.org${p}`).searchParams.get("where") ?? "";
        return true;
      },
      method: "GET",
    })
    .reply(200, { features: [] }, { headers: { "content-type": "application/json" } })
    .persist();

  await dfwPermits.handler({ city: "mckinney", address: "Virginia", limit: 5 });
  assert.match(capturedWhere, /UPPER\(MODULE\) = 'PERMIT'/);
});

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
  assert.match(res.structuredContent.message, /Fort Worth only/);
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

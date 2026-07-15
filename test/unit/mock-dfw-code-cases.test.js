/**
 * Offline handler test for dfw_code_cases using undici's MockAgent (no live network).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwCodeCases } from "../../tools/civic/dfw-code-cases.js";
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

const CASE_ATTRS = {
  Case_ID: "26-738283",
  Complaint_Type_Description: "Homeless Camp Abatement",
  Violation_Address: "3419 N MAIN ST",
  City: "Fort Worth",
  Violation_Current_Status: "Closed",
  Case_Current_Status: "Closed",
  Case_Created_Date: 1780917474000,
  Update_Date: 1780922980000,
  Next_Activity_Due_Date: "2026-07-01 00:00:00",
  Code_Officer: "Washington, Joshua",
  Code_Officer_PhoneNo: "817-392-2354",
  Latitude: 32.808154665569056,
  Longitude: -97.351841868453533,
};

function mockCodeCasesQuery(attrsList, status = 200) {
  mockAgent
    .get("https://services5.arcgis.com")
    .intercept({ path: (p) => p.includes("/CFW_Open_Data_Code_Violations_Table_view/FeatureServer/0/query"), method: "GET" })
    .reply(
      status,
      status === 200 ? { features: attrsList.map((attributes) => ({ attributes })) } : "server error",
      { headers: { "content-type": "application/json" } }
    )
    .persist();
}

test("dfw_code_cases: normalizes Fort Worth code-violation records", async () => {
  mockCodeCasesQuery([CASE_ATTRS]);
  const res = await dfwCodeCases.handler({ address: "3419 N Main St", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.case_id, "26-738283");
  assert.equal(r.complaint_type, "Homeless Camp Abatement");
  assert.equal(r.violation_status, "Closed");
  assert.equal(r.created, "2026-06-08"); // epoch -> date
  assert.equal(r.next_activity_due, "2026-07-01");
  assert.equal(r.officer, "Washington, Joshua");
  assert.match(res.content[0].text, /Fort Worth only/);
  assert.match(res.content[0].text, /Not a consumer report/i);
});

test("dfw_code_cases: city=dallas is refused, no network call", async () => {
  const res = await dfwCodeCases.handler({ city: "dallas", address: "3419 N Main St" });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.structuredContent.message, /Fort Worth only/);
  assert.equal(res.structuredContent.count, 0);
});

test("dfw_code_cases: flipping fortWorthCodeViolations to verified:false throws a clear error", async () => {
  ARCGIS.fortWorthCodeViolations.verified = false;
  try {
    await assert.rejects(() => dfwCodeCases.handler({ address: "Main St" }), /not verified/);
  } finally {
    ARCGIS.fortWorthCodeViolations.verified = true;
  }
});

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

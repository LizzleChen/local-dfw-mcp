/**
 * Offline handler test for dfw_tea_schools using undici's MockAgent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwTeaSchools } from "../../tools/civic/dfw-tea-schools.js";

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
});

const ROW = {
  campus: "BOOKER T WASHINGTON SPVA MAGNET",
  campus_number: "057905024",
  school_type: "High School",
  grades_served: "09-12",
  district: "DALLAS ISD",
  district_number: "057905",
  county: "DALLAS",
  region: "REGION 10: RICHARDSON",
  number_of_students: "950",
  economically_disadvantaged: "0.35",
  overall_rating: "A",
  overall_score: "95",
  student_achievement_rating: "A",
  school_progress_rating: "A",
  closing_the_gaps_rating: "A",
};

test("dfw_tea_schools: district filter queries data.texas.gov and normalizes", async () => {
  mockAgent
    .get("https://data.texas.gov")
    .intercept({ path: (p) => p.startsWith("/resource/nui6-x374.json"), method: "GET" })
    .reply(200, [ROW], { headers: { "content-type": "application/json" } });

  const res = await dfwTeaSchools.handler({ district: "Dallas ISD", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  const r = payload.results[0];
  assert.equal(r.campus, "BOOKER T WASHINGTON SPVA MAGNET");
  assert.equal(r.rating.overall, "A");
  assert.equal(r.enrollment, 950);
  assert.equal(r.economically_disadvantaged_pct, 35);
  assert.match(res.content[0].text, /TEA Schools/);
});

test("dfw_tea_schools: requires at least one filter (no network)", async () => {
  const res = await dfwTeaSchools.handler({ limit: 5 });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /requires at least one/);
});

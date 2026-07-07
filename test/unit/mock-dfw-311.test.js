/**
 * Offline handler test for dfw_311 using undici's MockAgent (no live network).
 * Covers the three routing paths: explicit city override, string-detected
 * wrong city (refusal, zero network), and full geocode -> city-limits PIP ->
 * SODA query.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfw311 } from "../../tools/civic/dfw-311.js";

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
  service_request_number: "26-00294099",
  address: "999 S HARWOOD ST, DALLAS, TX, 75201",
  city_council_district: "2",
  department: "Police Department",
  service_request_type: "Fireworks - DPD",
  status: "Closed",
  created_date: "2026-07-05T03:09:04.000",
  update_date: "2026-07-05T03:09:11.000",
  closed_date: "2026-07-05T03:09:04.000",
  priority: "Standard",
  method_received_description: "Phone",
};

function mockSoda(rows) {
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({ path: (p) => p.startsWith("/resource/d7e7-envw.json"), method: "GET" })
    .reply(200, rows, { headers: { "content-type": "application/json" } });
}

function mockGeocode() {
  mockAgent
    .get("https://geocoding.geo.census.gov")
    .intercept({ path: (p) => p.startsWith("/geocoder/locations/onelineaddress"), method: "GET" })
    .reply(
      200,
      {
        result: {
          addressMatches: [
            {
              coordinates: { x: -96.795837, y: 32.77666 },
              matchedAddress: "1500 MARILLA ST, DALLAS, TX, 75201",
              addressComponents: { zip: "75201", city: "DALLAS", state: "TX" },
            },
          ],
        },
      },
      { headers: { "content-type": "application/json" } }
    );
}

function mockCityLimits(cityValue) {
  mockAgent
    .get("https://services2.arcgis.com")
    .intercept({ path: (p) => p.includes("/CityLimits/FeatureServer/0/query"), method: "GET" })
    .reply(
      200,
      { features: cityValue === null ? [] : [{ attributes: { CITY: cityValue } }] },
      { headers: { "content-type": "application/json" } }
    );
}

test("dfw_311: explicit city override queries SODA and returns search envelope", async () => {
  mockSoda([ROW, ROW, ROW]); // limit 2 + 1 extra -> hasMore
  const res = await dfw311.handler({ service_type: "fireworks", city: "dallas", limit: 2 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 2);
  assert.equal(payload.results.length, 2);
  assert.equal(payload.results[0].service_request_number, "26-00294099");
  assert.equal(payload.results[0].council_district, "2");
  assert.ok(payload.nextCursor, "expected nextCursor when more rows exist");
  assert.match(res.content[0].text, /Dallas 311/);
});

test("dfw_311: Fort Worth address is refused without any network call", async () => {
  // No interceptors registered for this test -- any fetch would throw
  // (disableNetConnect + no matching mock).
  const res = await dfw311.handler({ address: "100 Main St, Fort Worth TX 76102", limit: 5 });
  assert.ok(res.structuredContent.not_covered, "expected not_covered flag");
  assert.equal(res.structuredContent.count, 0);
  assert.match(res.content[0].text, /Not covered/);
  assert.match(res.content[0].text, /Fort Worth/);
  assert.match(res.content[0].text, /City of Dallas only/);
});

test("dfw_311: geocode + city-limits PIP confirms Dallas, then queries SODA", async () => {
  mockGeocode();
  mockCityLimits("Dallas");
  mockSoda([ROW]);
  const res = await dfw311.handler({ address: "1500 Marilla St 75201", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  assert.match(payload.routing, /City of Dallas/);
  assert.equal(payload.nextCursor, null);
});

test("dfw_311: status 'open' maps to the dataset's real vocabulary", async () => {
  // The dataset has NO literal "Open" status (rows are New / In Progress /
  // Escalated / On Hold / Closed*), so a plain equality on "open" -- even
  // case-insensitive -- silently returns zero rows.
  let capturedWhere = null;
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({
      path: (p) => {
        if (!p.startsWith("/resource/d7e7-envw.json")) return false;
        capturedWhere = decodeURIComponent(p.replace(/\+/g, " "));
        return true;
      },
      method: "GET",
    })
    .reply(200, [ROW], { headers: { "content-type": "application/json" } });

  const res = await dfw311.handler({ status: "open", city: "dallas", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  assert.ok(
    capturedWhere.includes("upper(status) not like 'CLOSED%'"),
    `expected open-bucket status clause, got: ${capturedWhere}`
  );
});

test("dfw_311: exact status is matched case-insensitively", async () => {
  let capturedWhere = null;
  mockAgent
    .get("https://www.dallasopendata.com")
    .intercept({
      path: (p) => {
        if (!p.startsWith("/resource/d7e7-envw.json")) return false;
        capturedWhere = decodeURIComponent(p.replace(/\+/g, " "));
        return true;
      },
      method: "GET",
    })
    .reply(200, [ROW], { headers: { "content-type": "application/json" } });

  const res = await dfw311.handler({ status: "in progress", city: "dallas", limit: 5 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1);
  assert.ok(
    capturedWhere.includes("upper(status) = 'IN PROGRESS'"),
    `expected case-insensitive status clause, got: ${capturedWhere}`
  );
});

test("dfw_311: geocoded point OUTSIDE Dallas limits is refused", async () => {
  mockGeocode();
  mockCityLimits(null); // point in no City-of-Dallas polygon
  const res = await dfw311.handler({ address: "700 Some Rd, Dallas TX", limit: 5 });
  assert.ok(res.structuredContent.not_covered);
  assert.match(res.content[0].text, /does not fall inside City of Dallas limits/);
});

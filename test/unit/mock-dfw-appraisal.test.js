/**
 * Offline handler test for dfw_appraisal using undici's MockAgent (no live
 * network). Covers: string->number normalization, blank->null trimming,
 * DATE_ACQ formatting, MKT_VALUE=0 -> null + value_note (never $0), MAIL_*
 * fields omitted, multiple-parcel handling, and the JSON envelope shape.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwAppraisal } from "../../tools/property/dfw-appraisal.js";

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

// A Dallas City Hall-style parcel, exactly as the upstream returns it: ALL
// values are strings under UPPERCASE keys; blanks are whitespace-padded.
const DALLAS_ATTRS = {
  objectid: "3282343",
  PROP_ID: "00000101154000000",
  OWNER_NAME: "DALLAS CITY OF",
  NAME_CARE: "EXEMPT",
  LEGAL_AREA: "16.02 a",
  LEGAL_DESC: " ",
  LAND_VALUE: "32032500",
  IMP_VALUE: "8420",
  MKT_VALUE: "32040920",
  SITUS_ADDR: "1400  YOUNG ST   ,DALLAS, TX 75201",
  SITUS_NUM: "1400",
  SITUS_ST_1: "YOUNG ST",
  SITUS_CITY: "DALLAS",
  SITUS_STAT: "TX",
  SITUS_ZIP: "75201",
  MAIL_ADDR: "1500 MARILLA ST  , DALLAS, TEXAS 752016318",
  MAIL_CITY: "DALLAS",
  SOURCE: "DALLAS APPRAISAL DISTRICT",
  DATE_ACQ: "20250801",
  FIPS: "48113",
  COUNTY: "DALLAS",
  TAX_YEAR: "2025",
  YEAR_BUILT: " ",
  LGL_AREA_UNIT: "Acres",
  STAT_LAND_USE: "F10",
  LOC_LAND_USE: "COM",
};

// A Tarrant-style parcel where MKT_VALUE (and LAND/IMP) publish as 0.
const TARRANT_ZERO_ATTRS = {
  PROP_ID: "12345",
  OWNER_NAME: "SOME OWNER LLC",
  LAND_VALUE: "0",
  IMP_VALUE: "0",
  MKT_VALUE: "0",
  SITUS_NUM: "200",
  SITUS_ST_1: "TEXAS ST",
  SITUS_CITY: "FORT WORTH",
  SITUS_STAT: "TX",
  SITUS_ZIP: "76102",
  SOURCE: "TARRANT APPRAISAL DISTRICT",
  DATE_ACQ: "20250701",
  FIPS: "48439",
  COUNTY: "TARRANT",
  TAX_YEAR: "2025",
  YEAR_BUILT: "1985",
  LGL_AREA_UNIT: "Acres",
};

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
              coordinates: { x: -96.7970, y: 32.7767 },
              matchedAddress: "1500 MARILLA ST, DALLAS, TX, 75201",
              addressComponents: { zip: "75201", city: "DALLAS", state: "TX" },
            },
          ],
        },
      },
      { headers: { "content-type": "application/json" } }
    );
}

function mockIdentify(attrsList) {
  mockAgent
    .get("https://feature.geographic.texas.gov")
    .intercept({ path: (p) => p.includes("/MapServer/identify"), method: "GET" })
    .reply(
      200,
      { results: attrsList.map((attributes) => ({ layerId: 0, attributes })) },
      { headers: { "content-type": "application/json" } }
    );
}

test("dfw_appraisal: normalizes strings->numbers, blanks->null, DATE_ACQ, omits MAIL_*", async () => {
  mockGeocode();
  mockIdentify([DALLAS_ATTRS]);
  const res = await dfwAppraisal.handler({ address: "1500 Marilla St Dallas TX 75201" });
  const payload = JSON.parse(res.content[1].text);

  assert.equal(payload.count, 1);
  const p = payload.parcels[0];

  // strings -> numbers
  assert.equal(p.land_value, 32032500);
  assert.equal(p.improvement_value, 8420);
  assert.equal(p.market_value, 32040920);
  assert.equal(p.tax_year, 2025);
  assert.equal(typeof p.market_value, "number");

  // blank whitespace -> null
  assert.equal(p.year_built, null);
  assert.equal(p.legal_description, null);

  // preserved fields
  assert.equal(p.prop_id, "00000101154000000");
  assert.equal(p.owner_name, "DALLAS CITY OF");
  assert.equal(p.legal_area, "16.02 a");
  assert.equal(p.legal_area_unit, "Acres");
  assert.equal(p.state_land_use, "F10");
  assert.equal(p.local_land_use, "COM");
  assert.equal(p.county, "DALLAS");
  assert.equal(p.fips, "48113");
  assert.equal(p.source, "DALLAS APPRAISAL DISTRICT");

  // DATE_ACQ formatting
  assert.equal(p.date_acquired, "2025-08-01");

  // composed situs address is clean
  assert.equal(p.situs_address, "1400 YOUNG ST, DALLAS, TX 75201");

  // MAIL_* entirely omitted
  const keys = Object.keys(p).concat(Object.keys(p.situs));
  assert.ok(!keys.some((k) => /^mail/i.test(k)), "no MAIL_* fields should be present");
  assert.ok(!JSON.stringify(p).includes("MARILLA"), "mailing address must not leak");

  // no value_note when values are healthy
  assert.equal(p.value_note, undefined);

  // markdown shows USD, never a raw $0, and carries the FCRA + tax-bill caveats
  const md = res.content[0].text;
  assert.match(md, /\$32,040,920/);
  assert.match(md, /Appraised value ≠ tax bill/);
  assert.match(md, /Not a consumer report/);
  assert.match(md, /2025 certified roll/);
  // Honesty: a single parcel is still a geocoded-point match, not an exact
  // parcel-number match -- the markdown must say so and point at Situs.
  assert.match(md, /geocoded location/i);
  assert.match(md, /Situs/);
});

test("dfw_appraisal: MKT_VALUE=0 -> null + value_note, never $0", async () => {
  mockGeocode();
  mockIdentify([TARRANT_ZERO_ATTRS]);
  const res = await dfwAppraisal.handler({ address: "200 Texas St Fort Worth TX 76102" });
  const payload = JSON.parse(res.content[1].text);
  const p = payload.parcels[0];

  assert.equal(p.market_value, null);
  assert.equal(p.land_value, null);
  assert.equal(p.improvement_value, null);
  assert.ok(p.value_note, "expected a value_note when values are suppressed");

  const md = res.content[0].text;
  assert.doesNotMatch(md, /\$0\b/, "must never render $0");
  assert.match(md, /value unavailable/i);
});

test("dfw_appraisal: multiple parcels (stacked/condo) are all rendered", async () => {
  mockGeocode();
  mockIdentify([DALLAS_ATTRS, TARRANT_ZERO_ATTRS]);
  const res = await dfwAppraisal.handler({ address: "somewhere" });
  const payload = JSON.parse(res.content[1].text);

  assert.equal(payload.count, 2);
  assert.equal(payload.parcels.length, 2);
  assert.match(res.content[0].text, /Parcel 1 of 2/);
  assert.match(res.content[0].text, /Parcel 2 of 2/);
  // Honesty: multi-parcel results are matched by point and may be adjacent lots,
  // not just stacked units -- the markdown must say so and point at Situs.
  assert.match(res.content[0].text, /2 parcels matched/i);
  assert.match(res.content[0].text, /adjacent/i);
  assert.match(res.content[0].text, /Situs/);
});

test("dfw_appraisal: JSON envelope shape { query, geocoded, count, parcels[] }", async () => {
  mockGeocode();
  mockIdentify([DALLAS_ATTRS]);
  const res = await dfwAppraisal.handler({ address: "1500 Marilla St" });
  const payload = JSON.parse(res.content[1].text);

  assert.deepEqual(Object.keys(payload).sort(), ["count", "geocoded", "parcels", "query"]);
  assert.equal(payload.query.address, "1500 Marilla St");
  assert.equal(typeof payload.query.latitude, "number");
  assert.equal(typeof payload.query.longitude, "number");
  assert.equal(payload.geocoded.matched_address, "1500 MARILLA ST, DALLAS, TX, 75201");
  assert.ok(Array.isArray(payload.parcels));
});

test("dfw_appraisal: lat/lng bypasses geocode; no parcel -> helpful message", async () => {
  // Only an identify mock, returning empty results. No geocode interceptor: if
  // the handler tried to geocode it would throw (disableNetConnect).
  mockIdentify([]);
  const res = await dfwAppraisal.handler({ latitude: 32.7767, longitude: -96.7970 });
  assert.equal(res.content.length, 1);
  assert.match(res.content[0].text, /No parcel found/);
});

test("dfw_appraisal: missing address and coords -> input error", async () => {
  const res = await dfwAppraisal.handler({});
  assert.ok(res.isError);
  assert.match(res.content[0].text, /requires either an address or latitude\+longitude/);
});

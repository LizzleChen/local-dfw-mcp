import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocation, resolveCityJurisdiction, cityLabel, streetPart } from "../../lib/metro-router.js";

test("detectLocation: City of Dallas ZIP", () => {
  assert.deepEqual(detectLocation("1500 Marilla St, Dallas, TX 75201"), { city: "dallas", county: "dallas" });
});

test("detectLocation: Fort Worth ZIP -> Tarrant", () => {
  assert.deepEqual(detectLocation("100 Main, Fort Worth TX 76102"), { city: "fortworth", county: "tarrant" });
});

test("detectLocation: Irving ZIP is Dallas County but NOT City of Dallas", () => {
  assert.deepEqual(detectLocation("500 W Las Colinas Blvd, Irving TX 75039"), { city: "irving", county: "dallas" });
});

test("detectLocation: Plano keyword -> county null (straddles Collin/Denton)", () => {
  assert.deepEqual(detectLocation("some road, Plano TX"), { city: "plano", county: null });
});

test("detectLocation: keyword order -- Arlington wins over trailing DALLAS street name", () => {
  assert.deepEqual(detectLocation("100 DALLAS AVE, ARLINGTON TX"), { city: "arlington", county: "tarrant" });
});

test("detectLocation: unknown -> nulls", () => {
  assert.deepEqual(detectLocation(""), { city: null, county: null });
  assert.deepEqual(detectLocation(null), { city: null, county: null });
  assert.deepEqual(detectLocation("somewhere in Houston TX 77002"), { city: null, county: null });
});

test("resolveCityJurisdiction: explicit non-Dallas city is refused (no network)", async () => {
  const r = await resolveCityJurisdiction({ city: "plano" }, "dallas");
  assert.equal(r.ok, false);
  assert.match(r.message, /City of Dallas only/);
});

test("resolveCityJurisdiction: explicit dallas is allowed as override (no network)", async () => {
  const r = await resolveCityJurisdiction({ city: "dallas", address: "anywhere" }, "dallas");
  assert.equal(r.ok, true);
  assert.equal(r.city, "dallas");
});

test("resolveCityJurisdiction: ZIP-detected Fort Worth is refused before any network call", async () => {
  const r = await resolveCityJurisdiction({ address: "100 Main St, Fort Worth TX 76102" }, "dallas");
  assert.equal(r.ok, false);
  assert.equal(r.detectedCity, "fortworth");
  assert.match(r.message, /Fort Worth/);
});

test("streetPart: strips comma-separated city/state/zip", () => {
  assert.equal(streetPart("1500 Marilla St, Dallas, TX 75201"), "1500 Marilla St");
});

test("streetPart: strips inline city/state/zip without commas", () => {
  assert.equal(streetPart("1500 Marilla St Dallas TX 75201"), "1500 Marilla St");
  assert.equal(streetPart("100 Main St Fort Worth TX"), "100 Main St");
});

test("streetPart: leaves a bare street alone", () => {
  assert.equal(streetPart("3424 Ladd St"), "3424 Ladd St");
  assert.equal(streetPart(""), "");
});

test("cityLabel: known + fallback", () => {
  assert.equal(cityLabel("fortworth"), "Fort Worth");
  assert.equal(cityLabel("weird"), "Weird");
});

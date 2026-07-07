import { test } from "node:test";
import assert from "node:assert/strict";
import { sodaAddressLike, sodaTextLike, sodaTextEq } from "../../lib/soda.js";

test("sodaAddressLike: uppercases + escapes quotes", () => {
  assert.equal(
    sodaAddressLike("address", "1500 Marilla"),
    "upper(address) like '%1500 MARILLA%'"
  );
});

test("sodaAddressLike: escapes single quote", () => {
  assert.match(sodaAddressLike("addr", "O'Hara"), /'%O''HARA%'/);
});

test("sodaAddressLike: throws on missing args", () => {
  assert.throws(() => sodaAddressLike("", "x"));
  assert.throws(() => sodaAddressLike("f", ""));
});

test("sodaTextLike: contains match", () => {
  assert.equal(sodaTextLike("service_request_type", "pothole"), "upper(service_request_type) like '%POTHOLE%'");
});

test("sodaTextLike: escapes quotes", () => {
  assert.match(sodaTextLike("field", "it's broken"), /'%IT''S BROKEN%'/);
});

test("sodaTextEq: numeric coerce + quote", () => {
  assert.equal(sodaTextEq("city_council_district", 3), "city_council_district = '3'");
  assert.equal(sodaTextEq("status", "Open"), "status = 'Open'");
});

test("sodaTextEq: escapes single quote", () => {
  assert.equal(sodaTextEq("name", "O'Hara"), "name = 'O''Hara'");
});

test("sodaTextEq: throws on missing args", () => {
  assert.throws(() => sodaTextEq("", "x"));
  assert.throws(() => sodaTextEq("f", ""));
  assert.throws(() => sodaTextEq("f", null));
});

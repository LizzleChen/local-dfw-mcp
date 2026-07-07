/**
 * dfw_district_lookup smoke test (live network). Run: node test/smoke-district-lookup.js
 * 1500 Marilla St (Dallas City Hall) verified 2026-07-06: Council District 2.
 */
import { dfwDistrictLookup } from "../tools/civic/dfw-district-lookup.js";

try {
  const start = Date.now();
  const res = await dfwDistrictLookup.handler({ address: "1500 Marilla St Dallas TX 75201" });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
  const json = JSON.parse(res.content[1].text);
  const r = json.results;
  if (!r.county?.value || !/dallas/i.test(r.county.value)) throw new Error(`county wrong: ${JSON.stringify(r.county)}`);
  if (!r.city_limits?.value) throw new Error("city hall not detected inside City of Dallas limits");
  if (!r.council_district?.value) throw new Error("no council district");
  console.log(`district smoke: City Hall -> county=${r.county.value}, city=${r.city_limits.value}, council=District ${r.council_district.value} (${r.council_district.extra ?? "?"}), ISD=${r.school_district?.value ?? "?"} in ${Date.now() - start}ms`);
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

/**
 * dfw_utility_providers smoke test (live network). Run: node test/smoke-utility-providers.js
 * Frisco point verified 2026-07-06 to sit inside the CITY OF FRISCO water CCN.
 */
import { dfwUtilityProviders } from "../tools/property/dfw-utility-providers.js";

try {
  const start = Date.now();
  const res = await dfwUtilityProviders.handler({ address: "6801 Warren Pkwy, Frisco TX 75034" });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.water)) throw new Error("no water array");
  if (json.water.length === 0) throw new Error("expected a water CCN provider at the Frisco test point");
  console.log(`utility smoke: Frisco -> water=${json.water[0].utility} (CCN ${json.water[0].ccn_no}) in ${Date.now() - start}ms`);
  console.log(`  sewer: ${json.sewer[0]?.utility ?? "(none mapped)"}`);
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

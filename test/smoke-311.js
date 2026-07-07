/**
 * dfw_311 smoke test (live network). Run: node test/smoke-311.js
 * Exercises the full path: guard (geocode + city-limits PIP) + SODA query,
 * plus a wrong-city refusal (string layer only).
 */
import { dfw311 } from "../tools/civic/dfw-311.js";

try {
  const start = Date.now();
  const res = await dfw311.handler({ address: "1500 Marilla St Dallas TX 75201", limit: 5 });
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("no results array");
  console.log(`311 smoke: 1500 Marilla -> ${json.count} requests in ${Date.now() - start}ms (routing: ${json.routing})`);
  if (json.results[0]) console.log(`  sample: ${json.results[0].created_date} ${json.results[0].type}`);

  // Wrong-city refusal must not query.
  const fw = await dfw311.handler({ address: "100 Main St, Fort Worth TX 76102", service_type: "pothole" });
  if (!fw.structuredContent?.not_covered) throw new Error("Fort Worth address was NOT refused");
  console.log("  wrong-city guard: Fort Worth refused as expected");
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

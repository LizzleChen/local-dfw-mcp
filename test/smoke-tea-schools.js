/**
 * dfw_tea_schools smoke test (live network). Run: node test/smoke-tea-schools.js
 */
import { dfwTeaSchools } from "../tools/civic/dfw-tea-schools.js";

try {
  const start = Date.now();
  const res = await dfwTeaSchools.handler({ district: "Frisco ISD", limit: 10 });
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results) || json.count === 0) throw new Error("zero campuses for Frisco ISD");
  console.log(`tea smoke: Frisco ISD -> ${json.count} campuses in ${Date.now() - start}ms`);
  for (const r of json.results.slice(0, 3)) {
    console.log(`  - ${r.campus} (${r.school_type ?? "?"}) rating=${r.rating?.overall ?? "?"}`);
  }
  if (!json.results[0].campus || !json.results[0].district) throw new Error("missing required fields");
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

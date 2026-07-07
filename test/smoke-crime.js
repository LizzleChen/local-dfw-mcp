/**
 * dfw_crime smoke test (live network). Run: node test/smoke-crime.js
 */
import { dfwCrime } from "../tools/civic/dfw-crime.js";

try {
  const start = Date.now();
  const res = await dfwCrime.handler({ offense: "burglary", city: "dallas", limit: 5 });
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("no results array");
  if (json.count === 0) throw new Error("zero burglary incidents in 90 days is implausible -- dataset may be stale");
  console.log(`crime smoke: burglary -> ${json.count} incidents in ${Date.now() - start}ms`);
  console.log(`  sample: ${json.results[0].occurred_date} ${json.results[0].offense} @ ${json.results[0].address}`);
  if (!/consumer report/i.test(res.content[0].text)) throw new Error("FCRA note missing from output");
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

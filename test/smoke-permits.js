/**
 * dfw_permits smoke test (live network). Run: node test/smoke-permits.js
 */
import { dfwPermits } from "../tools/civic/dfw-permits.js";

try {
  const start = Date.now();
  const res = await dfwPermits.handler({ street: "Main", limit: 5 });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 300));
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("no results array");
  if (json.count === 0) throw new Error("zero permits for street=\"Main\" is implausible -- dataset may be stale or query broken");
  console.log(`permits smoke: street=Main -> ${json.count} permits in ${Date.now() - start}ms`);
  const r = json.results[0];
  console.log(`  sample: ${r.permit_no} ${r.permit_type} @ ${r.address} filed ${r.file_date} status=${r.status}`);

  const refused = await dfwPermits.handler({ city: "dallas", street: "Main" });
  if (!refused.structuredContent?.not_covered) throw new Error("city=dallas should be refused, was not");
  console.log("  city=dallas correctly refused (not_covered=true)");

  const mckStart = Date.now();
  const mckRes = await dfwPermits.handler({ city: "mckinney", address: "216 W Virginia St", limit: 5 });
  if (mckRes.isError) throw new Error(mckRes.content[0].text.slice(0, 300));
  const mckJson = JSON.parse(mckRes.content[1].text);
  if (!Array.isArray(mckJson.results)) throw new Error("mckinney: no results array");
  if (mckJson.count === 0) throw new Error('mckinney: zero permits for "216 W Virginia St" is implausible -- dataset may be stale or query broken');
  console.log(`permits smoke: mckinney address="216 W Virginia St" -> ${mckJson.count} permits in ${Date.now() - mckStart}ms`);
  const mr = mckJson.results[0];
  console.log(`  sample: ${mr.permit_no} ${mr.permit_type} @ ${mr.address} filed(from case #) ${mr.filed_from_case_number} status=${mr.status}`);

  const mckMissingAddr = await dfwPermits.handler({ city: "mckinney" });
  if (!mckMissingAddr.structuredContent?.not_covered) throw new Error("mckinney without address should be refused, was not");
  console.log("  mckinney without address correctly refused (not_covered=true)");

  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

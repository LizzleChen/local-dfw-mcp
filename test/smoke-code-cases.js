/**
 * dfw_code_cases smoke test (live network). Run: node test/smoke-code-cases.js
 */
import { dfwCodeCases } from "../tools/civic/dfw-code-cases.js";

try {
  const start = Date.now();
  const res = await dfwCodeCases.handler({ complaint_type: "high grass", limit: 5 });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 300));
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("no results array");
  if (json.count === 0) throw new Error('zero "high grass" cases is implausible -- dataset may be stale or query broken');
  console.log(`code-cases smoke: complaint_type="high grass" -> ${json.count} cases in ${Date.now() - start}ms`);
  const r = json.results[0];
  console.log(`  sample: ${r.case_id} ${r.complaint_type} @ ${r.address} created ${r.created} status=${r.violation_status}`);
  if (!/consumer report/i.test(res.content[0].text)) throw new Error("FCRA note missing from output");

  const refused = await dfwCodeCases.handler({ city: "dallas", address: "Main St" });
  if (!refused.structuredContent?.not_covered) throw new Error("city=dallas should be refused, was not");
  console.log("  city=dallas correctly refused (not_covered=true)");

  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

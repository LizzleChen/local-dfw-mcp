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

  const mckStart = Date.now();
  const mckRes = await dfwCodeCases.handler({ city: "mckinney", limit: 5 });
  if (mckRes.isError) throw new Error(mckRes.content[0].text.slice(0, 300));
  const mckJson = JSON.parse(mckRes.content[1].text);
  if (!Array.isArray(mckJson.results)) throw new Error("mckinney: no results array");
  if (mckJson.count === 0) throw new Error("mckinney: zero recent code cases is implausible -- dataset may be stale or query broken");
  console.log(`code-cases smoke: mckinney recent -> ${mckJson.count} cases in ${Date.now() - mckStart}ms`);
  const mr = mckJson.results[0];
  console.log(`  sample: ${mr.case_id} ${mr.complaint_type} @ ${mr.address} created ${mr.created} status=${mr.violation_status}`);
  if (!/consumer report/i.test(mckRes.content[0].text)) throw new Error("mckinney: FCRA note missing from output");

  const arlStart = Date.now();
  const arlRes = await dfwCodeCases.handler({ city: "arlington", limit: 5 });
  if (arlRes.isError) throw new Error(arlRes.content[0].text.slice(0, 300));
  const arlJson = JSON.parse(arlRes.content[1].text);
  if (!Array.isArray(arlJson.results)) throw new Error("arlington: no results array");
  if (arlJson.count === 0) throw new Error("arlington: zero recent code cases is implausible -- dataset may be stale or query broken");
  console.log(`code-cases smoke: arlington recent -> ${arlJson.count} cases in ${Date.now() - arlStart}ms`);
  const ar = arlJson.results[0];
  console.log(`  sample: ${ar.case_id} ${ar.complaint_type} @ ${ar.address} created ${ar.created} status=${ar.violation_status}`);
  if (!/consumer report/i.test(arlRes.content[0].text)) throw new Error("arlington: FCRA note missing from output");

  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

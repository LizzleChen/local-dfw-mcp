/**
 * dfw_traffic smoke test (live network, no API keys). Run: node test/smoke-traffic.js
 *
 * Exercises all 5 `kind` values with a small limit; asserts the JSON envelope
 * shape (results array + numeric count) for each. Does not require non-zero
 * results for every kind (incidents is a small live rolling table that can be
 * legitimately empty at times), but the shape must always be right.
 */
import { dfwTraffic } from "../tools/traffic/dfw-traffic.js";

const KINDS = ["incidents", "closures", "counts", "projects", "all"];

function sampleId(r) {
  if (!r) return "(none)";
  return r.event_number ?? r.permit_number ?? r.station_id ?? r.proj_id ?? r.type ?? "(unknown)";
}

let failures = 0;

for (const kind of KINDS) {
  try {
    const start = Date.now();
    const res = await dfwTraffic.handler({ kind, limit: 5 });
    if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
    if (!res.content[1]) throw new Error(`no structured payload: ${res.content[0].text.slice(0, 150)}`);
    const json = JSON.parse(res.content[1].text);
    if (!Array.isArray(json.results)) throw new Error("no results array");
    if (typeof json.count !== "number") throw new Error(`count is not a number: ${typeof json.count}`);
    if (json.results.length !== json.count) throw new Error(`results.length (${json.results.length}) != count (${json.count})`);
    console.log(
      `OK: ${kind} count=${json.count} sample=${sampleId(json.results[0])} in ${Date.now() - start}ms` +
        (json.notes.length ? ` notes=${json.notes.length}` : "")
    );
  } catch (err) {
    failures++;
    console.error(`FAIL (kind=${kind}): ${err?.message ?? err}`);
  }
}

// Arlington closures branch (v0.3) -- dedicated check since the generic loop
// above uses the default (Dallas + Arlington merged) closures query, which
// may not always surface an Arlington row on top.
try {
  const start = Date.now();
  const res = await dfwTraffic.handler({ kind: "closures", city: "arlington", limit: 5 });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("arlington: no results array");
  if (json.count === 0) throw new Error("zero Arlington ROW closures is implausible -- dataset may be stale or query broken");
  if (!json.results.every((r) => r.city === "arlington")) throw new Error("city=arlington scoping leaked non-Arlington rows");
  console.log(`OK: closures city=arlington count=${json.count} sample=${json.results[0].permit_number} in ${Date.now() - start}ms`);
} catch (err) {
  failures++;
  console.error(`FAIL (closures city=arlington): ${err?.message ?? err}`);
}

if (failures) {
  console.error(`FAIL: ${failures}/${KINDS.length + 1} traffic smoke case(s) failed`);
  process.exit(1);
}
console.log("OK");
process.exit(0);

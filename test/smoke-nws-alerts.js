/**
 * dfw_nws_alerts smoke test (live network). Run: node test/smoke-nws-alerts.js
 * Zero active alerts is a normal, passing outcome.
 */
import { dfwNwsAlerts } from "../tools/environment/dfw-nws-alerts.js";

try {
  const start = Date.now();
  const res = await dfwNwsAlerts.handler({});
  if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
  const json = JSON.parse(res.content[1].text);
  if (!Array.isArray(json.results)) throw new Error("no results array");
  console.log(`nws smoke: downtown Dallas -> ${json.count} active alert(s) in ${Date.now() - start}ms`);
  if (json.results[0]) console.log(`  sample: ${json.results[0].event} (${json.results[0].severity})`);
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

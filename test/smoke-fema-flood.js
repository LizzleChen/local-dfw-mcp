/**
 * dfw_fema_flood smoke test (live network). Run: node test/smoke-fema-flood.js
 */
import { dfwFemaFlood } from "../tools/property/dfw-fema-flood.js";

try {
  const start = Date.now();
  const res = await dfwFemaFlood.handler({ address: "1500 Marilla St Dallas TX 75201" });
  if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
  if (!res.content[1]) throw new Error(`no structured payload: ${res.content[0].text.slice(0, 150)}`);
  const json = JSON.parse(res.content[1].text);
  if (!json.zone?.flood_zone) throw new Error("no flood_zone in payload");
  console.log(`flood smoke: 1500 Marilla -> Zone ${json.zone.flood_zone} (SFHA=${json.zone.in_sfha}) in ${Date.now() - start}ms`);
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
}

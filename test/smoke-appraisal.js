/**
 * dfw_appraisal smoke test (live network). Run: node test/smoke-appraisal.js
 *
 * One point per core county; each must return >=1 parcel on the 2025 certified
 * roll with the expected COUNTY.
 */
import { dfwAppraisal } from "../tools/property/dfw-appraisal.js";

const CASES = [
  { address: "1500 Marilla St Dallas TX 75201", county: "DALLAS" },
  { address: "200 Texas St Fort Worth TX 76102", county: "TARRANT" },
  { address: "1520 K Ave Plano TX 75074", county: "COLLIN" },
  { address: "215 E McKinney St Denton TX 76201", county: "DENTON" },
];

let failures = 0;

for (const c of CASES) {
  try {
    const start = Date.now();
    const res = await dfwAppraisal.handler({ address: c.address });
    if (res.isError) throw new Error(res.content[0].text.slice(0, 200));
    if (!res.content[1]) throw new Error(`no structured payload: ${res.content[0].text.slice(0, 150)}`);
    const json = JSON.parse(res.content[1].text);
    if (!Array.isArray(json.parcels) || json.parcels.length === 0) {
      throw new Error("no parcels returned");
    }
    const p = json.parcels[0];
    const county = (p.county || "").toUpperCase();
    if (county !== c.county) throw new Error(`expected county ${c.county}, got ${county}`);
    if (p.tax_year !== 2025) throw new Error(`expected TAX_YEAR 2025, got ${p.tax_year}`);
    console.log(
      `appraisal smoke: ${c.address} -> ${json.count} parcel(s), ${county} County, ` +
        `market=${p.market_value ?? "n/a"}, tax_year=${p.tax_year} in ${Date.now() - start}ms`
    );
  } catch (err) {
    failures++;
    console.error(`FAIL (${c.address}): ${err?.message ?? err}`);
  }
}

if (failures) {
  console.error(`FAIL: ${failures}/${CASES.length} appraisal smoke case(s) failed`);
  process.exit(1);
}
console.log("OK");
process.exit(0);

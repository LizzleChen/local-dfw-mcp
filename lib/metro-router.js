/**
 * DFW metro routing -- NEW for local-dfw-mcp (not ported; Austin's
 * county-router.js is one-dimensional). Resolves BOTH city (which SODA portal /
 * city tools fire) and county (CAD / parcel / district routing). One dimension
 * cannot imply the other: the City of Dallas spans five counties; Plano and
 * Frisco straddle Collin/Denton; Irving/Garland/Mesquite are Dallas County but
 * NOT the City of Dallas.
 *
 * Three layers, per the plan:
 *   1. Explicit `city` argument (LLM layer -- passed by the tool schema).
 *   2. Server heuristic (this file): ZIP-first, city-keyword fallback. Fast path.
 *   3. Ground truth: geocode -> point-in-polygon against City of Dallas limits.
 *      USPS postal city != jurisdiction, so strings are only a shortcut; the
 *      city-limits polygon is the authority.
 *
 * Hard rule enforced by resolveCityJurisdiction(): a city-scoped tool never
 * silently succeeds against the wrong city. When it cannot confirm the target
 * city it returns { ok:false } with an explicit not-covered message (and an
 * override path), never a best-effort query that yields plausible garbage.
 */

import { geocodeAddress } from "./geocode.js";
import { queryPointInPolygon } from "./arcgis.js";
import { cached } from "./cache.js";
import { ARCGIS, requireVerified } from "./sources.js";

const GEO_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Single-county DFW ZIP -> { city, county } table.
 *
 * TODO-generate: this is a hand-checked ~50-ZIP starter set. The production
 * table should be generated from the HUD USPS ZIP<->county crosswalk, filtered
 * to single-county ZIPs only. Shared/split ZIPs are deliberately omitted so the
 * caller falls through to the keyword layer or ground truth. Note that several
 * Dallas-County cities (Irving, Garland, Mesquite) are intentionally mapped to
 * their own city -- they are NOT the City of Dallas even though the county is.
 */
const ZIP_TO_LOC = {
  // City of Dallas (Dallas County)
  75201: L("dallas", "dallas"), 75202: L("dallas", "dallas"), 75203: L("dallas", "dallas"),
  75204: L("dallas", "dallas"), 75205: L("dallas", "dallas"), 75206: L("dallas", "dallas"),
  75208: L("dallas", "dallas"), 75209: L("dallas", "dallas"), 75210: L("dallas", "dallas"),
  75211: L("dallas", "dallas"), 75212: L("dallas", "dallas"), 75214: L("dallas", "dallas"),
  75215: L("dallas", "dallas"), 75216: L("dallas", "dallas"), 75219: L("dallas", "dallas"),
  75223: L("dallas", "dallas"), 75224: L("dallas", "dallas"), 75226: L("dallas", "dallas"),
  75235: L("dallas", "dallas"), 75246: L("dallas", "dallas"),

  // Irving / Garland / Mesquite -- Dallas County but NOT City of Dallas
  75038: L("irving", "dallas"), 75039: L("irving", "dallas"), 75060: L("irving", "dallas"),
  75061: L("irving", "dallas"), 75062: L("irving", "dallas"), 75063: L("irving", "dallas"),
  75040: L("garland", "dallas"), 75041: L("garland", "dallas"), 75042: L("garland", "dallas"),
  75043: L("garland", "dallas"), 75044: L("garland", "dallas"),
  75149: L("mesquite", "dallas"), 75150: L("mesquite", "dallas"),

  // Fort Worth (Tarrant)
  76102: L("fortworth", "tarrant"), 76103: L("fortworth", "tarrant"), 76104: L("fortworth", "tarrant"),
  76105: L("fortworth", "tarrant"), 76107: L("fortworth", "tarrant"), 76109: L("fortworth", "tarrant"),
  76110: L("fortworth", "tarrant"), 76111: L("fortworth", "tarrant"), 76116: L("fortworth", "tarrant"),
  76133: L("fortworth", "tarrant"),

  // Arlington (Tarrant)
  76010: L("arlington", "tarrant"), 76011: L("arlington", "tarrant"), 76012: L("arlington", "tarrant"),
  76013: L("arlington", "tarrant"), 76014: L("arlington", "tarrant"), 76015: L("arlington", "tarrant"),
  76016: L("arlington", "tarrant"), 76017: L("arlington", "tarrant"), 76018: L("arlington", "tarrant"),

  // Plano (Collin)
  75023: L("plano", "collin"), 75024: L("plano", "collin"), 75025: L("plano", "collin"),
  75074: L("plano", "collin"), 75075: L("plano", "collin"), 75093: L("plano", "collin"),

  // McKinney (Collin)
  75069: L("mckinney", "collin"), 75070: L("mckinney", "collin"), 75071: L("mckinney", "collin"),
  75072: L("mckinney", "collin"),

  // Frisco (straddles Collin/Denton -- county per best-known ZIP)
  75033: L("frisco", "collin"), 75034: L("frisco", "denton"), 75035: L("frisco", "collin"),

  // Denton (Denton County)
  76201: L("denton", "denton"), 76205: L("denton", "denton"), 76207: L("denton", "denton"),
  76208: L("denton", "denton"), 76209: L("denton", "denton"), 76210: L("denton", "denton"),
};

function L(city, county) {
  return { city, county };
}

/**
 * City-keyword fallback. Order matters: multi-word / suburb names first, bare
 * "DALLAS" last (substring risk -- postal "Dallas" often is NOT City of Dallas).
 */
const CITY_KEYWORDS = [
  ["FORT WORTH", L("fortworth", "tarrant")],
  ["ARLINGTON", L("arlington", "tarrant")],
  ["GRAND PRAIRIE", L("grandprairie", "tarrant")],
  ["MCKINNEY", L("mckinney", "collin")],
  ["RICHARDSON", L("richardson", null)],
  ["CARROLLTON", L("carrollton", null)],
  ["MESQUITE", L("mesquite", "dallas")],
  ["GARLAND", L("garland", "dallas")],
  ["IRVING", L("irving", "dallas")],
  ["DENTON", L("denton", "denton")],
  ["PLANO", L("plano", null)],   // Collin OR Denton
  ["FRISCO", L("frisco", null)], // Collin OR Denton
  ["DALLAS", L("dallas", null)], // spans 5 counties; last (substring risk)
];

/**
 * Fast, network-free detection of { city, county } from a free-form address.
 * Either field may be null (unknown). Returns { city: null, county: null } when
 * nothing matches -- the caller then fans out / falls back to ground truth.
 *
 * @param {string} address
 * @returns {{ city: string|null, county: string|null }}
 */
export function detectLocation(address) {
  if (!address || typeof address !== "string") return { city: null, county: null };
  const upper = address.toUpperCase();

  const zip = upper.match(/\b(7[567]\d{3})\b/);
  if (zip && ZIP_TO_LOC[Number(zip[1])]) return { ...ZIP_TO_LOC[Number(zip[1])] };

  for (const [kw, loc] of CITY_KEYWORDS) {
    const re = new RegExp(`(^|[^A-Z])${kw.replace(/ /g, "\\s+")}([^A-Z]|$)`);
    if (re.test(upper)) return { ...loc };
  }
  return { city: null, county: null };
}

const CITY_LABELS = {
  dallas: "Dallas",
  fortworth: "Fort Worth",
  arlington: "Arlington",
  grandprairie: "Grand Prairie",
  plano: "Plano",
  frisco: "Frisco",
  mckinney: "McKinney",
  richardson: "Richardson",
  carrollton: "Carrollton",
  irving: "Irving",
  garland: "Garland",
  mesquite: "Mesquite",
  denton: "Denton",
};

export function cityLabel(key) {
  return CITY_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : "the requested city");
}

/**
 * Ground-truth: is this lat/lng inside the City of Dallas limits polygon?
 * Returns the polygon's CITY value (e.g. "Dallas") or null if the point is in
 * no City-of-Dallas polygon (the layer contains only Dallas, so null = "not
 * City of Dallas").
 */
async function cityAtPoint(lng, lat) {
  // If the layer is ever flipped to verified:false this throws; the caller
  // (resolveCityJurisdiction) catches it and falls back to the string layers
  // / explicit-assumption path instead of trusting a dead ground-truth source.
  const layer = requireVerified(ARCGIS.dallasCityLimits, "city-limits ground truth");
  const rows = await cached(
    `citylimits:${lng.toFixed(4)},${lat.toFixed(4)}`,
    GEO_TTL_MS,
    () => queryPointInPolygon(layer.url, lng, lat, { outFields: layer.cityField })
  );
  const v = rows[0]?.[layer.cityField];
  return v ? String(v) : null;
}

/**
 * Enforce the "no wrong-city silent success" rule for a city-scoped tool.
 *
 * @param {{ address?: string, city?: string }} args
 * @param {string} [targetCity="dallas"]  The only city this tool covers (v0.1).
 * @returns {Promise<
 *   | { ok: true, city: string, resolvedBy: string, assumed?: boolean, note?: string }
 *   | { ok: false, message: string, detectedCity: string|null }
 * >}
 */
export async function resolveCityJurisdiction(args, targetCity = "dallas") {
  const { address, city } = args || {};
  const targetLabel = cityLabel(targetCity);

  // Layer 1: explicit city argument. Trust it as a user override.
  if (city && city !== "auto") {
    const c = String(city).toLowerCase();
    if (c !== targetCity) {
      return notCovered(cityLabel(c), targetLabel, c, "you specified");
    }
    return { ok: true, city: targetCity, resolvedBy: "city parameter" };
  }

  // Layer 2: fast string detection. A clearly different city -> block cheaply.
  const det = detectLocation(address);
  if (det.city && det.city !== targetCity) {
    return notCovered(cityLabel(det.city), targetLabel, det.city, "detected");
  }

  // Layer 3: ground truth (geocode -> PIP city limits), when an address exists.
  if (address) {
    let geo = null;
    try {
      geo = await cached(`geo:${normAddr(address)}`, GEO_TTL_MS, () => geocodeAddress(address));
    } catch (_) {
      geo = null; // geocoder blip -- fall through to assume-with-note below
    }
    if (geo && typeof geo.lng === "number" && typeof geo.lat === "number") {
      let cityName;
      try {
        cityName = await cityAtPoint(geo.lng, geo.lat);
      } catch (_) {
        cityName = undefined; // PIP failure -> don't hard-block on infra error
      }
      if (cityName) {
        if (cityName.toLowerCase().replace(/\s+/g, "") !== targetCity) {
          return notCovered(cityName, targetLabel, cityName.toLowerCase(), "geocoded");
        }
        return { ok: true, city: targetCity, resolvedBy: "geocode + city-limits" };
      }
      if (cityName === null) {
        // Confirmed OUTSIDE City of Dallas limits. Block, but give an override.
        return {
          ok: false,
          detectedCity: null,
          message:
            `Not covered: this address does not fall inside City of ${targetLabel} ` +
            `limits, which is the only jurisdiction this tool covers (v0.1). It may ` +
            `be a suburb or unincorporated area. If you believe it is a City of ` +
            `${targetLabel} address, pass city:"${targetCity}" to override.`,
        };
      }
      // cityName === undefined -> PIP errored; fall through to assume-with-note.
    }
  }

  // Fast keyword confirmed the target city (e.g. "... Dallas TX 75201").
  if (det.city === targetCity) {
    return { ok: true, city: targetCity, resolvedBy: "keyword/ZIP" };
  }

  // Undetectable (no ZIP/keyword, no usable geocode). Proceed as target city
  // but make the assumption explicit in the response.
  return {
    ok: true,
    city: targetCity,
    resolvedBy: "assumed",
    assumed: true,
    note:
      `Assuming City of ${targetLabel} — pass an address with city/ZIP or use ` +
      `the city parameter to override.`,
  };
}

/**
 * Extract the street portion of a one-line address for SODA contains-matching.
 * Upstream datasets store "1500 MARILLA ST, DALLAS, TX, 75201" (311) or bare
 * "3424 LADD ST" (crime), so matching a full "1500 Marilla St Dallas TX 75201"
 * input verbatim would return zero rows. Strips: anything after the first
 * comma, the state, a trailing ZIP, and a trailing known city name.
 */
export function streetPart(address) {
  if (!address) return "";
  let s = String(address).trim().split(",")[0];
  s = s.replace(/\b(TX|TEXAS)\b[\s.]*.*$/i, "");
  s = s.replace(/\s+\d{5}(-\d{4})?\s*$/, "");
  const cityAlt = Object.values(CITY_LABELS)
    .map((c) => c.toUpperCase().replace(/ /g, "\\s+"))
    .join("|");
  s = s.replace(new RegExp(`\\s+(${cityAlt})\\s*$`, "i"), "");
  return s.trim();
}

function notCovered(detectedLabel, targetLabel, detectedKey, how) {
  return {
    ok: false,
    detectedCity: detectedKey,
    message:
      `Not covered: ${how} ${detectedLabel}; this tool is City of ${targetLabel} ` +
      `only (v0.1). No query was run against ${targetLabel} data for a ` +
      `${detectedLabel} address (that would return misleading results).`,
  };
}

function normAddr(address) {
  return String(address).trim().toLowerCase().replace(/\s+/g, " ");
}

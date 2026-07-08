/**
 * Live smoke test for dfw_events (network). Run manually: node test/smoke-events.js
 * Exercises the keyless tier only; set DFW_TICKETMASTER_API_KEY to also smoke
 * the commercial tier.
 */
import { dfwEvents } from "../tools/events/dfw-events.js";
import { ticketmasterKey } from "../lib/ticketmaster.js";

const res = await dfwEvents.handler({ city: "all", category: "city", limit: 10 });
const json = JSON.parse(res.content[1].text);
if (!Array.isArray(json.results)) throw new Error("no results array");
if (json.count === 0) throw new Error("0 city-calendar events -- all four feeds empty is a red flag");
const bad = json.results.find((e) => !e.title || !e.source_url);
if (bad) throw new Error(`event missing title/source_url: ${JSON.stringify(bad)}`);
console.log(`OK: ${json.count} city events (of ${json.total_matched}); notes: ${json.notes.length}`);
console.log("sample:", json.results[0].start, "-", json.results[0].title, `[${json.results[0].city}]`);

if (ticketmasterKey()) {
  const tm = await dfwEvents.handler({ city: "all", category: "concert", limit: 5 });
  const tmJson = JSON.parse(tm.content[1].text);
  if (!Array.isArray(tmJson.results)) throw new Error("no results array (ticketmaster)");
  console.log(`OK: ${tmJson.count} concerts via Ticketmaster; sample:`, tmJson.results[0]?.title);
} else {
  console.log("(DFW_TICKETMASTER_API_KEY not set -- commercial tier not smoked)");
}

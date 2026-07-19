import { z } from "zod";
import { EVENTS_RSS, EVENTS_TICKETMASTER, requireVerified } from "../../lib/sources.js";
import { fetchCityCalendar } from "../../lib/civicplus-rss.js";
import { searchTicketmaster, ticketmasterKey, TM_SEGMENTS } from "../../lib/ticketmaster.js";
import { encodeCursor, decodeCursor } from "../../lib/soda.js";
import { ATTRIBUTION_TAG, withAttributionTag } from "../../lib/attribution.js";
import { refusalResult } from "../../lib/register.js";

/**
 * dfw_events -- "what's happening around here". Two source tiers merged
 * soonest-first (see plan + lib/sources.js):
 *   Tier 1 (keyless): official CivicPlus city calendars -- Dallas Parks & Rec,
 *   Garland, Frisco, Mesquite, McKinney (added v0.3). Dallas is the Parks &
 *   Rec calendar only; there is no citywide City of Dallas feed.
 *   Tier 2 (optional DFW_TICKETMASTER_API_KEY): concerts / sports / theater
 *   metro-wide via the Ticketmaster Discovery API (DMA 222).
 * Feeds are fetched in parallel and one dead feed degrades to a note instead
 * of killing the response. All pages fully cached (1h RSS / 30min TM), so
 * cursor pagination is stable within a session.
 */

const CITY_KEYS = Object.keys(EVENTS_RSS); // dallas, garland, frisco, mesquite, mckinney
const KEYLESS_HINT =
  `Commercial events (concerts, sports, theater) not included -- set ` +
  `${EVENTS_TICKETMASTER.envKey} (free key at developer.ticketmaster.com) to add them.`;

export const dfwEvents = {
  name: "dfw_events",
  tier: "core",
  description: withAttributionTag(
    "Upcoming DFW events. Official city calendars (keyless): Dallas Parks & " +
      "Rec ONLY (no citywide Dallas feed), Garland, Frisco, Mesquite, " +
      "McKinney. Plus concerts/sports/theater metro-wide via Ticketmaster " +
      "when DFW_TICKETMASTER_API_KEY is set. Filter by city, category, date " +
      "range, free text. Other cities (Plano, Arlington, Fort Worth, Irving, " +
      "...) have no calendar feed -- say so rather than guessing."
  ),
  inputSchema: {
    city: z.enum([...CITY_KEYS, "all"]).default("all")
      .describe('City calendar to search; "all" (default) merges every covered city. "dallas" = Parks & Rec calendar only.'),
    category: z.enum(["all", "city", "concert", "sports", "theater"]).default("all")
      .describe('"city" = official city calendars only; "concert"/"sports"/"theater" = Ticketmaster only (needs key); "all" (default) merges both tiers.'),
    search: z.string().min(2).optional()
      .describe('Free-text filter on title/description/venue. Example: "farmers market", "Mavericks".'),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("Only events on/after this date (YYYY-MM-DD). Defaults to today for commercial events."),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      .describe("Only events on/before this date (YYYY-MM-DD)."),
    limit: z.number().int().min(1).max(100).default(25).describe("Max results (default 25)."),
    cursor: z.string().optional().describe("Opaque pagination cursor from a previous call."),
  },
  async handler({ city, category, search, date_from, date_to, limit, cursor }) {
    const wantCity = category === "all" || category === "city";
    const wantCommercial = category === "all" || category in TM_SEGMENTS;
    const notes = [];
    let events = [];

    if (wantCity) {
      const cities = city === "all" ? CITY_KEYS : [city];
      const settled = await Promise.allSettled(
        cities.map((key) => fetchCityCalendar(key, requireVerified(EVENTS_RSS[key], `dfw_events (${key})`)))
      );
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") events.push(...s.value);
        else notes.push(`${EVENTS_RSS[cities[i]].label} calendar feed unavailable (${String(s.reason?.message ?? s.reason).slice(0, 120)}); its events are missing from this page.`);
      });
      if (cities.includes("dallas")) {
        notes.push("Dallas coverage = the Parks & Recreation calendar, NOT a citywide City of Dallas calendar (none exists).");
      }
    }

    if (wantCommercial) {
      if (!ticketmasterKey()) {
        if (category in TM_SEGMENTS) {
          return refusalResult(
            `dfw_events category "${category}" needs the Ticketmaster tier. ${KEYLESS_HINT}`,
            {
              query: { city, category, search, date_from, date_to },
              reason: "missing_api_key",
              recovery:
                "Set DFW_TICKETMASTER_API_KEY (free: developer.ticketmaster.com) to unlock " +
                'concerts/sports/theater, or retry with category:"city" for keyless city calendars.',
            }
          );
        }
        notes.push(KEYLESS_HINT);
      } else {
        try {
          const tm = await searchTicketmaster({
            keyword: search,
            segment: TM_SEGMENTS[category],
            dateFrom: date_from ?? todayISO(),
            dateTo: date_to,
          });
          events.push(...(city === "all" ? tm : tm.filter((e) => e.city === city)));
        } catch (err) {
          if (category in TM_SEGMENTS) {
            // Ticketmaster is the only source for this category -- let the
            // central wrapHandler catch format it (text + reason/recovery contract).
            throw err;
          }
          notes.push(`Ticketmaster tier unavailable (${String(err?.message ?? err).slice(0, 120)}); showing city calendars only.`);
        }
      }
    }

    events = events.filter((e) => matchesDates(e, date_from, date_to) && matchesSearch(e, search));
    events.sort((a, b) =>
      String(a.start ?? "9999") < String(b.start ?? "9999") ? -1
        : String(a.start ?? "9999") > String(b.start ?? "9999") ? 1
        : String(a.title).localeCompare(String(b.title)));

    const pageSize = limit ?? 25;
    const offset = decodeCursor(cursor)?.offset ?? 0;
    const page = events.slice(offset, offset + pageSize);
    const nextCursor = offset + pageSize < events.length ? encodeCursor(offset + pageSize) : null;

    const payload = {
      query: { city, category, search, date_from, date_to },
      count: page.length,
      total_matched: events.length,
      results: page,
      nextCursor,
      offset,
      notes,
    };

    return {
      content: [
        { type: "text", text: formatResults(payload) },
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Multi-day events match when their [start, end] range overlaps the filter. */
function matchesDates(e, from, to) {
  const start = e.start ?? null;
  const end = e.end ?? start;
  if (from && end && end < from) return false;
  if (to && start && start > to) return false;
  return true;
}

function matchesSearch(e, search) {
  if (!search) return true;
  const hay = `${e.title ?? ""} ${e.description ?? ""} ${e.location ?? ""}`.toLowerCase();
  return hay.includes(search.toLowerCase());
}

function formatResults(p) {
  const q = p.query;
  const parts = [];
  if (q.city !== "all") parts.push(q.city);
  if (q.category !== "all") parts.push(q.category);
  if (q.search) parts.push(`"${q.search}"`);
  if (q.date_from || q.date_to) parts.push(`${q.date_from ?? "…"} to ${q.date_to ?? "…"}`);

  const lines = [
    `# DFW Events${parts.length ? `: ${parts.join(", ")}` : ""} -- ${p.count} of ${p.total_matched} match${p.total_matched === 1 ? "" : "es"}`,
    "",
  ];
  for (const n of p.notes) lines.push(`> ${n}`);
  if (p.notes.length) lines.push("");

  if (p.count === 0) {
    lines.push("No events matched. Try a wider date range, a different city, or no free-text filter.", "");
  }

  for (const e of p.results) {
    const when = e.end && e.end !== e.start ? `${e.start ?? "?"} to ${e.end}` : e.start ?? "(no date)";
    lines.push(`## ${when} — ${e.title}`);
    const meta = [];
    if (e.time) meta.push(`**Time:** ${e.time}`);
    if (e.location) meta.push(`**Where:** ${e.location}`);
    if (meta.length) lines.push(`- ${meta.join("  |  ")}`);
    lines.push(`- **Source:** ${e.source} — ${e.source_url}`);
    // Upstream free text is third-party authored: keep it visibly quoted.
    if (e.description) lines.push(`> ${e.description.slice(0, 300)}${e.description.length > 300 ? "…" : ""}`);
    lines.push("");
  }

  if (p.nextCursor) {
    lines.push(`*More events available. Re-call with \`cursor: "${p.nextCursor}"\`.*`, "");
  }
  lines.push("---", "Sources: official CivicPlus city calendars (Dallas Parks & Rec, Garland, Frisco, Mesquite, McKinney)" +
    (ticketmasterKey() ? " + Ticketmaster Discovery API" : ""), ATTRIBUTION_TAG);
  return lines.join("\n");
}

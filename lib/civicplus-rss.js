/**
 * CivicPlus CMS calendar RSS client -- Tier 1 of dfw_events. New for
 * local-dfw-mcp (no Austin equivalent).
 *
 * CivicPlus city sites expose their official calendar as keyless RSS 2.0 at
 * /RSSFeed.aspx?ModID=58&CID=All-calendar.xml. Each <item> carries namespaced
 * calendarEvent:EventDates / EventTimes / Location tags alongside an
 * HTML-escaped <description> whose free text sits after a literal
 * "<strong>Description:</strong>" label. Verified live 2026-07-07 on all four
 * feeds in lib/sources.js EVENTS_RSS.
 *
 * Feeds are small (10-105 KB) and upcoming-only, so we fetch whole and parse
 * with regexes -- no XML dependency. Results are cached 1 hour per city.
 */

import { retryFetch } from "./retry.js";
import { cached } from "./cache.js";

const UA = "local-dfw-mcp (https://github.com/LizzleChen/local-dfw-mcp)";
const CACHE_TTL_MS = 3600e3;

export function calendarFeedUrl(base) {
  return `${base}/RSSFeed.aspx?ModID=58&CID=All-calendar.xml`;
}

/**
 * Fetch + parse one city's calendar feed (1h cache).
 * @returns {Promise<Array<object>>} normalized events (see normalizeItem)
 */
export async function fetchCityCalendar(cityKey, feed) {
  return cached(`events-rss:${cityKey}`, CACHE_TTL_MS, async () => {
    const url = calendarFeedUrl(feed.base);
    const res = await retryFetch(
      (signal) => fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, signal }),
      { source: feed.label, profile: "rss", url }
    );
    if (!res.ok) throw new Error(`${feed.label} calendar feed returned ${res.status} ${res.statusText}`);
    const xml = await res.text();
    return parseCalendarXml(xml, cityKey, feed);
  });
}

/** Exported for tests. */
export function parseCalendarXml(xml, cityKey, feed) {
  const events = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const ev = normalizeItem(m[1], cityKey, feed);
    if (ev) events.push(ev);
  }
  return events;
}

function normalizeItem(item, cityKey, feed) {
  const title = decodeEntities(tagText(item, "title"));
  const link = decodeEntities(tagText(item, "link"));
  if (!title && !link) return null;

  const { start, end } = parseEventDates(tagText(item, "calendarEvent:EventDates"));
  const time = collapseWs(decodeEntities(tagText(item, "calendarEvent:EventTimes"))) || null;
  const location = collapseWs(decodeEntities(tagText(item, "calendarEvent:Location"))) || null;

  return {
    title: title || "(untitled event)",
    start,
    end,
    time,
    location,
    city: cityKey,
    category: "city",
    description: extractDescription(tagText(item, "description")),
    source: `${feed.label} calendar`,
    source_url: link || calendarFeedUrl(feed.base),
  };
}

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
}

/**
 * "July 8, 2026" -> { start: "2026-07-08", end: null }
 * "June 29, 2026 - August 31, 2026" -> { start: "2026-06-29", end: "2026-08-31" }
 * Parsed with a month map (no Date.parse) so the result is timezone-proof.
 */
export function parseEventDates(s) {
  const dates = [];
  for (const m of String(s ?? "").matchAll(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/g)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) continue;
    dates.push(`${m[3]}-${month}-${String(m[2]).padStart(2, "0")}`);
  }
  return { start: dates[0] ?? null, end: dates[1] ?? null };
}

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/**
 * The <description> is HTML-escaped markup repeating the date/time/location
 * labels; the human-written text follows "<strong>Description:</strong>".
 * Decode, take the part after that label, strip tags, collapse whitespace.
 */
function extractDescription(raw) {
  if (!raw) return null;
  const html = decodeEntities(raw);
  const idx = html.search(/<strong>\s*Description:\s*<\/strong>/i);
  const slice = idx >= 0 ? html.slice(idx).replace(/^<strong>\s*Description:\s*<\/strong>/i, "") : html;
  const text = collapseWs(slice.replace(/<[^>]+>/g, " "));
  return text || null;
}

function collapseWs(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

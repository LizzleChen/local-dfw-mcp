/**
 * Ticketmaster Discovery API client -- Tier 2 (commercial events) of
 * dfw_events. New for local-dfw-mcp (no Austin equivalent).
 *
 * Keyed but optional: set DFW_TICKETMASTER_API_KEY (free at
 * developer.ticketmaster.com, 5000 calls/day / 5 rps) to include concerts,
 * sports, and theater; without it dfw_events serves city calendars only.
 * Queries are scoped to DMA 222 (Dallas-Fort Worth) and sorted soonest-first.
 * Responses are cached 30 minutes per filter combination.
 */

import { retryFetch, UpstreamError } from "./retry.js";
import { cached } from "./cache.js";
import { EVENTS_TICKETMASTER } from "./sources.js";

const CACHE_TTL_MS = 30 * 60e3;
const PAGE_SIZE = 100; // one page is plenty for a local-guide answer

export function ticketmasterKey() {
  return process.env[EVENTS_TICKETMASTER.envKey] || null;
}

/** Tool `category` values -> Discovery API segment names. */
export const TM_SEGMENTS = {
  concert: "Music",
  sports: "Sports",
  theater: "Arts & Theatre",
};

/**
 * Search DFW commercial events. Caller must have checked ticketmasterKey().
 * @param {object} q
 * @param {string} [q.keyword]
 * @param {string} [q.segment]     Discovery segment name (see TM_SEGMENTS)
 * @param {string} [q.dateFrom]    YYYY-MM-DD (inclusive)
 * @param {string} [q.dateTo]      YYYY-MM-DD (inclusive)
 * @returns {Promise<Array<object>>} normalized events
 */
export async function searchTicketmaster(q = {}) {
  const key = ticketmasterKey();
  if (!key) throw new Error(`Ticketmaster key missing -- set ${EVENTS_TICKETMASTER.envKey}`);

  const params = new URLSearchParams({
    apikey: key,
    dmaId: EVENTS_TICKETMASTER.dmaId,
    sort: "date,asc",
    size: String(PAGE_SIZE),
  });
  if (q.keyword) params.set("keyword", q.keyword);
  if (q.segment) params.set("classificationName", q.segment);
  // Discovery requires Zulu timestamps without milliseconds.
  if (q.dateFrom) params.set("startDateTime", `${q.dateFrom}T00:00:00Z`);
  if (q.dateTo) params.set("endDateTime", `${q.dateTo}T23:59:59Z`);

  const url = `${EVENTS_TICKETMASTER.base}/events.json?${params}`;
  const cacheKey = `events-tm:${q.keyword ?? ""}|${q.segment ?? ""}|${q.dateFrom ?? ""}|${q.dateTo ?? ""}`;

  return cached(cacheKey, CACHE_TTL_MS, async () => {
    const res = await retryFetch(
      (signal) => fetch(url, { signal }),
      { source: "Ticketmaster Discovery API", profile: "fast", url: url.replace(key, "***") }
    );
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError(`Ticketmaster rejected the API key (${res.status})`, {
        source: "Ticketmaster Discovery API",
        kind: "bad_request",
        status: res.status,
        attempts: 1,
        lastErrorMessage: `check ${EVENTS_TICKETMASTER.envKey}`,
      });
    }
    if (!res.ok) throw new Error(`Ticketmaster Discovery API returned ${res.status} ${res.statusText}`);
    const data = await res.json();
    const events = data?._embedded?.events;
    return Array.isArray(events) ? events.map(normalize) : [];
  });
}

function normalize(e) {
  const venue = e?._embedded?.venues?.[0] ?? {};
  const cls = e?.classifications?.[0] ?? {};
  const segment = cls?.segment?.name ?? null;
  const genre = cls?.genre?.name ?? null;
  const price = Array.isArray(e?.priceRanges) && e.priceRanges[0]
    ? priceLabel(e.priceRanges[0])
    : null;
  const venueName = venue?.name ?? null;
  const venueCity = venue?.city?.name ?? null;

  return {
    title: e?.name ?? "(untitled event)",
    start: e?.dates?.start?.localDate ?? null,
    end: null,
    time: e?.dates?.start?.localTime ? e.dates.start.localTime.slice(0, 5) : null,
    location: [venueName, venueCity].filter(Boolean).join(", ") || null,
    city: venueCity ? venueCity.toLowerCase().replace(/\s+/g, "") : null,
    category: CATEGORY_BY_SEGMENT[segment] ?? "commercial",
    description: [[segment, genre].filter(Boolean).join(" / "), price].filter(Boolean).join(" -- ") || null,
    source: "Ticketmaster Discovery API",
    source_url: e?.url ?? "https://www.ticketmaster.com",
  };
}

const CATEGORY_BY_SEGMENT = {
  Music: "concert",
  Sports: "sports",
  "Arts & Theatre": "theater",
};

function priceLabel(p) {
  if (p?.min == null && p?.max == null) return null;
  const cur = p.currency === "USD" || !p.currency ? "$" : `${p.currency} `;
  if (p.min != null && p.max != null && p.min !== p.max) return `${cur}${p.min}-${cur}${p.max}`;
  return `${cur}${p.min ?? p.max}`;
}

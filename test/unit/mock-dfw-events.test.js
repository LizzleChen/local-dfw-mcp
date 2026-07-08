/**
 * Offline handler tests for dfw_events using undici's MockAgent: CivicPlus RSS
 * parsing, tier merging, keyless behavior, per-feed degradation, and the
 * verified:false guard. No network.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { dfwEvents } from "../../tools/events/dfw-events.js";
import { parseEventDates, decodeEntities, parseCalendarXml } from "../../lib/civicplus-rss.js";
import { EVENTS_RSS } from "../../lib/sources.js";

let mockAgent;
let prevDispatcher;

before(() => {
  process.env.DFW_CACHE_DISABLED = "1";
  delete process.env.DFW_TICKETMASTER_API_KEY;
  prevDispatcher = getGlobalDispatcher();
});

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

after(async () => {
  await mockAgent.close();
  setGlobalDispatcher(prevDispatcher);
  delete process.env.DFW_CACHE_DISABLED;
});

const GARLAND_XML = `<?xml version="1.0"?><rss version="2.0" xmlns:calendarEvent="https://www.garlandtx.gov/Calendar.aspx"><channel>
<title>Garland, TX - Calendar</title>
<item>
  <title>Baby Bounce &amp; Read at the North Garland Library</title>
  <link>https://www.garlandtx.gov/Calendar.aspx?EID=12663</link>
  <description>&lt;strong&gt;Event date:&lt;/strong&gt; July 8, 2026 &lt;br&gt;&lt;strong&gt;Description:&lt;/strong&gt;&lt;br&gt;A lap-sit storytime for babies &#243;.</description>
  <calendarEvent:EventDates> July 8, 2026 </calendarEvent:EventDates>
  <calendarEvent:EventTimes>10:00 AM - 11:00 AM</calendarEvent:EventTimes>
  <calendarEvent:Location>3845 N. Garland Ave.Garland, TX 75040</calendarEvent:Location>
</item>
<item>
  <title>Summer Reading Program</title>
  <link>https://www.garlandtx.gov/Calendar.aspx?EID=99999</link>
  <description>&lt;strong&gt;Description:&lt;/strong&gt;&lt;br&gt;All summer long.</description>
  <calendarEvent:EventDates>June 29, 2026 - August 31, 2026</calendarEvent:EventDates>
</item>
</channel></rss>`;

const EMPTY_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>`;

function mockFeed(origin, body, status = 200) {
  mockAgent
    .get(origin)
    .intercept({ path: (p) => p.startsWith("/RSSFeed.aspx"), method: "GET" })
    .reply(status, body, { headers: { "content-type": "text/xml" } })
    .persist();
}

test("parseEventDates handles single dates and ranges, timezone-proof", () => {
  assert.deepEqual(parseEventDates(" July 8, 2026 "), { start: "2026-07-08", end: null });
  assert.deepEqual(parseEventDates("June 29, 2026 - August 31, 2026"), { start: "2026-06-29", end: "2026-08-31" });
  assert.deepEqual(parseEventDates(""), { start: null, end: null });
});

test("decodeEntities handles named, decimal, and hex entities", () => {
  assert.equal(decodeEntities("Bounce &amp; Read &#243; &#xE9;"), "Bounce & Read ó é");
});

test("parseCalendarXml normalizes items", () => {
  const events = parseCalendarXml(GARLAND_XML, "garland", EVENTS_RSS.garland);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Baby Bounce & Read at the North Garland Library");
  assert.equal(events[0].start, "2026-07-08");
  assert.equal(events[0].time, "10:00 AM - 11:00 AM");
  assert.equal(events[0].location, "3845 N. Garland Ave.Garland, TX 75040");
  assert.equal(events[0].description, "A lap-sit storytime for babies ó.");
  assert.equal(events[0].source_url, "https://www.garlandtx.gov/Calendar.aspx?EID=12663");
  assert.equal(events[1].end, "2026-08-31");
});

test("dfw_events: single-city query returns the search envelope, soonest first", async () => {
  mockFeed("https://www.garlandtx.gov", GARLAND_XML);
  const res = await dfwEvents.handler({ city: "garland", category: "all", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 2);
  assert.equal(payload.results[0].start, "2026-06-29"); // range starts earlier
  assert.equal(payload.results[1].city, "garland");
  assert.match(res.content[0].text, /DFW Events/);
  // category "all" keyless: commercial tier degrades to a hint, not an error
  assert.ok(payload.notes.some((n) => n.includes("DFW_TICKETMASTER_API_KEY")));
});

test("dfw_events: date-range filter uses overlap, not start date", async () => {
  mockFeed("https://www.garlandtx.gov", GARLAND_XML);
  const res = await dfwEvents.handler({
    city: "garland", category: "city", date_from: "2026-08-01", date_to: "2026-08-15", limit: 25,
  });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 1); // multi-day program overlaps; July 8 event does not
  assert.equal(payload.results[0].title, "Summer Reading Program");
});

test("dfw_events: keyless commercial-only category refuses with a hint (no network)", async () => {
  const res = await dfwEvents.handler({ city: "all", category: "concert", limit: 25 });
  assert.equal(res.structuredContent.not_covered, true);
  assert.match(res.content[0].text, /DFW_TICKETMASTER_API_KEY/);
});

test("dfw_events: one dead feed degrades to a note, others still answer", async () => {
  mockFeed("https://www.garlandtx.gov", GARLAND_XML);
  mockFeed("https://www.dallasparks.org", EMPTY_XML);
  mockFeed("https://www.friscotexas.gov", EMPTY_XML);
  mockFeed("https://www.cityofmesquite.com", "nope", 500);
  const res = await dfwEvents.handler({ city: "all", category: "city", limit: 25 });
  const payload = JSON.parse(res.content[1].text);
  assert.equal(payload.count, 2);
  assert.ok(payload.notes.some((n) => n.includes("City of Mesquite")));
});

test("dfw_events: Ticketmaster tier merges when the key is set", async () => {
  process.env.DFW_TICKETMASTER_API_KEY = "test-key";
  try {
    mockFeed("https://www.garlandtx.gov", GARLAND_XML);
    mockFeed("https://www.dallasparks.org", EMPTY_XML);
    mockFeed("https://www.friscotexas.gov", EMPTY_XML);
    mockFeed("https://www.cityofmesquite.com", EMPTY_XML);
    mockAgent
      .get("https://app.ticketmaster.com")
      .intercept({ path: (p) => p.startsWith("/discovery/v2/events.json"), method: "GET" })
      .reply(200, {
        _embedded: {
          events: [{
            name: "Dallas Mavericks vs. Spurs",
            url: "https://www.ticketmaster.com/event/abc",
            dates: { start: { localDate: "2026-07-09", localTime: "19:30:00" } },
            classifications: [{ segment: { name: "Sports" }, genre: { name: "Basketball" } }],
            priceRanges: [{ min: 25, max: 300, currency: "USD" }],
            _embedded: { venues: [{ name: "American Airlines Center", city: { name: "Dallas" } }] },
          }],
        },
      }, { headers: { "content-type": "application/json" } })
      .persist();

    const res = await dfwEvents.handler({ city: "all", category: "all", limit: 25 });
    const payload = JSON.parse(res.content[1].text);
    const tm = payload.results.find((e) => e.source === "Ticketmaster Discovery API");
    assert.ok(tm, "Ticketmaster event merged");
    assert.equal(tm.category, "sports");
    assert.equal(tm.time, "19:30");
    assert.equal(tm.location, "American Airlines Center, Dallas");
    assert.match(tm.description, /Sports \/ Basketball -- \$25-\$300/);
    assert.ok(!payload.notes.some((n) => n.includes("DFW_TICKETMASTER_API_KEY")));
  } finally {
    delete process.env.DFW_TICKETMASTER_API_KEY;
  }
});

test("dfw_events: flipping a feed to verified:false disables it", async () => {
  EVENTS_RSS.garland.verified = false;
  try {
    await assert.rejects(
      dfwEvents.handler({ city: "garland", category: "city", limit: 25 }),
      /not verified/
    );
  } finally {
    EVENTS_RSS.garland.verified = true;
  }
});

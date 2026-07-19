/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: dropped the "tcad"/"scraper" profile comments that
 * referenced Austin-only clients; profiles themselves unchanged. Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Unified retry + upstream-error helpers for every tool. Each upstream (Socrata,
 * ArcGIS, Census, NWS, FEMA) gets a named retry profile; retryFetch retries only
 * transient failures (5xx, 429, network/timeout) with jittered backoff and throws
 * an UpstreamError with a structured payload on final failure. upstreamErrorText
 * turns that into LLM-friendly text (who failed, that the MCP is fine, what to do).
 */

import { currentSignal, linkAbort } from "./request-context.js";

export const PROFILES = {
  fast:    { retries: 1, delays: [500],         timeoutMs: 12000 },
  soda:    { retries: 1, delays: [800],         timeoutMs: 25000 },
  arcgis:  { retries: 2, delays: [600, 1500],   timeoutMs: 25000 },
  rss:     { retries: 0, delays: [],            timeoutMs: 12000 },
  scraper: { retries: 0, delays: [],            timeoutMs: 30000 },
};

/**
 * An error thrown by retryFetch when an upstream call fails after retries.
 * Always carries a structured `.upstream` payload.
 */
export class UpstreamError extends Error {
  constructor(message, { source, kind, status, attempts, lastErrorMessage, url }) {
    super(message);
    this.name = "UpstreamError";
    this.upstream = {
      source,
      kind,
      status,
      attempts,
      last_error_message: lastErrorMessage,
      url,
    };
  }
}

function classifyError(err, res) {
  if (res) {
    if (res.status === 429) return "rate_limited";
    if (res.status >= 500) return "server_error";
    if (res.status === 404) return "not_found";
    if (res.status >= 400) return "bad_request";
  }
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  if (msg.includes("abort") || msg.includes("timeout")) return "timeout";
  if (msg.includes("enotfound") || msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("fetch failed")) return "network";
  return "unknown";
}

function isTransient(kind) {
  return kind === "server_error" || kind === "timeout" || kind === "network" || kind === "rate_limited";
}

function jitter(baseMs) {
  return new Promise((r) => setTimeout(r, Math.round(baseMs * (0.5 + Math.random()))));
}

/**
 * @param {(signal: AbortSignal) => Promise<Response>} fetchFn
 * @param {object} opts
 * @param {string} opts.source
 * @param {'fast'|'soda'|'arcgis'|'rss'|'scraper'} [opts.profile]
 * @param {{retries:number, delays:number[], timeoutMs?:number}} [opts.custom]
 * @param {string} [opts.url]
 * @returns {Promise<Response>}
 */
export async function retryFetch(fetchFn, opts) {
  const { source = "upstream", profile = "fast", custom, url } = opts || {};
  const policy = custom || PROFILES[profile] || PROFILES.fast;
  const totalAttempts = policy.retries + 1;
  const timeoutMs = policy.timeoutMs ?? 15000;
  let lastErr = null;
  let lastRes = null;
  let lastKind = "unknown";

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    let res = null;
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    const unlink = linkAbort(ac, currentSignal());
    try {
      res = await (fetchFn.length >= 1 ? fetchFn(ac.signal) : fetchFn());
    } catch (err) {
      clearTimeout(tid);
      unlink();
      lastErr = err;
      const kind = classifyError(err, null);
      lastKind = kind;
      if (attempt < totalAttempts - 1 && isTransient(kind)) {
        await jitter(policy.delays[attempt] ?? policy.delays.at(-1) ?? 500);
        continue;
      }
      throw new UpstreamError(
        `${source} call failed: ${kind} (${err?.message || err})`,
        { source, kind, status: null, attempts: attempt + 1, lastErrorMessage: String(err?.message || err).slice(0, 200), url }
      );
    }

    clearTimeout(tid);
    unlink();
    if (res.ok) return res;

    lastRes = res;
    const kind = classifyError(null, res);
    lastKind = kind;

    if (!isTransient(kind)) return res;

    if (attempt < totalAttempts - 1) {
      await jitter(policy.delays[attempt] ?? policy.delays.at(-1) ?? 500);
      continue;
    }

    throw new UpstreamError(
      `${source} returned ${res.status} ${res.statusText} after ${totalAttempts} attempt(s)`,
      { source, kind, status: res.status, attempts: totalAttempts, lastErrorMessage: `${res.status} ${res.statusText}`, url }
    );
  }

  throw new UpstreamError(
    `${source} call failed after ${totalAttempts} attempt(s)`,
    { source, kind: lastKind, status: lastRes?.status ?? null, attempts: totalAttempts, lastErrorMessage: lastErr?.message ?? "unknown", url }
  );
}

/**
 * Per-kind actionable recovery advice, keyed by UpstreamError kind. Exported so
 * register.js can put the same sentence into structuredContent.recovery (the
 * machine-readable error contract) that upstreamErrorText renders for humans.
 */
export const UPSTREAM_RECOVERY = Object.freeze({
  server_error: "Try again in 30-60 seconds — this is a transient outage on their side, not a problem with this MCP.",
  timeout: "Try again in 30 seconds. The data provider's server is slow but usually recovers within a minute.",
  rate_limited: "Wait 60 seconds before retrying. We hit a rate cap on the upstream. Setting DFW_SODA_APP_TOKEN raises the Socrata ceiling.",
  network: "Likely a DNS or connectivity blip. Retry in 10-30 seconds.",
  not_found: "The query didn't match any records. Double-check spelling / address / ID and try a different query.",
  bad_request: "The query parameters were rejected. Adjust filters and try again.",
  unknown: "Try again. If it persists, the data provider may be having an incident.",
});

/**
 * Convert an UpstreamError (or any error) into LLM-friendly text.
 */
export function upstreamErrorText(err, { toolName = "tool", alternateTools = [] } = {}) {
  const u = err?.upstream;
  if (!u) {
    return [
      `# ${toolName}: unexpected error`,
      "",
      `The MCP itself appears healthy, but ${toolName} threw an unexpected error: \`${String(err?.message || err).slice(0, 200)}\`.`,
      "",
      "**What to do:** retry once. If it keeps failing, the issue is likely with the upstream data source. Try again in a minute.",
    ].join("\n");
  }

  const labels = {
    server_error: `${u.source}'s server returned a ${u.status || "5xx"} error`,
    timeout: `${u.source} timed out`,
    rate_limited: `${u.source} rate-limited this request`,
    network: `Could not reach ${u.source} (network / DNS issue)`,
    not_found: `${u.source} returned 404 for that query`,
    bad_request: `${u.source} rejected the query (${u.status || "4xx"})`,
    unknown: `${u.source} returned an unexpected error`,
  };
  const what = labels[u.kind] || labels.unknown;

  const whatToDo = UPSTREAM_RECOVERY[u.kind] || UPSTREAM_RECOVERY.unknown;

  const lines = [
    `# ${toolName}: ${what}`,
    "",
    `**The MCP is working correctly.** This error is on the upstream data source's side.`,
    "",
    `**Details**`,
    `- Source: ${u.source}`,
    `- Kind: ${u.kind}${u.status ? ` (HTTP ${u.status})` : ""}`,
    `- Attempts made: ${u.attempts}`,
    u.last_error_message ? `- Last error: \`${u.last_error_message}\`` : null,
    "",
    `**What to do**`,
    whatToDo,
  ].filter(Boolean);

  if (alternateTools.length) {
    lines.push("");
    lines.push(`**Alternate tools that may answer the same question:** ${alternateTools.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: env override prefix AUSTIN_LIMIT_* -> DFW_LIMIT_*;
 * dropped Austin-only buckets (travis_tax, vow_public). Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Named semaphores -- per-upstream-source concurrency caps. Override via
 * DFW_LIMIT_SODA=8, DFW_LIMIT_ARCGIS=6, etc.
 */

const DEFAULTS = {
  soda:   4,
  arcgis: 4,
  fema:   2,
  census: 2,
  nws:    4,
  rss:    8,
};

const BUCKETS = new Map();

function getBucket(key) {
  let b = BUCKETS.get(key);
  if (!b) {
    const envCap = Number(process.env[`DFW_LIMIT_${key.toUpperCase()}`]);
    const max = Number.isFinite(envCap) && envCap > 0 ? envCap : (DEFAULTS[key] ?? 4);
    b = { max, inflight: 0, queue: [] };
    BUCKETS.set(key, b);
  }
  return b;
}

function acquire(b) {
  if (b.inflight < b.max) {
    b.inflight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    b.queue.push(() => {
      b.inflight++;
      resolve();
    });
  });
}

function release(b) {
  b.inflight = Math.max(0, b.inflight - 1);
  const next = b.queue.shift();
  if (next) next();
}

/**
 * Run `fn` while holding a slot in the named bucket. Slot always released.
 */
export async function withLimit(key, fn) {
  const b = getBucket(key);
  await acquire(b);
  try {
    return await fn();
  } finally {
    release(b);
  }
}

export function getSnapshot() {
  const out = {};
  for (const [k, b] of BUCKETS) out[k] = { max: b.max, inflight: b.inflight, queued: b.queue.length };
  return out;
}

/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: disable env var AUSTIN_CACHE_DISABLED -> DFW_CACHE_DISABLED.
 * Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Small LRU + TTL cache for static-ish lookups (geocodes, boundary PIPs, flood
 * polygons). Concurrent callers share the in-flight promise. Disable in tests
 * via DFW_CACHE_DISABLED=1.
 */

const MAX_ENTRIES = 512;
const store = new Map();

function disabled() {
  return process.env.DFW_CACHE_DISABLED === "1";
}

function bump(key, entry) {
  store.delete(key);
  store.set(key, entry);
}

function evictIfNeeded() {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function cached(key, ttlMs, loader) {
  if (disabled()) return loader();

  const now = Date.now();
  const hit = store.get(key);
  if (hit) {
    if (hit.value !== undefined && hit.expiresAt > now) {
      bump(key, hit);
      return hit.value;
    }
    if (hit.promise) {
      return hit.promise;
    }
  }

  const promise = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      evictIfNeeded();
      return value;
    } catch (err) {
      store.delete(key);
      throw err;
    }
  })();
  store.set(key, { promise, expiresAt: Date.now() + ttlMs });
  return promise;
}

export function invalidate(key) {
  store.delete(key);
}

export function clearAll() {
  store.clear();
}

export function snapshot() {
  return { size: store.size, max: MAX_ENTRIES };
}

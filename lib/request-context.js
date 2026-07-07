/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: none (module is data-source agnostic).
 * See LICENSE and NOTICE in the repository root.
 *
 * Per-request context propagated via AsyncLocalStorage so downstream fetch
 * clients can honor the MCP-provided AbortSignal without threading a `signal`
 * argument through every helper.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const ALS = new AsyncLocalStorage();

export function runWithContext(ctx, fn) {
  return ALS.run(ctx || {}, fn);
}

export function currentSignal() {
  return ALS.getStore()?.signal;
}

export function currentRequestId() {
  return ALS.getStore()?.requestId;
}

/**
 * Wire an external AbortSignal into a local AbortController so either source
 * can cancel the fetch. Returns a cleanup function -- always call it.
 */
export function linkAbort(controller, externalSignal) {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
    return () => {};
  }
  const onAbort = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", onAbort, { once: true });
  return () => externalSignal.removeEventListener("abort", onAbort);
}

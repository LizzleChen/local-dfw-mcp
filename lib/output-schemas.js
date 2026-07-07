/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: none. Verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Shared Zod output schemas for MCP `outputSchema`. Forgiving (`.passthrough()`
 * on item shapes) so a real upstream payload is never rejected.
 */

import { z } from "zod";

export function searchShape(itemSchema = z.record(z.string(), z.any())) {
  return {
    query: z.any().optional().describe("Echo of the input filters."),
    count: z.number().int().describe("Number of results in this page."),
    results: z.array(itemSchema).describe("Result rows."),
    nextCursor: z
      .string()
      .nullable()
      .optional()
      .describe("Opaque pagination cursor for the next page; null if no more results."),
    offset: z.number().int().optional().describe("Current page offset for pagination."),
  };
}

export function healthShape() {
  return {
    summary: z.object({
      ok: z.number().int(),
      degraded: z.number().int(),
      down: z.number().int(),
      checked_at: z.string(),
    }),
    checks: z.array(
      z.object({
        source: z.string(),
        status: z.enum(["ok", "degraded", "down"]),
        http: z.number().int().nullable(),
        latency_ms: z.number().int(),
        last_error: z.string().nullable(),
      })
    ),
  };
}

/**
 * Sentinel: intentionally open structuredContent -- skip publishing a schema.
 */
export function openObjectShape() {
  return null;
}

/**
 * Sentinel: markdown-only tool, no structuredContent expected.
 */
export function infoOnlyShape() {
  return null;
}

/**
 * Adapted from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: project name, tag, homepage, and license URL
 * changed to this project. Structure and the withAttributionTag() identity
 * helper are unchanged.
 * See LICENSE and NOTICE in the repository root.
 *
 * Attribution constants surfaced in this MCP's user-facing output.
 */

export const ATTRIBUTION_TEXT =
  "local-dfw-mcp -- open civic/property data for the Dallas-Fort Worth metroplex. " +
  "Inspired by local-austin-mcp (Apache-2.0).";

export const ATTRIBUTION_TAG = "(via local-dfw-mcp)";

export const PROJECT_NAME = "Local DFW MCP";

export const HOMEPAGE = "https://github.com/LizzleChen/local-dfw-mcp";

export const LICENSE_URL =
  "https://github.com/LizzleChen/local-dfw-mcp/blob/main/LICENSE";

/**
 * Kept as an identity function (attribution now lives in server instructions,
 * the `about` tool, and every response footer -- not in each description, to
 * save tools/list token cost). Please keep the body-level attribution visible
 * in user-facing output per the NOTICE file.
 */
export function withAttributionTag(description) {
  return description;
}

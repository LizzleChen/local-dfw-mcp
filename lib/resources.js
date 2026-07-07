/**
 * Adapted from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: URI scheme austin:// -> dfw://; resource list
 * reduced to the two v0.1 docs (coverage, datasets-index). Loader unchanged.
 * See LICENSE and NOTICE in the repository root.
 *
 * MCP Resources -- read-only knowledge artifacts (coverage map, dataset catalog).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = resolve(__dirname, "..", "resources");

const RESOURCES = [
  {
    uri: "dfw://datasets/index",
    name: "Dataset catalog",
    title: "Local DFW MCP — Dataset Catalog",
    description:
      "Every upstream provider this MCP talks to, with dataset IDs / layer " +
      "URLs, coverage notes, freshness, and deferred datasets with reasons.",
    mimeType: "text/markdown",
    file: "datasets-index.md",
  },
  {
    uri: "dfw://coverage/map",
    name: "Geographic coverage",
    title: "Local DFW MCP — Geographic Coverage",
    description:
      "Which cities / counties each tool covers. City-scoped tools are City " +
      "of Dallas only in v0.1; county/statewide tools cover the 4 core counties.",
    mimeType: "text/markdown",
    file: "coverage.md",
  },
];

function readResourceFile(file) {
  return readFileSync(resolve(RESOURCES_DIR, file), "utf-8");
}

export function registerResources(server) {
  for (const r of RESOURCES) {
    server.registerResource(
      r.name,
      r.uri,
      {
        title: r.title,
        description: r.description,
        mimeType: r.mimeType,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href || r.uri,
            mimeType: r.mimeType,
            text: readResourceFile(r.file),
          },
        ],
      })
    );
  }
}

export { RESOURCES };

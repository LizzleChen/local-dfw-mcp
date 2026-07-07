/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: tier env var LOCAL_AUSTIN_MCP_TIER -> LOCAL_DFW_MCP_TIER
 * (via tiers.js); attribution import path unchanged. Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Central tool registration helper. Applies every cross-cutting concern to each
 * tool: default read-only annotations, error frames, structuredContent promotion,
 * tier gating, optional outputSchema, optional name remap.
 */

import { ZodError } from "zod";
import { upstreamErrorText } from "./retry.js";
import { CORE_TOOL_NAMES, tierFromEnv } from "./tiers.js";
import { runWithContext } from "./request-context.js";
import { log } from "./logger.js";
import { ATTRIBUTION_TAG } from "./attribution.js";

const DEFAULT_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});

export function wrapHandler(tool, name) {
  return async (input, ctx) => {
    const requestCtx = {
      signal: ctx?.signal,
      requestId: ctx?.requestId,
      sessionId: ctx?.sessionId,
      sendNotification: ctx?.sendNotification,
    };
    return runWithContext(requestCtx, async () => {
      try {
        const raw = await tool.handler(input, ctx);
        return normalizeResult(raw);
      } catch (err) {
        if (err instanceof ZodError) {
          const issues = err.issues
            .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
          const text =
            `# ${name}: input validation failed\n\nThe arguments you passed did not match the tool's input schema.\n\n${issues}\n\nFix the arguments and call again.\n\n${ATTRIBUTION_TAG}`;
          log.warn(`tool ${name} validation failed`, err.issues);
          return {
            content: [{ type: "text", text }],
            isError: true,
            structuredContent: { error: "validation_failed", issues: err.issues },
          };
        }
        log.warn(`tool ${name} failed`, err?.upstream?.kind || err?.message || err);
        const text = `${upstreamErrorText(err, { toolName: name })}\n\n${ATTRIBUTION_TAG}`;
        return {
          content: [{ type: "text", text }],
          isError: true,
        };
      }
    });
  };
}

export function normalizeResult(result) {
  if (!result || !Array.isArray(result.content)) return result;
  if (result.structuredContent !== undefined) return result;

  if (
    result.content.length === 2 &&
    result.content[0]?.type === "text" &&
    result.content[1]?.type === "text" &&
    typeof result.content[1].text === "string"
  ) {
    const maybeJson = result.content[1].text.trim();
    if (maybeJson.startsWith("{") || maybeJson.startsWith("[")) {
      try {
        const parsed = JSON.parse(maybeJson);
        return {
          ...result,
          content: [result.content[0]],
          structuredContent: parsed,
        };
      } catch (_) {
        /* not JSON after all */
      }
    }
  }
  return result;
}

export function shouldRegister(publicName) {
  const tier = tierFromEnv();
  if (tier !== "core") return true;
  return CORE_TOOL_NAMES.has(publicName);
}

export function registerTool(server, tool, { rename } = {}) {
  const publicName = rename || tool.name;
  if (!shouldRegister(publicName)) return false;

  const options = {
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      ...DEFAULT_ANNOTATIONS,
      title: tool.annotations?.title || humanizeName(publicName),
      ...(tool.annotations || {}),
    },
  };

  if (tool.outputSchema) {
    options.outputSchema = tool.outputSchema;
  }

  server.registerTool(publicName, options, wrapHandler(tool, publicName));
  return true;
}

function humanizeName(name) {
  return name
    .split("_")
    .map((s) => (s.length <= 3 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)))
    .join(" ");
}

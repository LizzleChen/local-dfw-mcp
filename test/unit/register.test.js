import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResult,
  wrapHandler,
  refusalResult,
  errorResult,
  noMatchResult,
} from "../../lib/register.js";

test("normalizeResult: promotes 2nd JSON text block to structuredContent", () => {
  const input = {
    content: [
      { type: "text", text: "# Human" },
      { type: "text", text: JSON.stringify({ a: 1, b: [2, 3] }) },
    ],
  };
  const out = normalizeResult(input);
  assert.equal(out.content.length, 1);
  assert.equal(out.content[0].text, "# Human");
  assert.deepEqual(out.structuredContent, { a: 1, b: [2, 3] });
});

test("normalizeResult: leaves single-block content alone", () => {
  const input = { content: [{ type: "text", text: "hello" }] };
  const out = normalizeResult(input);
  assert.equal(out.content.length, 1);
  assert.equal(out.structuredContent, undefined);
});

test("normalizeResult: leaves non-JSON 2nd block alone", () => {
  const input = {
    content: [
      { type: "text", text: "human" },
      { type: "text", text: "plain text trailing notes" },
    ],
  };
  const out = normalizeResult(input);
  assert.equal(out.content.length, 2);
  assert.equal(out.structuredContent, undefined);
});

test("normalizeResult: respects pre-set structuredContent", () => {
  const input = {
    content: [{ type: "text", text: "x" }, { type: "text", text: "{\"y\":1}" }],
    structuredContent: { y: 99 },
  };
  const out = normalizeResult(input);
  assert.deepEqual(out.structuredContent, { y: 99 });
  assert.equal(out.content.length, 2); // untouched
});

test("wrapHandler: catches ZodError with validation_failed branch", async () => {
  const { z, ZodError } = await import("zod");
  const tool = {
    name: "z",
    async handler() {
      // Simulate validation throw
      throw new ZodError([
        { code: "too_small", path: ["limit"], message: "Number must be >= 1" },
      ]);
    },
  };
  const handler = wrapHandler(tool, "z");
  const result = await handler({}, {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /input validation failed/);
  assert.match(result.content[0].text, /limit: Number must be >= 1/);
  assert.equal(result.structuredContent.error, "validation_failed");
  // Error contract: machine-readable reason + actionable recovery.
  assert.equal(result.structuredContent.reason, "validation_failed");
  assert.ok(result.structuredContent.recovery.length >= 20);
});

test("wrapHandler: catches thrown error and returns isError frame", async () => {
  const tool = {
    name: "boom",
    async handler() {
      throw new Error("kaboom");
    },
  };
  const handler = wrapHandler(tool, "boom");
  const result = await handler({}, {});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /boom/);
  assert.equal(result.structuredContent.reason, "unexpected_error");
  assert.ok(result.structuredContent.recovery.length >= 20);
});

test("wrapHandler: UpstreamError carries upstream_<kind> reason + per-kind recovery", async () => {
  const { UpstreamError, UPSTREAM_RECOVERY } = await import("../../lib/retry.js");
  const tool = {
    name: "up",
    async handler() {
      throw new UpstreamError("Socrata returned 503", {
        source: "Dallas Open Data (Socrata)",
        kind: "server_error",
        status: 503,
        attempts: 2,
        lastErrorMessage: "503 Service Unavailable",
        url: "https://example.test",
      });
    },
  };
  const handler = wrapHandler(tool, "up");
  const result = await handler({}, {});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.reason, "upstream_server_error");
  assert.equal(result.structuredContent.recovery, UPSTREAM_RECOVERY.server_error);
  assert.equal(result.structuredContent.source, "Dallas Open Data (Socrata)");
  assert.equal(result.structuredContent.status, 503);
});

test("refusalResult: reason + recovery + legacy not_covered shape", () => {
  const r = refusalResult("Not covered: dfw_311 is City of Dallas only.", {
    query: { address: "Plano" },
    recovery: "Say the address is outside coverage; there is no suburb 311 source wired.",
  });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.reason, "not_covered");
  assert.equal(r.structuredContent.not_covered, true);
  assert.equal(r.structuredContent.count, 0);
  assert.deepEqual(r.structuredContent.results, []);
  assert.deepEqual(r.structuredContent.query, { address: "Plano" });
  assert.ok(r.structuredContent.recovery.length >= 20);
  assert.match(r.content[0].text, /Not covered/);
});

test("errorResult: isError with reason + recovery rendered into text", () => {
  const r = errorResult("Could not geocode that address.", {
    reason: "geocode_failed",
    recovery: "Check spelling; include city and ZIP.",
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.reason, "geocode_failed");
  assert.match(r.content[0].text, /What to do:/);
  assert.match(r.content[0].text, /include city and ZIP/);
});

test("noMatchResult: soft count:0 with reason + recovery, not isError", () => {
  const r = noMatchResult("No parcel found at that point.", {
    query: { address: "x" },
    recovery: "Verified coverage is the 4 core counties; try a full street address.",
  });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.reason, "no_match");
  assert.equal(r.structuredContent.count, 0);
  assert.ok(r.structuredContent.recovery.length >= 20);
});

test("wrapHandler: passes through happy result + normalizes", async () => {
  const tool = {
    name: "fine",
    async handler() {
      return {
        content: [
          { type: "text", text: "ok" },
          { type: "text", text: JSON.stringify({ v: 1 }) },
        ],
      };
    },
  };
  const handler = wrapHandler(tool, "fine");
  const result = await handler({}, {});
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.structuredContent, { v: 1 });
});

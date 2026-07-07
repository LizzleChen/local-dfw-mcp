/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: tool names and expected-attribution assertions
 * updated for the DFW tool set; per-tool test calls trimmed to about +
 * dfw_health + one wrong-city guard call (the live per-tool paths are covered
 * by test/smoke-*.js).
 * See LICENSE and NOTICE in the repository root.
 *
 * Spawn the MCP server over stdio, send JSON-RPC initialize + tools/list +
 * tools/call, verify the expected tool set and responses.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "..", "index.js");

const EXPECTED_TOOLS = [
  "about",
  "dfw_health",
  "dfw_311",
  "dfw_crime",
  "dfw_fema_flood",
  "dfw_tea_schools",
  "dfw_nws_alerts",
  "dfw_utility_providers",
  "dfw_district_lookup",
];

const server = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const responses = [];
server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try {
        responses.push(JSON.parse(line));
      } catch {
        responses.push({ raw: line });
      }
    }
  }
});

server.stderr.on("data", (c) => process.stderr.write(c));

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

async function expect(id, label, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = responses.find((r) => r.id === id);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "handshake-test", version: "0.0.0" },
    },
  });
  const init = await expect(1, "initialize");
  console.log("initialize OK -- server:", init.result?.serverInfo);

  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const list = await expect(2, "tools/list");
  const names = (list.result?.tools ?? []).map((t) => t.name);
  console.log(`tools/list OK -- ${names.length} tools: ${names.join(", ")}`);
  for (const expected of EXPECTED_TOOLS) {
    if (!names.includes(expected)) throw new Error(`Missing expected tool: ${expected}`);
  }
  if (names.includes("dfw_permits")) {
    throw new Error("dfw_permits must NOT be registered in v0.1 (stale sources)");
  }

  // about
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "about", arguments: {} } });
  const aboutRes = await expect(3, "about");
  const aboutText = aboutRes.result?.content?.[0]?.text ?? "";
  console.log("\nabout first 200:\n" + aboutText.slice(0, 200));
  if (!aboutText.includes("Local DFW MCP")) throw new Error("about output missing project name");
  if (!aboutText.includes("local-austin-mcp")) throw new Error("about output missing provenance credit");

  // dfw_health (live pings, 3.5s timeout per source)
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dfw_health", arguments: {} } });
  const healthRes = await expect(4, "dfw_health", 30000);
  const health = healthRes.result?.structuredContent;
  if (!health?.summary) throw new Error("dfw_health returned no summary");
  console.log(`\ndfw_health OK -- ok=${health.summary.ok} degraded=${health.summary.degraded} down=${health.summary.down}`);

  // Wrong-city guard through the full MCP stack (no upstream query fired).
  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "dfw_311", arguments: { address: "100 Main St, Fort Worth TX 76102", service_type: "pothole" } },
  });
  const guardRes = await expect(5, "dfw_311 guard", 20000);
  const guardText = guardRes.result?.content?.[0]?.text ?? "";
  if (!/Not covered/.test(guardText)) throw new Error(`dfw_311 did not refuse Fort Worth address: ${guardText.slice(0, 150)}`);
  console.log("\ndfw_311 wrong-city guard OK -- Fort Worth refused through the MCP stack");

  console.log("\nALL OK");
  server.kill();
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  server.kill();
  process.exit(1);
}

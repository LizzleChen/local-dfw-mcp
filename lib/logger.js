/**
 * Ported from local-austin-mcp (github.com/mindwear-capitian/local-austin-mcp)
 * Copyright Ed Neuhaus / Neuhaus Realty Group LLC. Apache License 2.0.
 * Changes for local-dfw-mcp: log prefix [local-austin-mcp] -> [local-dfw-mcp];
 * MCP logger name string updated. Otherwise verbatim.
 * See LICENSE and NOTICE in the repository root.
 *
 * Unified logger. Writes to stderr (never stdout, where JSON-RPC framing lives)
 * and, once attached, forwards lines as MCP logging notifications.
 */

const PREFIX = "[local-dfw-mcp]";

let attachedServer = null;

export function attach(server) {
  attachedServer = server;
}

function emitMcpLog(level, data) {
  const srv = attachedServer;
  if (!srv) return;
  try {
    if (typeof srv.sendLoggingMessage === "function") {
      srv.sendLoggingMessage({ level, data });
      return;
    }
    if (srv.server && typeof srv.server.sendLoggingMessage === "function") {
      srv.server.sendLoggingMessage({ level, data });
      return;
    }
    if (typeof srv.notification === "function") {
      srv.notification({
        method: "notifications/message",
        params: { level, logger: "local-dfw-mcp", data },
      });
    }
  } catch (_) {
    /* logging must never throw */
  }
}

function fmt(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function write(level, args) {
  const msg = fmt(args);
  process.stderr.write(`${PREFIX} [${level}] ${msg}\n`);
  emitMcpLog(level, msg);
}

export const log = {
  debug: (...a) => write("debug", a),
  info:  (...a) => write("info", a),
  warn:  (...a) => write("warning", a),
  error: (...a) => write("error", a),
};

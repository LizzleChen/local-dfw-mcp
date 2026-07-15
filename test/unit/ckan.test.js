import { test } from "node:test";
import assert from "node:assert/strict";
import { sqlEscape, ilikeClause } from "../../lib/ckan.js";

test("sqlEscape: doubles single quotes", () => {
  assert.equal(sqlEscape("O'Hara"), "O''Hara");
  assert.equal(sqlEscape("plain"), "plain");
});

test("sqlEscape: coerces non-strings", () => {
  assert.equal(sqlEscape(2026), "2026");
});

test("ilikeClause: builds a contains-match clause with escaped value", () => {
  assert.equal(ilikeClause('"Public_Address"', "Morse"), `"Public_Address" ILIKE '%Morse%'`);
});

test("ilikeClause: escapes single quotes in the value (SQL injection guard)", () => {
  const clause = ilikeClause('"Crime"', "O'Brien'; DROP TABLE x; --");
  // The single quotes in the malicious payload must be doubled, not passed
  // through raw -- otherwise the payload could break out of the string
  // literal and inject arbitrary SQL.
  assert.equal(clause, `"Crime" ILIKE '%O''Brien''; DROP TABLE x; --%'`);
  // No unescaped single quote should appear inside the literal body.
  const body = clause.slice(clause.indexOf("'%") + 2, clause.lastIndexOf("%'"));
  assert.doesNotMatch(body, /(?<!')'(?!')/); // no lone (unescaped) single quotes
});

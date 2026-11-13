import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { noteMoves, KEEP_MS } from "./moves.ts";

test("a recorded move is done; an unknown id is not", () => {
  const m = noteMoves(new Database(":memory:"));
  m.record("op-1", "a.md", "b.md", 1000);
  assert.equal(m.done("op-1"), true);
  assert.equal(m.done("op-2"), false);
});

test("ids older than the window are dropped on the next record", () => {
  const m = noteMoves(new Database(":memory:"));
  m.record("old", "a.md", "b.md", 1000);
  m.record("new", "c.md", "d.md", 1000 + KEEP_MS + 1);
  assert.equal(m.done("old"), false);
  assert.equal(m.done("new"), true);
});

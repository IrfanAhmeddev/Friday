import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSession,
  getOrCreateSession,
} from "../src/nlu/context-engine";

test("session memory evicts least-recently-used sessions at its bound", () => {
  const oldest = getOrCreateSession("bounded-session-0");
  const nextOldest = getOrCreateSession("bounded-session-1");

  for (let index = 2; index < 1_000; index++) {
    getOrCreateSession(`bounded-session-${index}`);
  }

  assert.strictEqual(getOrCreateSession("bounded-session-0"), oldest);
  getOrCreateSession("bounded-session-overflow");

  assert.notStrictEqual(
    getOrCreateSession("bounded-session-1"),
    nextOldest,
  );

  for (let index = 0; index < 1_000; index++) {
    clearSession(`bounded-session-${index}`);
  }
  clearSession("bounded-session-overflow");
});

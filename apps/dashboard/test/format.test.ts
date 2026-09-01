import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, formatHistoryDate } from "../src/lib/format.js";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

test("formats recent task history timestamps as relative human-readable dates", () => {
  assert.equal(formatHistoryDate("2026-09-01T11:58:00.000Z", NOW), "2 min ago");
  assert.equal(formatHistoryDate("2026-09-01T10:00:00.000Z", NOW), "2 hr ago");
  assert.match(formatHistoryDate("2026-08-30T18:30:00.000Z", NOW), /^yesterday at /);
});

test("formats invalid or missing task history timestamps safely", () => {
  assert.equal(formatHistoryDate(null, NOW), "never");
  assert.equal(formatHistoryDate("not-a-date", NOW), "unknown");
});

test("formats task execution durations, including active tasks", () => {
  assert.equal(formatDuration("2026-08-27T10:00:00.000Z", "2026-08-27T10:00:07.000Z"), "7s");
  assert.equal(formatDuration("2026-08-27T10:00:00.000Z", "2026-08-27T10:02:07.000Z"), "2m 7s");
  assert.equal(formatDuration(null, null), "not started");
  assert.equal(formatDuration("invalid", "2026-08-27T10:00:07.000Z"), "unknown");
});

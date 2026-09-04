import assert from "node:assert/strict";
import test from "node:test";

import { formatAge, formatDuration, formatFutureDistance, formatHistoryDate, formatInstant } from "../src/lib/format.js";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

test("formats absolute timestamps in the Europe/Paris timezone", () => {
  assert.equal(formatInstant("2026-09-04T13:43:21.000Z"), "04/09/2026 15:43:21");
  assert.equal(formatInstant("2026-01-15T13:43:21.000Z"), "15/01/2026 14:43:21");
  assert.equal(formatInstant(null), "never");
  assert.equal(formatInstant("not-a-date"), "unknown");
});

test("formats future quota reset distance in hours and minutes", () => {
  const now = Date.parse("2026-09-04T12:31:00.000Z");
  assert.equal(formatFutureDistance("2026-09-04T13:43:21.000Z", now), "dans 1 h 12 min");
  assert.equal(formatFutureDistance("2026-09-04T12:51:00.000Z", now), "dans 20 min");
  assert.equal(formatFutureDistance("2026-09-04T12:31:30.000Z", now), "dans moins d’1 min");
  assert.equal(formatFutureDistance("2026-09-04T12:30:00.000Z", now), "maintenant");
  assert.equal(formatFutureDistance("not-a-date", now), "unknown");
});

test("formats recent task history timestamps as relative French dates", () => {
  assert.equal(formatHistoryDate("2026-09-01T11:58:00.000Z", NOW), "il y a 2 min");
  assert.equal(formatHistoryDate("2026-09-01T10:00:00.000Z", NOW), "il y a 2 h");
  assert.equal(formatHistoryDate("2026-08-30T18:30:00.000Z", NOW), "hier à 20:30");
  assert.equal(formatHistoryDate("2026-08-29T18:30:00.000Z", NOW), "29 août 2026, 20:30");
});

test("formats runner ages in French", () => {
  assert.equal(formatAge(12_000), "il y a 12 s");
  assert.equal(formatAge(120_000), "il y a 2 min");
  assert.equal(formatAge(7_200_000), "il y a 2 h");
  assert.equal(formatAge(172_800_000), "il y a 2 j");
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

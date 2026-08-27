import assert from "node:assert/strict";
import test from "node:test";
import { CrashSafeWorker } from "../src/CrashSafeWorker.js";

test("recovers before scheduling and sleeps while globally paused", async () => {
  const events: string[] = [];
  const worker = new CrashSafeWorker({
    recoverIncompleteExecutions: async () => { events.push("recover"); },
    getMode: async () => "paused", runCycle: async () => { throw new Error("must not dispatch"); },
    recordCycleFailure: async () => { events.push("failure"); },
    sleep: async () => { events.push("sleep"); worker.requestStop(); },
  });
  await worker.run();
  assert.deepEqual(events, ["recover", "sleep"]);
});

test("uses a quota wake-up instead of busy looping", async () => {
  const sleeps: number[] = []; let calls = 0;
  const worker = new CrashSafeWorker({
    recoverIncompleteExecutions: async () => {}, getMode: async () => "running",
    runCycle: async () => ({ outcome: "waiting_quota", nextWakeUpAt: "2026-08-27T10:01:00.000Z" }),
    recordCycleFailure: async () => {}, now: () => new Date("2026-08-27T10:00:00.000Z"),
    sleep: async (delay) => { sleeps.push(delay); if (++calls === 1) worker.requestStop(); },
  });
  await worker.run(); assert.deepEqual(sleeps, [60_000]);
});

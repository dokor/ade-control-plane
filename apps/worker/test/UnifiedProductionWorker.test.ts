import assert from "node:assert/strict";
import test from "node:test";

import { UnifiedProductionWorker } from "../src/UnifiedProductionWorker.js";

test("runs a manual task before considering GitHub work", async () => {
  const stop = new AbortController();
  const calls: string[] = [];
  const worker = new UnifiedProductionWorker({
    wake: { wait: async () => ({ reason: "manual-task", projectId: null, fullReconcile: false }) },
    manual: {
      recoverInterruptedTask: async () => {},
      runOnce: async () => { calls.push("manual"); stop.abort(); return true; },
    },
    github: { runCycle: async () => { calls.push("github"); return { outcome: "idle", reason: "none" }; } },
    fullReconcileIntervalMs: 1_000,
  });

  await worker.run(stop.signal);
  assert.deepEqual(calls, ["manual"]);
});

test("does not dispatch either source while quota blocks new work", async () => {
  const stop = new AbortController();
  const calls: string[] = [];
  const worker = new UnifiedProductionWorker({
    wake: { wait: async () => ({ reason: "quota", projectId: null, fullReconcile: true }) },
    manual: { recoverInterruptedTask: async () => {}, runOnce: async () => { calls.push("manual"); return false; } },
    github: { runCycle: async () => { calls.push("github"); return { outcome: "idle", reason: "none" }; } },
    quota: { refresh: async () => {
      stop.abort();
      return {
        snapshot: { provider: "openai", accountRef: "test", usedPercent: 100, observedAt: "2026-09-01T00:00:00.000Z" },
        refreshed: true,
        decision: { canStartWork: false, state: "blocked", reason: "blocked", refreshRequired: false },
      };
    } },
    fullReconcileIntervalMs: 1_000,
  });

  await worker.run(stop.signal);
  assert.deepEqual(calls, []);
});

test("schedules one jittered provider refresh after a known quota reset", async () => {
  const worker = new UnifiedProductionWorker({
    wake: { wait: async () => ({ reason: "quota", projectId: null, fullReconcile: false }) },
    manual: { recoverInterruptedTask: async () => {}, runOnce: async () => false },
    github: { runCycle: async () => ({ outcome: "idle", reason: "none" }) },
    quota: { refresh: async () => ({
      snapshot: { provider: "openai", accountRef: "test", usedPercent: 100, observedAt: "2026-09-01T00:00:00.000Z", resetsAt: "2026-09-01T00:01:00.000Z" },
      refreshed: true,
      decision: { canStartWork: false, state: "blocked", reason: "blocked", refreshRequired: false, resetsAt: "2026-09-01T00:01:00.000Z" },
    }) },
    fullReconcileIntervalMs: 300_000,
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    random: () => 0.5,
  });

  await worker.runOnce({ reason: "quota", projectId: null, fullReconcile: false });
  assert.equal(worker.nextWaitTimeoutMs(300_000), 75_000);
});

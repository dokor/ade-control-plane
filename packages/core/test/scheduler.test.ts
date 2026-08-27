import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSchedule,
  type ScheduleInput,
  type SchedulerCandidate,
  type SchedulerRunner,
} from "../src/index.js";

const runner = (overrides: Partial<SchedulerRunner> = {}): SchedulerRunner => ({
  id: "runner-a",
  state: "online",
  architecture: "arm64",
  labels: ["local"],
  capabilities: ["docker", "browser", "ade:advance"],
  memoryClass: "medium",
  ...overrides,
});

const candidate = (
  id: string,
  priority: number,
  overrides: Partial<SchedulerCandidate> = {},
): SchedulerCandidate => ({
  project: { id, repository: `dokor/${id}`, priority, controlState: "enabled" },
  adeAvailability: "ready",
  work: { ref: `work-${id}`, cost: "short" },
  hasActiveLease: false,
  ...overrides,
});

const input = (overrides: Partial<ScheduleInput> = {}): ScheduleInput => ({
  mode: "running",
  now: "2026-08-27T10:00:00.000Z",
  quota: { state: "normal" },
  candidates: [candidate("alpha", 50)],
  runners: [runner()],
  ...overrides,
});

test("ranks priority, aging, then project ID deterministically", () => {
  const decision = evaluateSchedule(input({
    candidates: [
      candidate("zulu", 10),
      candidate("bravo", 50, { lastSuccessfulExecutionAt: "2026-08-27T09:00:00.000Z" }),
      candidate("alpha", 50, { lastSuccessfulExecutionAt: "2026-08-27T08:00:00.000Z" }),
    ],
  }));

  assert.deepEqual(decision.selected, {
    projectId: "alpha",
    runnerId: "runner-a",
    workRef: "work-alpha",
  });
});

test("fails closed for global, ADE, lease, and security gates", () => {
  const paused = candidate("paused", 100);
  paused.project = { ...paused.project, controlState: "paused" };
  const decision = evaluateSchedule(input({
    quota: { state: "unknown" },
    candidates: [
      paused,
      candidate("human", 100, { adeAvailability: "waiting_human" }),
      candidate("stale", 100, { adeAvailability: "stale" }),
      candidate("leased", 100, { hasActiveLease: true }),
      candidate("security", 100, { securityBlocked: true }),
    ],
  }));

  assert.equal(decision.selected, null);
  assert.deepEqual(
    decision.candidates.map(({ exclusion }) => exclusion),
    ["project-paused", "waiting-human", "ade-not-ready", "lease-active", "security-blocked"],
  );
  assert.equal(
    evaluateSchedule(input({ mode: "safe_mode" })).candidates[0]?.exclusion,
    "global-safe-mode",
  );
});

test("matches only online runners with all typed requirements", () => {
  const decision = evaluateSchedule(input({
    candidates: [candidate("browser", 50, {
      work: {
        ref: "browser-work",
        cost: "short",
        runnerRequirements: {
          architectures: ["arm64"],
          labels: ["local"],
          requiresDocker: true,
          requiresBrowser: true,
          minimumMemoryClass: "medium",
          requiredAdeCapabilities: ["advance"],
        },
      },
    })],
    runners: [
      runner({ id: "offline", state: "offline" }),
      runner({ id: "draining", state: "draining" }),
      runner({ id: "small", memoryClass: "small" }),
      runner({ id: "ready" }),
    ],
  }));

  assert.deepEqual(decision.selected, {
    projectId: "browser",
    runnerId: "ready",
    workRef: "browser-work",
  });
});

test("applies conservative quota policy and exposes a quota wake-up", () => {
  const longWork = candidate("long", 90, { work: { ref: "long-work", cost: "long" } });
  assert.equal(
    evaluateSchedule(input({ quota: { state: "draining" }, candidates: [longWork] })).candidates[0]?.exclusion,
    "quota-draining",
  );
  assert.equal(
    evaluateSchedule(input({
      quota: { state: "throttled" },
      candidates: [candidate("low", 49)],
    })).candidates[0]?.exclusion,
    "quota-throttled",
  );
  assert.equal(
    evaluateSchedule(input({
      quota: { state: "blocked", resetsAt: "2026-08-27T11:00:00.000Z" },
    })).nextWakeUpAt,
    "2026-08-27T11:00:00.000Z",
  );
});

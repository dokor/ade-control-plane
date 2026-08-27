import assert from "node:assert/strict";
import test from "node:test";
import { DurableExecutionCoordinator } from "../src/DurableExecutionCoordinator.js";

const candidate = {
  reason: "unknown-execution" as const,
  lease: null,
  execution: { id: "execution-1", projectId: "project-1", runnerId: "runner-1", adeExecutionRef: null },
};

function setup(state: "succeeded" | "unknown" | "not-found" | "running" = "succeeded") {
  const completions: unknown[] = [];
  const store = {
    executions: {
      listReconciliationCandidates: async () => [candidate],
      complete: async (input: unknown) => { completions.push(input); return {}; },
    },
  };
  const runner = { reconcile: async () => ({ state, summary: "safe summary" }) };
  const projects = { get: async () => ({ projectId: "project-1", repository: "dokor/project", projectRef: "project" }) };
  return { completions, coordinator: new DurableExecutionCoordinator(store as never, runner, projects, () => new Date("2026-08-27T10:00:00.000Z")) };
}

test("finishes a recovered terminal execution without a retry", async () => {
  const context = setup("succeeded"); await context.coordinator.recover();
  assert.match(JSON.stringify(context.completions[0]), /"succeeded"/);
  assert.match(JSON.stringify(context.completions[0]), /execution\.reconciled/);
});

test("keeps an ambiguous recovery unknown for later reconciliation", async () => {
  const context = setup("not-found"); await context.coordinator.recover();
  assert.match(JSON.stringify(context.completions[0]), /"unknown"/);
  assert.match(JSON.stringify(context.completions[0]), /EXECUTION_STATE_UNKNOWN/);
});

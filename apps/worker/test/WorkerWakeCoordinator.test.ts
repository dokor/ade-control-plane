import assert from "node:assert/strict";
import test from "node:test";

import { WorkerWakeCoordinator } from "../src/WorkerWakeCoordinator.js";

test("coalesces a burst of wakeups and preserves a full reconciliation request", async () => {
  const coordinator = new WorkerWakeCoordinator();
  const waiting = coordinator.wait(10_000);
  coordinator.wake({ reason: "github-webhook", projectId: "project-1" });
  coordinator.wake({ reason: "manual-task", projectId: "project-1", fullReconcile: true });
  const event = await waiting;
  assert.equal(event.projectId, "project-1");
  assert.equal(event.fullReconcile, true);
  assert.equal(event.reason, "manual-task");
});

test("emits a periodic full-reconciliation event when no external wakeup arrives", async () => {
  const event = await new WorkerWakeCoordinator().wait(1_000);
  assert.equal(event.reason, "periodic-full-reconcile");
  assert.equal(event.fullReconcile, true);
  assert.equal(event.projectId, null);
});

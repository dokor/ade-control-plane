import assert from "node:assert/strict";
import test from "node:test";

import { WorkerWakeCoordinator } from "../src/WorkerWakeCoordinator.js";

test("dashboard GitHub refresh wake requests a full reconciliation", async () => {
  const wake = new WorkerWakeCoordinator();
  wake.wake({ reason: "github-reconcile-requested", projectId: null });

  const event = await wake.wait(1_000);
  assert.deepEqual(event, {
    reason: "github-reconcile-requested",
    projectId: null,
    fullReconcile: true,
  });
});

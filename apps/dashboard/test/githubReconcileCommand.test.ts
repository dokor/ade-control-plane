import assert from "node:assert/strict";
import test from "node:test";
import type { ControlPlanePersistence, WorkerWakeup } from "@ade-control-plane/database";

import { submitDashboardCommand } from "../src/lib/commands.js";
import { createMemoryPersistence, createMemoryState } from "./helpers/memoryPersistence.js";
import { NOW } from "./helpers/fixtures.js";

const ORIGIN = "https://ade.example.com";
const operator = { actorRef: "dokor", canRead: true, canMutate: true };

test("GitHub reconcile records durable intent and wakes the worker without performing GitHub work in the request", async () => {
  const state = createMemoryState();
  const wakeups: WorkerWakeup[] = [];
  const persistence: ControlPlanePersistence = {
    ...createMemoryPersistence(state),
    wakeups: {
      async signal(input) { wakeups.push(input); },
      async listen() { return async () => {}; },
    },
  };

  const outcome = await submitDashboardCommand({
    persistence,
    identity: operator,
    requestOrigin: ORIGIN,
    expectedOrigin: ORIGIN,
    now: NOW,
    correlationId: "corr-github-refresh",
  }, {
    type: "github.reconcile",
    payload: {},
  });

  assert.match(outcome.summary, /worker will refresh registered projects/);
  assert.equal(state.commands[0]?.commandType, "github.reconcile");
  assert.equal(state.commands[0]?.status, "applied");
  assert.deepEqual(wakeups, [{
    reason: "github-reconcile-requested",
    projectId: null,
    signaledAt: NOW,
  }]);
});

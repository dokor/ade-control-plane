import assert from "node:assert/strict";
import test from "node:test";

import { submitDashboardCommand } from "../src/lib/commands.js";
import { classifyRetryability } from "../src/lib/retry.js";
import {
  createMemoryPersistence,
  createMemoryState,
  type MemoryState,
} from "./helpers/memoryPersistence.js";
import { execution, NOW, project, runner } from "./helpers/fixtures.js";

const ORIGIN = "https://ade.example.com";
const operator = { actorRef: "dokor", canRead: true, canMutate: true };

function context(state: MemoryState, overrides: Partial<{ identity: typeof operator | null; requestOrigin: string | null }> = {}) {
  return {
    persistence: createMemoryPersistence(state),
    identity: "identity" in overrides ? overrides.identity ?? null : operator,
    requestOrigin: "requestOrigin" in overrides ? overrides.requestOrigin ?? null : ORIGIN,
    expectedOrigin: ORIGIN,
    now: NOW,
    correlationId: "corr-1",
  };
}

test("pause goes through a persisted ControlCommand and an audit record", async () => {
  const state = createMemoryState({ projects: [project()] });
  const outcome = await submitDashboardCommand(context(state), {
    type: "project.pause",
    payload: { projectId: project().id },
  });

  assert.equal(outcome.status, "applied");
  assert.equal(state.projects[0]?.state, "paused");

  const command = state.commands[0];
  assert.equal(command?.commandType, "project.pause");
  assert.equal(command?.status, "applied");
  assert.equal(command?.source, "dashboard");
  assert.equal(command?.actorRef, "dokor");

  const actions = state.auditEvents.map(({ action }) => action);
  assert.deepEqual(actions, ["command.authorized", "command.applied"]);
  // Identity is audited before the state mutation is observable to the worker.
  assert.equal(state.auditEvents[0]?.actorRef, "dokor");
});

test("global pause and safe mode change durable scheduler mode and are audited", async () => {
  const state = createMemoryState();
  await submitDashboardCommand(context(state), { type: "global.pause", payload: {} });
  assert.equal(state.settings.schedulerMode, "paused");

  await submitDashboardCommand(context(state), { type: "global.safe-mode", payload: {} });
  assert.equal(state.settings.schedulerMode, "safe_mode");
  assert.equal(state.settings.updatedBy, "dokor");
  assert.ok(state.auditEvents.every(({ category }) => category === "control"));
});

test("an unauthenticated mutation is denied and never creates a command row", async () => {
  const state = createMemoryState({ projects: [project()] });
  await assert.rejects(
    submitDashboardCommand(context(state, { identity: null }), {
      type: "project.pause",
      payload: { projectId: project().id },
    }),
    /UNAUTHENTICATED/,
  );

  assert.equal(state.commands.length, 0);
  assert.equal(state.projects[0]?.state, "enabled");
  assert.equal(state.auditEvents[0]?.category, "security");
  assert.equal(state.auditEvents[0]?.result, "denied");
});

test("a cross-origin mutation is rejected as CSRF", async () => {
  const state = createMemoryState({ projects: [project()] });
  await assert.rejects(
    submitDashboardCommand(context(state, { requestOrigin: "https://evil.example" }), {
      type: "project.pause",
      payload: { projectId: project().id },
    }),
    /CSRF_REJECTED/,
  );
  assert.equal(state.projects[0]?.state, "enabled");
});

test("safe retry is refused for a reconcile-first execution and recorded as rejected", async () => {
  const ambiguous = execution({ status: "unknown", errorCode: null });
  const state = createMemoryState({
    projects: [project()],
    executions: [ambiguous],
  });
  assert.equal(classifyRetryability(ambiguous), "reconcile-first");

  await assert.rejects(
    submitDashboardCommand(context(state), {
      type: "execution.safe-retry",
      payload: { executionId: ambiguous.id, retryability: "safe" },
    }),
    /RETRY_NOT_SAFE/,
  );

  assert.equal(state.commands[0]?.status, "rejected");
  assert.ok(state.auditEvents.some(({ action }) => action === "command.rejected"));
});

test("safe retry is accepted for a classified-safe execution without dispatching work", async () => {
  const failed = execution({ status: "failed", errorCode: "RUNNER_UNAVAILABLE" });
  const state = createMemoryState({ projects: [project()], executions: [failed] });

  const outcome = await submitDashboardCommand(context(state), {
    type: "execution.safe-retry",
    payload: { executionId: failed.id },
  });

  assert.match(outcome.summary, /worker/);
  assert.equal(state.commands[0]?.status, "applied");
  // The Dashboard records intent only; execution status is untouched.
  assert.equal(state.executions[0]?.status, "failed");
});

test("an ADE decision accepts only its offered option and resolves idempotently", async () => {
  const current = project();
  const state = createMemoryState({
    projects: [current],
    decisions: [{
      id: "decision-1", projectId: current.id, decisionRef: "issue-42-20260901", prompt: "Choose publication.",
      options: ["resume", "wait"], status: "open", resolvedOption: null, resolvedBy: null,
      observedAt: NOW, resolvedAt: null,
    }],
  });
  await assert.rejects(
    submitDashboardCommand(context(state), { type: "ade.decide", payload: { projectId: current.id, decisionRef: "issue-42-20260901", option: "unsafe" } }),
    /not one ADE offered/,
  );
  const first = await submitDashboardCommand(context(state), { type: "ade.decide", payload: { projectId: current.id, decisionRef: "issue-42-20260901", option: "resume" } });
  const replay = await submitDashboardCommand(context(state), { type: "ade.decide", payload: { projectId: current.id, decisionRef: "issue-42-20260901", option: "resume" } });
  assert.match(first.summary, /resolved as resume/);
  assert.match(replay.summary, /already resolved/);
  assert.equal(state.decisions[0]?.resolvedOption, "resume");
});

test("cancellation records intent only for an active execution", async () => {
  const running = execution({ status: "running" });
  const state = createMemoryState({ projects: [project()], executions: [running] });

  const outcome = await submitDashboardCommand(context(state), {
    type: "execution.cancel",
    payload: { executionId: running.id },
  });

  assert.match(outcome.summary, /Cancellation requested/);
  assert.equal(state.executions[0]?.status, "running");
  assert.equal(state.executions[0]?.cancelRequested, true);
  assert.equal(state.commands[0]?.status, "applied");
});

test("cancellation rejects an execution that has already finished", async () => {
  const finished = execution({ status: "succeeded" });
  const state = createMemoryState({ projects: [project()], executions: [finished] });

  await assert.rejects(
    submitDashboardCommand(context(state), {
      type: "execution.cancel",
      payload: { executionId: finished.id },
    }),
    /Only an active execution/,
  );
  assert.equal(state.executions[0]?.cancelRequested, undefined);
});

test("runner drain and disable are audited state changes", async () => {
  const state = createMemoryState({ runners: [runner()] });
  await submitDashboardCommand(context(state), {
    type: "runner.drain",
    payload: { runnerId: runner().id },
  });
  assert.equal(state.runners[0]?.state, "draining");

  await submitDashboardCommand(context(state), {
    type: "runner.disable",
    payload: { runnerId: runner().id },
  });
  assert.equal(state.runners[0]?.state, "disabled");
  assert.equal(state.commands.length, 2);
});

test("an idempotency key does not apply the same command twice", async () => {
  const state = createMemoryState({ projects: [project()] });
  const request = {
    type: "project.reprioritize",
    payload: { projectId: project().id, priority: 30 },
    idempotencyKey: "key-1",
  };
  await submitDashboardCommand(context(state), request);
  state.projects[0] = { ...project(), priority: 30 };

  const replay = await submitDashboardCommand(context(state), request);
  assert.equal(replay.summary, "Command was already applied.");
  assert.equal(state.commands.length, 1);
});

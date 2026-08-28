import assert from "node:assert/strict";
import test from "node:test";

import type { V0TaskRecord } from "@ade-control-plane/database";

import { V0TaskWorker } from "../src/v0/V0TaskWorker.js";

test("fails an interrupted running task without retrying it", async () => {
  const task: V0TaskRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: "11111111-1111-4111-8111-111111111111",
    prompt: "Task",
    status: "RUNNING",
    cancelRequested: false,
    branchName: "ade/existing",
    pullRequestNumber: null,
    pullRequestUrl: null,
    errorCode: null,
    errorSummary: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    startedAt: "2026-08-27T10:00:01.000Z",
    finishedAt: null,
    updatedAt: "2026-08-27T10:00:01.000Z",
  };
  let executions = 0;
  const worker = new V0TaskWorker({
    persistence: {
      v0Tasks: {
        list: async () => [task],
        claimPending: async () => null,
        appendLog: async () => null,
        complete: async (input) => {
          Object.assign(task, input);
          return task;
        },
      },
    },
    executor: { execute: async () => { executions += 1; } },
    now: () => new Date("2026-08-27T10:05:00.000Z"),
  });

  await worker.recoverInterruptedTask();

  assert.equal(task.status, "FAILED");
  assert.equal(task.errorCode, "WORKER_RESTARTED");
  assert.equal(executions, 0);
});

test("does not claim work while the quota gate is blocked", async () => {
  let claims = 0;
  let executions = 0;
  const worker = new V0TaskWorker({
    persistence: {
      v0Tasks: {
        list: async () => [],
        claimPending: async () => {
          claims += 1;
          return null;
        },
        appendLog: async () => null,
        complete: async () => { throw new Error("not used"); },
      },
    },
    quota: {
      refresh: async () => ({
        snapshot: {
          provider: "openai",
          accountRef: "codex",
          usedPercent: 95,
          observedAt: "2026-08-27T10:00:00.000Z",
        },
        decision: {
          state: "blocked" as const,
          canStartWork: false,
          reason: "Provider quota is blocked.",
          resetsAt: "2026-08-27T11:00:00.000Z",
          refreshRequired: false,
        },
        refreshed: true,
      }),
    },
    executor: { execute: async () => { executions += 1; } },
    now: () => new Date("2026-08-27T10:05:00.000Z"),
  });

  assert.equal(await worker.runOnce(), false);
  assert.equal(claims, 0);
  assert.equal(executions, 0);
});

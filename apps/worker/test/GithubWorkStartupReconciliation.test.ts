import assert from "node:assert/strict";
import test from "node:test";

import type { ControlPlanePersistence, ExecutionRecord, ReconciliationCandidate } from "@ade-control-plane/database";
import type { GithubWorkReader } from "@ade-control-plane/github";

import { GithubWorkOrchestrator } from "../src/GithubWorkOrchestrator.js";

const NOW = "2026-09-08T09:37:31.000Z";

function execution(id: string, status: ExecutionRecord["status"]): ExecutionRecord {
  return {
    id,
    projectId: "project-1",
    runnerId: "runner-1",
    adeExecutionRef: null,
    workRef: "github:issue:246",
    capability: "github-work.codex",
    status,
    attempt: 1,
    requestedAt: NOW,
    startedAt: NOW,
    finishedAt: status === "unknown" ? NOW : null,
    resultSummary: null,
    errorCode: status === "unknown" ? "GITHUB_WORK_TIMEOUT" : null,
    errorSummary: status === "unknown" ? "The GitHub-work deadline elapsed before completion was confirmed." : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("startup reconciliation leaves terminal unknown executions intact and still reconciles stale active work", async () => {
  const alreadyUnknown: ReconciliationCandidate = {
    reason: "unknown-execution",
    lease: null,
    execution: execution("already-unknown", "unknown"),
  };
  const staleActive: ReconciliationCandidate = {
    reason: "stale-lease",
    lease: null,
    execution: execution("stale-active", "running"),
  };
  const completions: Array<{ executionId: string; status: ExecutionRecord["status"]; errorCode?: string | null }> = [];

  const persistence = {
    executions: {
      listReconciliationCandidates: async () => [alreadyUnknown, staleActive],
      complete: async (input: { executionId: string; status: ExecutionRecord["status"]; errorCode?: string | null }) => {
        assert.notEqual(input.executionId, alreadyUnknown.execution.id, "terminal unknown executions must not be completed again");
        completions.push(input);
        return { execution: { ...staleActive.execution, status: input.status }, applied: true, releasedLease: true };
      },
    },
  } as unknown as ControlPlanePersistence;

  const orchestrator = new GithubWorkOrchestrator({
    persistence,
    reader: {} as GithubWorkReader,
    dispatcher: { execute: async () => ({ status: "succeeded" }) },
    ownerId: "test-worker",
    now: () => new Date(NOW),
  });

  await orchestrator.reconcileExecutions();

  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.executionId, staleActive.execution.id);
  assert.equal(completions[0]?.status, "unknown");
  assert.equal(completions[0]?.errorCode, "GITHUB_WORK_RECONCILIATION_REQUIRED");
});

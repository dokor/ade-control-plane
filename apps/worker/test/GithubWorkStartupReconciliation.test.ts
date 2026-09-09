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
      listActive: async () => [staleActive.execution],
      listReconciliationCandidates: async () => [alreadyUnknown, staleActive],
      complete: async (input: { executionId: string; status: ExecutionRecord["status"]; errorCode?: string | null }) => {
        assert.notEqual(input.executionId, alreadyUnknown.execution.id, "terminal unknown executions must not be completed again");
        completions.push(input);
        return { execution: { ...staleActive.execution, status: input.status }, applied: true, releasedLease: true };
      },
    },
    deliveryWorkflows: { getByExecutionId: async () => null },
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

test("startup reconciliation times out missing workflow evidence even with a fresh runner heartbeat", async () => {
  const active = execution("missing-workflow", "running");
  const completions: Array<{ executionId: string; status: ExecutionRecord["status"]; errorCode?: string | null; errorSummary?: string | null }> = [];
  const persistence = {
    executions: {
      listActive: async () => [active],
      listReconciliationCandidates: async () => [],
      complete: async (input: { executionId: string; status: ExecutionRecord["status"]; errorCode?: string | null; errorSummary?: string | null }) => {
        completions.push(input);
        return { execution: { ...active, status: input.status }, applied: true, releasedLease: true };
      },
    },
    deliveryWorkflows: { getByExecutionId: async () => null },
    githubWork: { listForProject: async () => [] },
    runners: { list: async () => [{ id: "runner-1", lastHeartbeatAt: "2026-09-08T09:38:30.000Z" }] },
  } as unknown as ControlPlanePersistence;

  const orchestrator = new GithubWorkOrchestrator({
    persistence,
    reader: {} as GithubWorkReader,
    dispatcher: { execute: async () => ({ status: "succeeded" }) },
    ownerId: "test-worker",
    workflowStartTimeoutMs: 10_000,
    now: () => new Date("2026-09-08T09:38:31.000Z"),
  });

  await orchestrator.reconcileExecutions();

  assert.equal(completions.length, 1);
  assert.equal(completions[0]?.executionId, active.id);
  assert.equal(completions[0]?.status, "unknown");
  assert.equal(completions[0]?.errorCode, "GITHUB_WORKFLOW_NOT_STARTED");
  assert.match(completions[0]?.errorSummary ?? "", /reconcile external state/u);
});

test("startup reconciliation recognizes a resumed execution's existing correlated workflow", async () => {
  const active = execution("resumed-execution", "running");
  let completed = false;
  const persistence = {
    executions: {
      listActive: async () => [active],
      listReconciliationCandidates: async () => [],
      complete: async () => { completed = true; throw new Error("a correlated resume must remain active"); },
    },
    deliveryWorkflows: {
      getByExecutionId: async (executionId: string) => executionId === "original-execution"
        ? { id: "workflow-1", executionId, projectId: active.projectId, issueNumber: 246, stage: "planning" }
        : null,
    },
    githubWork: { listForProject: async () => [{ issueNumber: 246, executionRef: "original-execution" }] },
  } as unknown as ControlPlanePersistence;
  const orchestrator = new GithubWorkOrchestrator({
    persistence,
    reader: {} as GithubWorkReader,
    dispatcher: { execute: async () => ({ status: "succeeded" }) },
    ownerId: "test-worker",
    workflowStartTimeoutMs: 10_000,
    now: () => new Date("2026-09-08T09:38:31.000Z"),
  });

  await orchestrator.reconcileExecutions();

  assert.equal(completed, false);
});

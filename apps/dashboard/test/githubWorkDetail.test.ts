import assert from "node:assert/strict";
import test from "node:test";

import { buildGithubWorkDetail } from "../src/lib/taskReadModel.js";

const now = "2026-09-03T10:00:00.000Z";
const project = {
  id: "project-1", slug: "alpha", name: "Alpha", repositoryOwner: "dokor", repositoryName: "alpha", repositoryId: "repo-1",
  state: "enabled", priority: 50, adeAdapter: "github-work", runnerPolicy: {}, configuration: {}, createdAt: now, updatedAt: now,
};
const work = {
  id: "work-1", projectId: project.id, repositoryGithubId: "repo-1", contractVersion: "ade.github-work/v1", issueNumber: 42,
  issueUrl: "https://github.com/dokor/alpha/issues/42", state: "waiting-human", priority: 50, dependsOn: [], retryPolicy: "reconcile-first",
  humanDecisionRef: "decision-1", executionRef: "execution-1", branchName: "ade/issue-42", pullRequestNumber: 99,
  sourceUpdatedAt: now, observedAt: now, expiresAt: "2026-09-03T11:00:00.000Z", present: true,
};

test("builds GitHub workflow detail from durable transitions and evidence", async () => {
  const detail = await buildGithubWorkDetail({
    projects: { getById: async () => project },
    githubWork: { listForProject: async () => [work] },
    executions: { listByProjectId: async () => [{ id: "execution-1", projectId: project.id, runnerId: "runner-1", adeExecutionRef: null, workRef: "github:issue:42", capability: "github-work.codex", status: "running", attempt: 1, requestedAt: now, startedAt: now, finishedAt: null, resultSummary: null, errorCode: null, errorSummary: null, createdAt: now, updatedAt: now, cancelRequested: true }] },
    deliveryWorkflows: {
      getByExecutionId: async () => ({ id: "workflow-1", executionId: "execution-1", projectId: project.id, issueNumber: 42, sourceUpdatedAt: now, stage: "reviewing", attempt: 1, adePlan: null, provenance: { runtimeVersion: "0.8.0", selectedProfiles: ["security"] }, providerExecutionRef: null, validationSummary: { status: "passed" }, reviewSummary: { status: "passed" }, branchName: "ade/issue-42", headSha: "a".repeat(40), pullRequestNumber: 99, pullRequestUrl: "https://github.com/dokor/alpha/pull/99", retryClassification: "reconcile-first", reconciliationRequired: false, humanDecisionRef: "decision-1", transitionReason: "Reviewing", createdAt: now, updatedAt: now }),
      listTransitions: async () => [{ id: "transition-1", workflowId: "workflow-1", stage: "reviewing", attempt: 1, reason: "Reviewing the change.", idempotencyKey: "reviewing-1", details: null, occurredAt: now }],
    },
    adeDecisions: { getByRef: async () => ({ id: "decision-1", projectId: project.id, decisionRef: "decision-1", prompt: "Choose next action", options: ["resume", "wait"], status: "open", resolvedOption: null, resolvedBy: null, observedAt: now, resolvedAt: null }) },
    executionLeases: { getActiveByLeaseKey: async () => ({ id: "lease-1", executionId: "execution-1", projectId: project.id, runnerId: "runner-1", ownerId: "worker", leaseKey: "github-work:project-1:42", acquiredAt: now, heartbeatAt: now, expiresAt: "2026-09-03T10:15:00.000Z", releasedAt: null, releaseReason: null }) },
    auditEvents: { listForProject: async () => [] },
  } as never, project.id, 42);

  assert.ok(detail);
  assert.equal(detail.stageLabel, "Reviewing");
  assert.equal(detail.transitions[0]?.label, "Reviewing");
  assert.deepEqual(detail.decision?.options, ["resume", "wait"]);
  assert.equal(detail.provenance.runtimeVersion, "0.8.0");
  assert.equal(detail.execution?.cancelRequested, true);
  assert.equal(detail.heartbeatAt, now);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildGithubWorkDetail } from "../src/lib/taskReadModel.js";

const now = "2026-09-03T10:00:00.000Z";
const later = "2026-09-03T10:01:00.000Z";
const project = {
  id: "project-1", slug: "alpha", name: "Alpha", repositoryOwner: "dokor", repositoryName: "alpha", repositoryId: "repo-1",
  state: "enabled", priority: 50, adeAdapter: "github-work", runnerPolicy: {}, configuration: {}, createdAt: now, updatedAt: now,
};
const baseWork = {
  id: "work-1", projectId: project.id, repositoryGithubId: "repo-1", contractVersion: "ade.github-work/v1", issueNumber: 42,
  issueUrl: "https://github.com/dokor/alpha/issues/42", state: "running", priority: 50, dependsOn: [], retryPolicy: "reconcile-first",
  humanDecisionRef: null, executionRef: "execution-1", branchName: "ade/issue-42", pullRequestNumber: null,
  sourceUpdatedAt: now, observedAt: now, expiresAt: "2026-09-03T11:00:00.000Z", present: true,
};
const baseExecution = {
  id: "execution-1", projectId: project.id, runnerId: "runner-1", adeExecutionRef: null, workRef: "github:issue:42",
  capability: "github-work.codex", status: "running", attempt: 1, requestedAt: now, startedAt: now, finishedAt: null,
  resultSummary: null, errorCode: null, errorSummary: null, createdAt: now, updatedAt: now, cancelRequested: false,
};
const baseWorkflow = {
  id: "workflow-1", executionId: "execution-1", projectId: project.id, issueNumber: 42, sourceUpdatedAt: now,
  stage: "implementing", attempt: 1, adePlan: null, provenance: { runtimeVersion: "0.12.0", selectedProfiles: ["security"] },
  providerExecutionRef: null, validationSummary: null, reviewSummary: null, branchName: "ade/issue-42", headSha: null,
  pullRequestNumber: null, pullRequestUrl: null, retryClassification: "reconcile-first", reconciliationRequired: false,
  humanDecisionRef: null, transitionReason: "Implementing", createdAt: now, updatedAt: later,
};
const activeLease = {
  id: "lease-1", executionId: "execution-1", projectId: project.id, runnerId: "runner-1", ownerId: "worker",
  leaseKey: "github-work:project-1:42", acquiredAt: now, heartbeatAt: later, expiresAt: "2026-09-03T10:15:00.000Z",
  releasedAt: null, releaseReason: null,
};

function persistence(input: {
  work?: Record<string, unknown>;
  executions?: readonly Record<string, unknown>[];
  workflow?: Record<string, unknown> | null;
  transitions?: readonly Record<string, unknown>[];
  lease?: Record<string, unknown> | null;
  audits?: readonly Record<string, unknown>[];
}) {
  return {
    projects: { getById: async () => project },
    githubWork: { listForProject: async () => [{ ...baseWork, ...(input.work ?? {}) }] },
    executions: { listByProjectId: async () => input.executions ?? [baseExecution] },
    deliveryWorkflows: {
      getByExecutionId: async () => input.workflow === undefined ? baseWorkflow : input.workflow,
      listTransitions: async () => input.transitions ?? [],
    },
    adeDecisions: { getByRef: async () => null },
    executionLeases: { getByExecutionId: async () => input.lease === undefined ? activeLease : input.lease },
    auditEvents: { listForExecution: async () => input.audits ?? [] },
  } as never;
}

test("correlates live provider activity, lease state and ADE stages without duplicating the stage ledger", async () => {
  const transitions = [
    { id: "transition-stage", workflowId: "workflow-1", stage: "implementing", attempt: 1, reason: "Implementing the handoff.", idempotencyKey: "implementing-1", details: null, occurredAt: now },
    { id: "transition-provider", workflowId: "workflow-1", stage: "implementing", attempt: 1, reason: "The provider is working.", idempotencyKey: "execution-1:activity:provider-executing:1", details: { activity: "provider-executing" }, occurredAt: later },
  ];
  const cancellationAudit = {
    id: "audit-cancel", occurredAt: later, category: "control", severity: "info", actorType: "operator", actorRef: "operator-1",
    projectId: project.id, executionId: "execution-1", runnerId: null, action: "command.applied", reason: null, result: "applied",
    correlationId: "correlation-cancel", metadata: { commandType: "execution.cancel" },
  };
  const detail = await buildGithubWorkDetail(persistence({
    transitions,
    executions: [{ ...baseExecution, cancelRequested: true, updatedAt: "2026-09-03T10:02:30.000Z" }],
    audits: [cancellationAudit],
  }), project.id, 42, "2026-09-03T10:02:00.000Z");

  assert.ok(detail);
  assert.equal(detail.stageLabel, "Developing");
  assert.equal(detail.transitions.length, 1);
  assert.equal(detail.currentProgress?.activity, "provider-executing");
  assert.equal(detail.progressState, "live");
  assert.equal(detail.heartbeatAt, later);
  const providerEvent = detail.events.find(({ id }) => id === "transition:transition-provider");
  assert.equal(providerEvent?.source, "Provider");
  assert.equal(providerEvent?.level, "info");
  assert.equal(providerEvent?.executionId, "execution-1");
  assert.equal(detail.lastActivity?.id, providerEvent?.id);
  assert.equal(detail.events.filter(({ title }) => title === "Cancellation requested").length, 1);
  assert.equal(detail.events.find(({ title }) => title === "Cancellation requested")?.occurredAt, later);
});

test("shows a complete successful chronology including the released historical lease", async () => {
  const finished = { ...baseExecution, status: "succeeded", finishedAt: later, updatedAt: later };
  const workflow = { ...baseWorkflow, stage: "completed", headSha: "a".repeat(40), pullRequestNumber: 99, pullRequestUrl: "https://github.com/dokor/alpha/pull/99" };
  const releasedLease = { ...activeLease, heartbeatAt: now, expiresAt: later, releasedAt: later, releaseReason: "github-work-succeeded" };
  const detail = await buildGithubWorkDetail(persistence({
    work: { state: "completed", pullRequestNumber: 99 }, executions: [finished], workflow, lease: releasedLease,
    transitions: [{ id: "completed", workflowId: "workflow-1", stage: "completed", attempt: 1, reason: "Pull request published.", idempotencyKey: "completed-1", details: null, occurredAt: later }],
  }), project.id, 42, "2026-09-03T10:03:00.000Z");

  assert.ok(detail);
  assert.equal(detail.stageLabel, "Completed");
  assert.equal(detail.progressState, "inactive");
  assert.equal(detail.blockingReason, null);
  assert.ok(detail.events.some(({ title, source }) => title === "Execution lease released" && source === "Control Plane"));
  assert.ok(detail.events.some(({ title, status }) => title === "Execution succeeded" && status === "success"));
});

test("keeps pre-workflow timeout evidence visible, sanitized, bounded and deterministic across polling", async () => {
  const timeoutExecution = {
    ...baseExecution, status: "unknown", finishedAt: later, updatedAt: later,
    errorCode: "GITHUB_WORKFLOW_NOT_STARTED",
    errorSummary: "No ADE workflow. token=supersecret C:\\Users\\private\\checkout must be reconciled.",
  };
  const audit = {
    id: "audit-timeout", occurredAt: later, category: "execution", severity: "warning", actorType: "system", actorRef: "worker",
    projectId: project.id, executionId: "execution-1", runnerId: "runner-1", action: "github-work.workflow-start-timeout",
    reason: "Startup deadline elapsed with token=supersecret.", result: "unknown", correlationId: "correlation-1", metadata: {},
  };
  const noisyAudits = Array.from({ length: 220 }, (_, index) => ({
    ...audit,
    id: `audit-checkpoint-${String(index).padStart(3, "0")}`,
    occurredAt: "2026-09-03T10:00:30.000Z",
    severity: "info",
    action: "worker.checkpoint",
    reason: "Bounded checkpoint.",
    result: "observed",
  }));
  const releasedLease = { ...activeLease, heartbeatAt: now, expiresAt: later, releasedAt: later, releaseReason: "github-workflow-start-timeout" };
  const source = persistence({
    work: { state: "ready", executionRef: null }, executions: [timeoutExecution], workflow: null, lease: releasedLease,
    audits: [...noisyAudits, audit, audit],
  });
  const first = await buildGithubWorkDetail(source, project.id, 42, "2026-09-03T10:03:00.000Z");
  const second = await buildGithubWorkDetail(source, project.id, 42, "2026-09-03T10:03:00.000Z");

  assert.ok(first);
  assert.deepEqual(first, second);
  assert.equal(first.stageLabel, "Reconciling");
  assert.match(first.nextAction, /Reconcile/u);
  assert.equal(first.events.length, 200);
  assert.equal(first.events.filter(({ id }) => id === "audit:audit-timeout").length, 1);
  assert.ok(first.events.every(({ detail }) => !detail.includes("supersecret") && !detail.includes("C:\\Users")));
  const timeout = first.events.find(({ id }) => id === "execution-error:execution-1");
  assert.equal(timeout?.source, "Control Plane");
  assert.equal(timeout?.level, "error");
  assert.equal(timeout?.executionId, "execution-1");
  assert.equal(first.lastActivity?.id, "execution-error:execution-1");
  assert.match(first.blockingReason ?? "", /No ADE workflow/u);
});

test("attributes Git and ADE failures to their technical source", async () => {
  const executions = [
    { ...baseExecution, id: "execution-git", status: "failed", finishedAt: later, updatedAt: later, errorCode: "GIT_COMMAND_FAILED", errorSummary: "Push failed." },
    { ...baseExecution, id: "execution-ade", status: "failed", finishedAt: now, updatedAt: now, errorCode: "ADE_PROFILE_REVIEW_BLOCKED", errorSummary: "Review blocked." },
  ];
  const detail = await buildGithubWorkDetail(persistence({ work: { state: "failed", executionRef: null }, executions, workflow: null, lease: null }), project.id, 42);

  assert.ok(detail);
  assert.equal(detail.events.find(({ id }) => id === "execution-error:execution-git")?.source, "Git");
  assert.equal(detail.events.find(({ id }) => id === "execution-error:execution-ade")?.source, "ADE");
  assert.equal(new Set(detail.events.map(({ id }) => id)).size, detail.events.length);
  assert.deepEqual([...detail.events].map(({ occurredAt }) => occurredAt), [...detail.events].map(({ occurredAt }) => occurredAt).toSorted());
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ControlPlanePersistence, ExecutionRecord, GithubWorkItemRecord, GithubWorkProfileRecord, ProjectRecord } from "@ade-control-plane/database";
import type { GithubWorkReader } from "@ade-control-plane/github";

import { GithubWorkOrchestrator, type GithubWorkDispatchRequest } from "../src/GithubWorkOrchestrator.js";

const NOW = "2026-08-28T10:00:00.000Z";
const LATER = "2026-08-28T10:05:00.000Z";

function project(id: string, name: string): ProjectRecord {
  return { id, slug: name.toLowerCase(), name, repositoryOwner: "dokor", repositoryName: name.toLowerCase(), repositoryId: `${id}-repo`, state: "enabled", priority: 1, adeAdapter: "github-work", runnerPolicy: { labels: ["local"] }, configuration: {}, createdAt: NOW, updatedAt: NOW };
}

function work(projectId: string, number: number, state: GithubWorkItemRecord["state"], priority: number): GithubWorkItemRecord {
  return { id: `${projectId}-${number}`, projectId, repositoryGithubId: `${projectId}-repo`, contractVersion: "ade.github-work/v1", issueNumber: number, issueUrl: `https://github.com/dokor/${projectId}/issues/${number}`, state, priority, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: null, branchName: null, pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: LATER, present: true };
}

function harness(items: readonly GithubWorkItemRecord[]) {
  const projects = [...new Set(items.map(({ projectId }) => projectId))].map((id) => project(id, id));
  const profiles: GithubWorkProfileRecord[] = [];
  const persisted: GithubWorkItemRecord[] = [];
  const executions: ExecutionRecord[] = [];
  const activeKeys = new Set<string>();
  const leaseByExecution = new Map<string, string>();
  const dispatches: GithubWorkDispatchRequest[] = [];
  const notifications: { kind: "waiting" | "failure"; issueNumber: number }[] = [];
  const persistence = {
    settings: { get: async () => ({ schedulerMode: "running", quotaThrottledPercent: 70, quotaDrainingPercent: 85, quotaBlockedPercent: 95, quotaStaleAfterMs: 300_000, updatedAt: NOW, updatedBy: "test" }) },
    projects: { list: async () => projects },
    runners: { list: async () => [{ id: "runner", name: "local", kind: "test", state: "online", architecture: "x64", capabilities: { codex: true }, labels: ["local"], lastHeartbeatAt: NOW, createdAt: NOW, updatedAt: NOW }] },
    providerQuotaSnapshots: { getLatest: async () => null },
    githubWork: {
      getProfile: async (projectId: string) => profiles.find((entry) => entry.projectId === projectId) ?? null,
      listForProject: async (projectId: string) => persisted.filter((entry) => entry.projectId === projectId),
      listForProjects: async (projectIds: readonly string[]) => persisted.filter((entry) => projectIds.includes(entry.projectId)),
      reconcile: async (input: { profile: GithubWorkProfileRecord; items: readonly GithubWorkItemRecord[] }) => {
        const profileIndex = profiles.findIndex((entry) => entry.projectId === input.profile.projectId);
        if (profileIndex >= 0) profiles[profileIndex] = input.profile;
        else profiles.push(input.profile);
        for (const item of input.items) {
          const index = persisted.findIndex((entry) => entry.projectId === item.projectId && entry.issueNumber === item.issueNumber);
          const reconciled = { ...item, id: persisted[index]?.id ?? item.id ?? `${item.projectId}-${item.issueNumber}`, present: true } as GithubWorkItemRecord;
          if (index >= 0) persisted[index] = reconciled;
          else persisted.push(reconciled);
        }
        return persisted.filter((entry) => entry.projectId === input.profile.projectId);
      },
    },
    executions: {
      listActive: async () => executions.filter((entry) => ["queued", "leased", "dispatched", "running"].includes(entry.status)),
      listByProjectId: async (projectId: string) => executions.filter((entry) => entry.projectId === projectId),
      scheduleWithLease: async (input: { execution: { id: string; projectId: string; runnerId: string; workRef: string; capability: string; requestedAt: string }; lease: { leaseKey: string } }) => {
        if (activeKeys.has(input.lease.leaseKey)) return null;
        activeKeys.add(input.lease.leaseKey);
        leaseByExecution.set(input.execution.id, input.lease.leaseKey);
        const execution: ExecutionRecord = { ...input.execution, adeExecutionRef: null, status: "leased", attempt: 1, startedAt: null, finishedAt: null, resultSummary: null, errorCode: null, errorSummary: null, createdAt: NOW, updatedAt: NOW };
        executions.push(execution);
        return { execution, lease: { id: "lease", executionId: execution.id, projectId: execution.projectId, runnerId: execution.runnerId, ownerId: "test", leaseKey: input.lease.leaseKey, acquiredAt: NOW, heartbeatAt: NOW, expiresAt: LATER, releasedAt: null, releaseReason: null } };
      },
      markDispatched: async (id: string) => updateExecution(executions, id, "dispatched"),
      markRunning: async (id: string) => updateExecution(executions, id, "running"),
      complete: async (input: { executionId: string; status: ExecutionRecord["status"]; resultSummary?: ExecutionRecord["resultSummary"] }) => {
        const execution = updateExecution(executions, input.executionId, input.status);
        execution.resultSummary = input.resultSummary ?? null;
        const lease = leaseByExecution.get(input.executionId);
        if (lease) activeKeys.delete(lease);
        return { execution, applied: true, releasedLease: true };
      },
    },
    auditEvents: { append: async () => ({}) },
  } as unknown as ControlPlanePersistence;
  const reader: GithubWorkReader = {
    detectRepository: async (repository) => ({ repository, compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [".agents/skills"], observedAt: NOW, reason: "compatible" }),
    listWorkItems: async (repository) => items
      .filter((item) => item.repositoryGithubId === repository.id)
      .map((item) => ({
        repository,
        contractVersion: "ade.github-work/v1" as const,
        issueNumber: item.issueNumber,
        issueUrl: item.issueUrl,
        state: item.state,
        priority: item.priority,
        dependsOn: item.dependsOn,
        retryPolicy: item.retryPolicy,
        humanDecisionRef: item.humanDecisionRef,
        executionRef: item.executionRef,
        branchName: item.branchName,
        pullRequestNumber: item.pullRequestNumber,
        sourceUpdatedAt: item.sourceUpdatedAt,
        observedAt: item.observedAt,
        expiresAt: item.expiresAt,
      })),
    getWorkItem: async () => null,
  };
  const orchestrator = new GithubWorkOrchestrator({ persistence, reader, ownerId: "test", allowStartWithoutQuotaSnapshot: true, now: () => new Date(NOW), dispatcher: { execute: async (request) => { dispatches.push(request); return { status: "succeeded" }; } }, notifier: {
    waitingHuman: async (_project, item) => { notifications.push({ kind: "waiting", issueNumber: item.issueNumber }); },
    failure: async (_project, item) => { notifications.push({ kind: "failure", issueNumber: item.issueNumber }); },
  } });
  return { orchestrator, dispatches, executions, notifications };
}

function updateExecution(executions: ExecutionRecord[], id: string, status: ExecutionRecord["status"]): ExecutionRecord {
  const entry = executions.find((candidate) => candidate.id === id);
  assert.ok(entry);
  entry.status = status;
  return entry;
}

test("continues another project when one GitHub issue waits for a human", async () => {
  const { orchestrator, dispatches } = harness([
    work("alpha", 1, "waiting-human", 100),
    work("bravo", 2, "ready", 60),
    work("charlie", 3, "ready", 90),
  ]);
  const result = await orchestrator.runCycle();
  assert.equal(result.outcome, "dispatched", JSON.stringify(result));
  assert.equal(dispatches[0]?.project.id, "charlie");
  assert.equal(dispatches[0]?.work.issueNumber, 3);
});

test("passes only the exact normalized issue and declared skills to the agent", async () => {
  const { orchestrator, dispatches } = harness([work("alpha", 9, "ready", 80)]);
  await orchestrator.runCycle();
  assert.equal(dispatches[0]?.work.issueUrl, "https://github.com/dokor/alpha/issues/9");
  assert.deepEqual(dispatches[0]?.skillPaths, [".agents/skills"]);
  assert.equal(dispatches[0]?.work.state, "ready");
});

test("does not dispatch the same GitHub revision twice after completion", async () => {
  const { orchestrator, dispatches } = harness([work("alpha", 9, "ready", 80)]);
  await orchestrator.runCycle();
  const second = await orchestrator.runCycle();
  assert.equal(second.outcome, "idle");
  assert.equal(dispatches.length, 1);
});

test("a stale GitHub work projection is never dispatched", async () => {
  const stale = { ...work("alpha", 9, "ready", 80), expiresAt: "2026-08-28T09:59:00.000Z" };
  const { orchestrator, dispatches } = harness([stale]);
  const result = await orchestrator.runCycle();
  assert.equal(result.outcome, "idle");
  assert.equal(dispatches.length, 0);
});

test("notifies only once for an unchanged waiting-human GitHub revision", async () => {
  const waiting = { ...work("alpha", 12, "waiting-human", 80), humanDecisionRef: "D12" };
  const { orchestrator, notifications } = harness([waiting]);
  await orchestrator.runCycle();
  await orchestrator.runCycle();
  assert.deepEqual(notifications, [{ kind: "waiting", issueNumber: 12 }]);
});

import type { GithubWorkItemRecord } from "@ade-control-plane/database";
import { createMemoryPersistence, createMemoryState } from "./memoryPersistence.js";
import { NOW, project, quotaSnapshot, runner } from "./fixtures.js";

export function overviewFixture() {
  const state = createMemoryState({
    projects: [project()], runners: [runner({ name: "github-work-local" })], quotaSnapshots: [quotaSnapshot()],
    githubWorkProfiles: [{ projectId: project().id, repositoryGithubId: "123", compatible: true,
      adeStatus: "compatible", contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"],
      skillPaths: [".agents/skills"], reason: "compatible", observedAt: NOW }],
    auditEvents: [{ id: "cycle", category: "worker", action: "worker.cycle-succeeded", occurredAt: NOW,
      severity: "info", actorType: "system", actorRef: null, projectId: null, executionId: null,
      runnerId: null, reason: null, result: "observed", correlationId: null, metadata: { outcome: "idle" } }],
  });
  const persistence = createMemoryPersistence(state);
  return { state, persistence, input: { persistence, now: NOW, quotaProvider: "openai", quotaAccountRef: "codex-account-main", tolerateUnavailable: true } };
}

export function overviewIssue(overrides: Partial<GithubWorkItemRecord> = {}): GithubWorkItemRecord {
  return { id: "work-1", projectId: project().id, repositoryGithubId: "123", contractVersion: "ade.github-work/v1",
    issueNumber: 21, issueUrl: "https://github.com/dokor/argos/issues/21", state: "ready", priority: 50,
    dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: null, branchName: null,
    pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z", present: true,
    ...overrides };
}

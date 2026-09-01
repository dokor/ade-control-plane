import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectRecord } from "@ade-control-plane/database";

import { GithubWorkCodexExecutor } from "../src/GithubWorkCodexExecutor.js";
import type { GithubWorkDispatchRequest } from "../src/GithubWorkOrchestrator.js";

const project: ProjectRecord = {
  id: "project-1",
  slug: "demo",
  name: "Demo",
  repositoryOwner: "dokor",
  repositoryName: "demo",
  repositoryId: "repository-1",
  state: "enabled",
  priority: 1,
  adeAdapter: "github-work",
  runnerPolicy: { labels: ["local"] },
  configuration: { v0: { checkout: "missing-checkout" } },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const request: GithubWorkDispatchRequest = {
  executionId: "execution-1",
  project,
  work: {
    id: "work-1",
    projectId: project.id,
    repositoryGithubId: "repository-1",
    contractVersion: "ade.github-work/v1",
    issueNumber: 139,
    issueUrl: "https://github.com/dokor/ade-control-plane/issues/139",
    state: "ready",
    priority: 1,
    dependsOn: [],
    retryPolicy: "reconcile-first",
    humanDecisionRef: null,
    executionRef: null,
    branchName: null,
    pullRequestNumber: null,
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    observedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T01:00:00.000Z",
    present: true,
  },
  skillPaths: [],
};

test("reports an unavailable GitHub-work checkout with a safe actionable error", async () => {
  const executor = new GithubWorkCodexExecutor({
    projectRoot: "C:/not-a-worker-checkout-root",
    commands: { run: async () => { throw new Error("command execution should not be reached"); } },
    github: {
      getIssueDetails: async () => { throw new Error("GitHub should not be reached"); },
      updateIssueBody: async () => { throw new Error("GitHub should not be reached"); },
      createPullRequest: async () => { throw new Error("GitHub should not be reached"); },
    },
  });

  const result = await executor.execute(request);

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "CHECKOUT_UNAVAILABLE");
  assert.equal(result.errorSummary, "The worker checkout root is unavailable.");
});

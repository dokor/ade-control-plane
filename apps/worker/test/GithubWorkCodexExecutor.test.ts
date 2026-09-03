import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ProjectRecord } from "@ade-control-plane/database";

import { buildGithubWorkPrompt, GithubWorkCodexExecutor, parseImplementationHandoff } from "../src/GithubWorkCodexExecutor.js";
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
      syncAdeWorkflowLabels: async () => { throw new Error("GitHub should not be reached"); },
      createPullRequest: async () => { throw new Error("GitHub should not be reached"); },
    },
  });

  const result = await executor.execute(request);

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "CHECKOUT_UNAVAILABLE");
  assert.equal(result.errorSummary, "The worker checkout root is unavailable.");
});

test("persists admission and planning before touching the checkout", async () => {
  const stages: string[] = [];
  const executor = new GithubWorkCodexExecutor({
    projectRoot: "C:/not-a-worker-checkout-root",
    commands: { run: async () => { throw new Error("command execution should not be reached"); } },
    github: {
      getIssueDetails: async () => { throw new Error("GitHub should not be reached"); },
      updateIssueBody: async () => { throw new Error("GitHub should not be reached"); },
      syncAdeWorkflowLabels: async () => { throw new Error("GitHub should not be reached"); },
      createPullRequest: async () => { throw new Error("GitHub should not be reached"); },
    },
    persistence: {
      deliveryWorkflows: {
        start: async () => ({ id: "workflow-1", stage: "admitted", attempt: 0 }),
        transition: async (input: { stage: string; attempt: number }) => {
          stages.push(input.stage);
          return { id: "workflow-1", stage: input.stage, attempt: input.attempt };
        },
      },
    } as never,
  });

  const result = await executor.execute(request);
  assert.equal(result.errorCode, "CHECKOUT_UNAVAILABLE");
  assert.deepEqual(stages, ["planning"]);
});

test("provisions a missing registered checkout before executing GitHub work", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-github-checkout-recovery-"));
  let provisioned: string | undefined;
  const executor = new GithubWorkCodexExecutor({
    projectRoot: root,
    commands: { run: async () => ({ exitCode: 0, signal: null, stdout: "git@github.com:someone/other-repository.git", stderr: "" }) },
    github: {} as never,
    provisionCheckout: async (selectedProject) => {
      provisioned = selectedProject.id;
      await mkdir(join(root, "missing-checkout"), { recursive: true });
    },
  });

  const result = await executor.execute(request);

  assert.equal(provisioned, project.id);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "REMOTE_MISMATCH");
});

test("restarts a waiting-human workflow without replaying the provider", async () => {
  const executor = new GithubWorkCodexExecutor({
    projectRoot: "C:/not-a-worker-checkout-root",
    commands: { run: async () => { throw new Error("provider must not be replayed"); } },
    github: {} as never,
    persistence: { deliveryWorkflows: {
      start: async () => ({ id: "workflow-1", stage: "waiting-human", attempt: 1, branchName: "ade/issue-139", pullRequestNumber: 91, pullRequestUrl: "https://github.com/dokor/ade-control-plane/pull/91" }),
    } } as never,
  });
  const result = await executor.execute(request);
  assert.equal(result.status, "succeeded");
  assert.equal(result.resultSummary?.pullRequestNumber, 91);
});

test("accepts only an ADE handoff bound to the selected issue revision", () => {
  const issue = { number: request.work.issueNumber, url: request.work.issueUrl, updatedAt: request.work.sourceUpdatedAt };
  const handoff = parseImplementationHandoff({
    version: "ade.implementation-handoff/v1",
    issue,
    objective: "Ship the dashboard workflow.",
    scope: ["Dashboard"],
    acceptanceCriteria: ["A user can start the workflow."],
    constraints: ["Do not expose credentials."],
    humanDecisionRef: null,
  }, issue);

  const prompt = buildGithubWorkPrompt(request, handoff);
  assert.match(prompt, /Ship the dashboard workflow/);
  assert.match(prompt, /validated handoff above is authoritative/);
  assert.doesNotMatch(prompt, /issue URL is the authoritative task reference/);
});

test("rejects a handoff from another issue revision", () => {
  const issue = { number: request.work.issueNumber, url: request.work.issueUrl, updatedAt: request.work.sourceUpdatedAt };
  assert.throws(() => parseImplementationHandoff({
    version: "ade.implementation-handoff/v1",
    issue: { ...issue, updatedAt: "2026-09-01T00:00:01.000Z" },
    objective: "Ship the dashboard workflow.",
    scope: [], acceptanceCriteria: [], constraints: [], humanDecisionRef: null,
  }, issue), /does not match/);
});

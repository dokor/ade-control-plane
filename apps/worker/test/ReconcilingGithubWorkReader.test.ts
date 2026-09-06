import assert from "node:assert/strict";
import test from "node:test";

import {
  readGithubWorkMetadata,
  upsertGithubWorkMetadata,
  type GithubIssueDetails,
  type GithubRepositoryRef,
  type GithubWorkItem,
  type GithubWorkReader,
} from "@ade-control-plane/github";

import { ReconcilingGithubWorkReader } from "../src/ReconcilingGithubWorkReader.js";

const repository: GithubRepositoryRef = { id: "repo-1", owner: "dokor", name: "demo" };
const now = "2026-09-06T12:00:00.000Z";

function fixture(options: { merged: boolean; headRef?: string }) {
  let body = upsertGithubWorkMetadata("Issue", {
    state: "waiting-human",
    priority: 50,
    dependsOn: [],
    retryPolicy: "reconcile-first",
    humanDecisionRef: "merge-review",
    executionRef: "execution-1",
    branchName: "ade/issue-253",
    pullRequestNumber: 258,
  });
  let labels = ["waiting-human", "pr-ready"];
  let workflowStage = "waiting-human";
  let transitionCount = 0;
  let pullReadCount = 0;

  const issue = (): GithubIssueDetails => ({
    number: 253,
    title: "Issue",
    body,
    labels,
    state: "closed",
    url: "https://github.com/dokor/demo/issues/253",
    updatedAt: now,
  });
  const item = (): GithubWorkItem => {
    const metadata = readGithubWorkMetadata(body)!;
    return {
      contractVersion: "ade.github-work/v1",
      repository,
      issueNumber: 253,
      issueUrl: "https://github.com/dokor/demo/issues/253",
      state: metadata.state,
      priority: metadata.priority,
      dependsOn: metadata.dependsOn,
      retryPolicy: metadata.retryPolicy,
      humanDecisionRef: metadata.humanDecisionRef,
      executionRef: metadata.executionRef,
      branchName: metadata.branchName,
      pullRequestNumber: metadata.pullRequestNumber,
      sourceUpdatedAt: now,
      observedAt: now,
      expiresAt: "2026-09-06T12:05:00.000Z",
    };
  };
  const source: GithubWorkReader = {
    detectRepository: async () => ({ repository, compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [], observedAt: now, reason: "compatible" }),
    getWorkItem: async () => item(),
    listWorkItems: async () => [item()],
  };
  const reader = new ReconcilingGithubWorkReader({
    reader: source,
    pullRequests: { get: async () => {
      pullReadCount += 1;
      return { number: 258, state: "closed", merged: options.merged, headRef: options.headRef ?? "ade/issue-253", baseRef: "main" };
    } },
    lifecycle: {
      getIssueDetails: async () => issue(),
      updateIssueBody: async (_repo, _number, nextBody) => { body = nextBody; return issue(); },
      syncAdeWorkflowLabels: async (_repo, _number, nextLabels) => { labels = [...nextLabels]; return issue(); },
    },
    persistence: { deliveryWorkflows: {
      getByExecutionId: async () => ({ id: "workflow-1", stage: workflowStage, attempt: 0, pullRequestNumber: 258, pullRequestUrl: "https://github.com/dokor/demo/pull/258", branchName: "ade/issue-253" }),
      transition: async (input: { stage: string }) => { workflowStage = input.stage; transitionCount += 1; return { id: "workflow-1", stage: workflowStage }; },
    } } as never,
    now: () => new Date(now),
  });
  return { reader, state: () => ({ body, labels, workflowStage, transitionCount, pullReadCount }) };
}

test("periodic reconciliation completes a correlated merged ADE pull request", async () => {
  const { reader, state } = fixture({ merged: true });
  const [work] = await reader.listWorkItems(repository);

  assert.equal(work?.state, "completed");
  assert.equal(readGithubWorkMetadata(state().body)?.state, "completed");
  assert.equal(readGithubWorkMetadata(state().body)?.humanDecisionRef, null);
  assert.equal(state().workflowStage, "completed");
  assert.equal(state().transitionCount, 1);
  assert.ok(!state().labels.includes("waiting-human"));
  assert.ok(!state().labels.includes("pr-ready"));
});

test("closed-unmerged and branch-mismatched pull requests never complete work", async () => {
  for (const input of [{ merged: false }, { merged: true, headRef: "other-branch" }]) {
    const { reader, state } = fixture(input);
    const [work] = await reader.listWorkItems(repository);
    assert.equal(work?.state, "waiting-human");
    assert.equal(state().workflowStage, "waiting-human");
    assert.equal(state().transitionCount, 0);
  }
});

test("merged PR reconciliation is idempotent after completion", async () => {
  const { reader, state } = fixture({ merged: true });
  await reader.listWorkItems(repository);
  await reader.listWorkItems(repository);

  assert.equal(state().transitionCount, 1);
  assert.equal(state().pullReadCount, 1);
});

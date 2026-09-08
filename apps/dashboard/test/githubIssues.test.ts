import assert from "node:assert/strict";
import test from "node:test";

import { listGithubIssues, listProjectGithubIssueQueue, listReadyGithubIssues } from "../src/lib/githubIssues.js";
import { NOW, project } from "./helpers/fixtures.js";

test("lists open repository issues without requiring ADE metadata", async () => {
  const result = await listGithubIssues(project(), {
    issueReader: {
      listIssues: async () => [
        { number: 25, title: "Ordinary issue", state: "open", url: "https://github.com/dokor/argos/issues/25", updatedAt: NOW },
        { number: 26, title: "Closed issue", state: "closed", url: "https://github.com/dokor/argos/issues/26", updatedAt: NOW },
      ],
      getIssue: async () => null,
    },
  });

  assert.deepEqual(result.map(({ number }) => number), [25]);
  assert.equal(result[0]?.adeState, null);
  assert.equal(result[0]?.priority, null);
});

test("keeps ordinary open issues admissible while readiness stays a separate projection", async () => {
  const result = await listGithubIssues(project(), {
    issueReader: {
      listIssues: async () => [{ number: 29, title: "Needs ADE preparation", state: "open", url: "https://github.com/dokor/argos/issues/29", updatedAt: NOW }],
      getIssue: async () => null,
    },
  });
  assert.deepEqual(result, [{ number: 29, title: "Needs ADE preparation", state: "open", url: "https://github.com/dokor/argos/issues/29", updatedAt: NOW, adeState: null, priority: null }]);
});

test("returns only open ADE-managed ready issues", async () => {
  const result = await listReadyGithubIssues(project(), {
    issueReader: {
      listIssues: async () => { throw new Error("The full issue list must not be requested."); },
      getIssue: async (_repository, issueNumber) => issueNumber === 23
        ? { number: 23, title: "Ready issue", state: "open", url: "https://github.com/dokor/argos/issues/23", updatedAt: NOW }
        : { number: 24, title: "Closed issue", state: "closed", url: "https://github.com/dokor/argos/issues/24", updatedAt: NOW },
    },
    workReader: {
      detectRepository: async () => { throw new Error("unused"); },
      listWorkItems: async () => [
        {
          contractVersion: "ade.github-work/v1",
          repository: { id: "123", owner: "dokor", name: "argos" },
          issueNumber: 23,
          issueUrl: "https://github.com/dokor/argos/issues/23",
          state: "ready",
          priority: 90,
          dependsOn: [],
          retryPolicy: "reconcile-first",
          humanDecisionRef: null,
          executionRef: null,
          branchName: null,
          pullRequestNumber: null,
          sourceUpdatedAt: NOW,
          observedAt: NOW,
          expiresAt: NOW,
        },
        {
          contractVersion: "ade.github-work/v1",
          repository: { id: "123", owner: "dokor", name: "argos" },
          issueNumber: 24,
          issueUrl: "https://github.com/dokor/argos/issues/24",
          state: "ready",
          priority: 100,
          dependsOn: [],
          retryPolicy: "reconcile-first",
          humanDecisionRef: null,
          executionRef: null,
          branchName: null,
          pullRequestNumber: null,
          sourceUpdatedAt: NOW,
          observedAt: NOW,
          expiresAt: NOW,
        },
      ],
      getWorkItem: async () => null,
    },
  });

  assert.deepEqual(result.map(({ number }) => number), [23]);
  assert.equal(result[0]?.title, "Ready issue");
});

test("joins live issue details with durable queue intent while keeping stale work visible", async () => {
  const result = await listProjectGithubIssueQueue(project(), {
    issueReader: {
      listIssues: async () => [
        { number: 31, title: "First in the queue", state: "open", url: "https://github.com/dokor/argos/issues/31", updatedAt: NOW, excerpt: "A concise, safe description." },
        { number: 32, title: "Held stale work", state: "open", url: "https://github.com/dokor/argos/issues/32", updatedAt: NOW },
      ],
      getIssue: async () => null,
    },
  }, [
    { id: "work-31", projectId: "11111111-1111-4111-8111-111111111111", repositoryGithubId: "123", contractVersion: "ade.github-work/v1", issueNumber: 31, issueUrl: "https://github.com/dokor/argos/issues/31", state: "ready", priority: 10, dependsOn: [], retryPolicy: "safe", humanDecisionRef: null, executionRef: null, branchName: null, pullRequestNumber: 14, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T11:00:00.000Z", present: true },
    { id: "work-32", projectId: "11111111-1111-4111-8111-111111111111", repositoryGithubId: "123", contractVersion: "ade.github-work/v1", issueNumber: 32, issueUrl: "https://github.com/dokor/argos/issues/32", state: "ready", priority: 100, dependsOn: [], retryPolicy: "safe", humanDecisionRef: null, executionRef: null, branchName: null, pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T09:00:00.000Z", present: true },
  ], [
    { projectId: "11111111-1111-4111-8111-111111111111", issueNumber: 31, runWhenAvailable: true, queuePosition: 1, updatedAt: NOW, updatedBy: "operator" },
    { projectId: "11111111-1111-4111-8111-111111111111", issueNumber: 32, runWhenAvailable: false, queuePosition: null, updatedAt: NOW, updatedBy: "operator" },
  ], NOW);

  assert.deepEqual(result.map(({ number }) => number), [31, 32]);
  assert.equal(result[0]?.description, "A concise, safe description.");
  assert.equal(result[0]?.pullRequestUrl, "https://github.com/dokor/argos/pull/14");
  assert.equal(result[1]?.projectionState, "stale");
  assert.equal(result[1]?.runWhenAvailable, false);
});

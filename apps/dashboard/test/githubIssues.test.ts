import assert from "node:assert/strict";
import test from "node:test";

import { listGithubIssues, listReadyGithubIssues } from "../src/lib/githubIssues.js";
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

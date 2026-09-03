import assert from "node:assert/strict";
import test from "node:test";

import { toGithubWorkApiView } from "../src/app/api/tasks/github/[projectId]/[issueNumber]/route.js";

test("GitHub workflow API projection excludes raw project and issue content", () => {
  const view = toGithubWorkApiView({
    project: {
      id: "project-1",
      name: "Demo",
      repositoryOwner: "dokor",
      repositoryName: "demo",
      configuration: { secret: "must-not-leak" },
    } as never,
    work: {
      issueNumber: 153,
      issueUrl: "https://github.com/dokor/demo/issues/153",
      sourceUpdatedAt: "2026-09-03T00:00:00.000Z",
      state: "waiting-human",
    } as never,
    workflow: {
      id: "workflow-1",
      stage: "waiting-human",
      branchName: "ade/issue-153",
      headSha: "abc123",
      pullRequestNumber: 166,
      pullRequestUrl: "http://not-github.example/pull/166",
      reconciliationRequired: false,
    } as never,
    execution: {
      id: "execution-1",
      status: "succeeded",
      attempt: 1,
      errorCode: null,
      errorSummary: null,
      cancelRequested: false,
    } as never,
    transitions: [],
    heartbeatAt: null,
    deadlineAt: null,
    decision: null,
    provenance: { runtime: "ade-test" },
    validationSummary: "passed",
    reviewSummary: "passed",
    events: [],
    firstFailure: null,
    stageLabel: "Waiting for human",
    nextAction: "Review the pull request.",
  });

  assert.equal("configuration" in view.project, false);
  assert.equal("body" in view.issue, false);
  assert.equal(view.workflow?.pullRequestUrl, null);
  assert.equal(view.workflow?.branchName, "ade/issue-153");
});

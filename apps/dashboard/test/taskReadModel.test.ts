import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRecord, GithubWorkItemRecord, V0TaskRecord } from "@ade-control-plane/database";

import {
  buildTaskDashboard,
  buildTaskDetail,
  buildTaskTimeline,
  safePullRequestUrl,
} from "../src/lib/taskReadModel.js";
import { NOW, project } from "./helpers/fixtures.js";
import {
  createMemoryPersistence,
  createMemoryState,
} from "./helpers/memoryPersistence.js";

const TASK_ID = "66666666-6666-4666-8666-666666666666";

test("uses task-correlated audit diagnostics when raw logs are unavailable", async () => {
  const state = createMemoryState({ projects: [project()], v0Tasks: [task({ status: "FAILED", errorCode: "GIT_CLONE_FAILED" })] });
  const persistence = createMemoryPersistence(state);
  await persistence.auditEvents.append({ occurredAt: NOW, category: "task", action: "task.execution.failed", severity: "error",
    actorType: "system", actorRef: "v0-worker", projectId: project().id, correlationId: TASK_ID, result: "failed",
    metadata: { event: "task.execution.failed", taskId: TASK_ID, code: "GIT_CLONE_FAILED", stage: "Provision checkout", stderr: "repository not found" } });
  const detail = await buildTaskDetail(persistence, TASK_ID);
  assert.equal(detail?.diagnostic?.code, "GIT_CLONE_FAILED");
  assert.equal(detail?.diagnostic?.stage, "Provision checkout");
  state.auditEvents[0]!.correlationId = "other-task";
  assert.equal((await buildTaskDetail(persistence, TASK_ID))?.diagnostic, null);
});

test("only system logs can supply structured diagnostics and their stage reaches the timeline", async () => {
  const message = JSON.stringify({ event: "task.execution.failed", taskId: TASK_ID, code: "GIT_CLONE_FAILED", stage: "Provision checkout" });
  const state = createMemoryState({ projects: [project()], v0Tasks: [task({ status: "FAILED" })],
    v0TaskLogs: [{ id: "1", taskId: TASK_ID, occurredAt: NOW, stream: "stdout", message }] });
  const persistence = createMemoryPersistence(state);
  assert.equal((await buildTaskDetail(persistence, TASK_ID))?.diagnostic, null);
  state.v0TaskLogs[0]!.stream = "system";
  const detail = await buildTaskDetail(persistence, TASK_ID);
  assert.equal(detail?.diagnostic?.code, "GIT_CLONE_FAILED");
  assert.ok(detail?.timeline.some((item) => item.title === "Provision checkout: GIT_CLONE_FAILED"));
});

function task(overrides: Partial<V0TaskRecord> = {}): V0TaskRecord {
  return {
    id: TASK_ID,
    projectId: project().id,
    source: { type: "prompt", prompt: "Update the release notes." },
    prompt: "Update the release notes.",
    status: "SUCCESS",
    cancelRequested: false,
    branchName: "codex/release-notes",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/dokor/argos/pull/42",
    errorCode: null,
    errorSummary: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("builds the task runway with enabled projects and the active slot", async () => {
  const pausedProject = project({
    id: "77777777-7777-4777-8777-777777777777",
    name: "Paused",
    state: "paused",
  });
  const active = task({ status: "RUNNING", finishedAt: null });
  const persistence = createMemoryPersistence(createMemoryState({
    projects: [pausedProject, project()],
    v0Tasks: [task(), active],
  }));

  const dashboard = await buildTaskDashboard(persistence);

  assert.deepEqual(dashboard.projects.map(({ name }) => name), ["Argos"]);
  assert.equal(dashboard.activeTask?.id, TASK_ID);
  assert.equal(dashboard.activeTask?.repository, "dokor/argos");
  assert.equal(dashboard.tasks.length, 2);
});

test("shows a persisted GitHub work execution in the Task runway", async () => {
  const githubWork: GithubWorkItemRecord = {
    id: "github-work-1", projectId: project().id, repositoryGithubId: "argos", contractVersion: "ade.github-work/v1",
    issueNumber: 136, issueUrl: "https://github.com/dokor/argos/issues/136", state: "running", priority: 50,
    dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: "execution-1",
    branchName: "ade/issue-136", pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T11:00:00.000Z", present: true,
  };
  const execution: ExecutionRecord = {
    id: "execution-1", projectId: project().id, runnerId: "runner-1", adeExecutionRef: null, workRef: "github:issue:136",
    capability: "github-work.codex", status: "running", attempt: 1, requestedAt: NOW, startedAt: NOW, finishedAt: null,
    resultSummary: null, errorCode: null, errorSummary: null, createdAt: NOW, updatedAt: NOW,
  };
  const dashboard = await buildTaskDashboard(createMemoryPersistence(createMemoryState({
    projects: [project()], githubWorkItems: [githubWork], executions: [execution],
  })));

  assert.equal(dashboard.activeTask, null);
  assert.equal(dashboard.activeGithubWork?.issueNumber, 136);
  assert.equal(dashboard.activeGithubWork?.stage, "Developing");
  assert.equal(dashboard.githubWork[0]?.executionStatus, "running");
});

test("uses the GitHub issue title for task list items when available", async () => {
  const issueTask = task({
    source: { type: "github-issue", issueNumber: 23 },
    prompt: "Implement GitHub issue #23",
  });
  const dashboard = await buildTaskDashboard(
    createMemoryPersistence(createMemoryState({
      projects: [project()],
      v0Tasks: [issueTask],
    })),
    {
      async getIssue() {
        return {
          number: 23,
          title: "Improve the task runway",
          state: "open",
          url: "https://github.com/dokor/argos/issues/23",
          updatedAt: NOW,
        };
      },
    },
  );

  assert.equal(dashboard.tasks[0]?.title, "Improve the task runway");
});

test("falls back to the issue reference when GitHub title lookup fails", async () => {
  const issueTask = task({
    source: { type: "github-issue", issueNumber: 23 },
    prompt: "Implement GitHub issue #23",
  });
  const dashboard = await buildTaskDashboard(
    createMemoryPersistence(createMemoryState({
      projects: [project()],
      v0Tasks: [issueTask],
    })),
    {
      async getIssue() {
        throw new Error("GitHub unavailable");
      },
    },
  );

  assert.equal(dashboard.tasks[0]?.title, "GitHub issue #23");
});

test("sanitizes persisted task output before rendering detail", async () => {
  const state = createMemoryState({
    projects: [project()],
    v0Tasks: [task({
      prompt: "Use token=github_pat_12345678901234567890 for the request",
      status: "FAILED",
      errorCode: "CODEX_FAILED",
      errorSummary: "Failed in C:\\Users\\runner\\workspace",
    })],
    v0TaskLogs: [{
      id: "1",
      taskId: TASK_ID,
      occurredAt: NOW,
      stream: "stderr",
      message: "Authorization: secret-value",
    }],
  });

  const detail = await buildTaskDetail(createMemoryPersistence(state), TASK_ID);

  assert.ok(detail);
  assert.doesNotMatch(detail.task.prompt, /github_pat_/);
  assert.doesNotMatch(detail.task.errorSummary ?? "", /Users/);
  assert.doesNotMatch(detail.logs[0]?.message ?? "", /secret-value/);
  assert.equal(detail.summary.status, "failed");
  assert.equal(detail.summary.firstFailure?.status, "failed");
});

test("turns system logs into a chronological execution history", () => {
  const failedTask = task({
    status: "FAILED",
    finishedAt: "2026-08-27T10:00:06.000Z",
    errorCode: "TESTS_FAILED",
    errorSummary: "A test command failed.",
  });
  const timeline = buildTaskTimeline(failedTask, [
    { id: "1", taskId: TASK_ID, occurredAt: "2026-08-27T10:00:01.000Z", stream: "system", message: "git fetch started." },
    { id: "2", taskId: TASK_ID, occurredAt: "2026-08-27T10:00:02.000Z", stream: "stdout", message: "Already up to date." },
    { id: "3", taskId: TASK_ID, occurredAt: "2026-08-27T10:00:03.000Z", stream: "system", message: "git fetch passed." },
    { id: "4", taskId: TASK_ID, occurredAt: "2026-08-27T10:00:04.000Z", stream: "system", message: "Task failed: A test command failed." },
  ]);

  assert.deepEqual(
    timeline.map(({ title, status }) => ({ title, status })),
    [
      { title: "Execution started", status: "running" },
      { title: "Fetch base branch", status: "running" },
      { title: "Fetch base branch", status: "success" },
      { title: "Execution stopped with an error", status: "failed" },
      { title: "Task failed", status: "failed" },
    ],
  );
  assert.equal(timeline.filter(({ status }) => status === "failed").length, 2);
});

test("renders pull request links only for HTTPS GitHub URLs", () => {
  assert.equal(
    safePullRequestUrl("https://github.com/dokor/argos/pull/42"),
    "https://github.com/dokor/argos/pull/42",
  );
  assert.equal(safePullRequestUrl("http://github.com/dokor/argos/pull/42"), null);
  assert.equal(safePullRequestUrl("https://github.com.evil.test/pull/42"), null);
  assert.equal(safePullRequestUrl("javascript:alert(1)"), null);
});

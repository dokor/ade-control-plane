import assert from "node:assert/strict";
import test from "node:test";

import type { V0TaskRecord } from "@ade-control-plane/database";

import {
  buildTaskDashboard,
  buildTaskDetail,
  safePullRequestUrl,
} from "../src/lib/taskReadModel.js";
import { NOW, project } from "./helpers/fixtures.js";
import {
  createMemoryPersistence,
  createMemoryState,
} from "./helpers/memoryPersistence.js";

const TASK_ID = "66666666-6666-4666-8666-666666666666";

function task(overrides: Partial<V0TaskRecord> = {}): V0TaskRecord {
  return {
    id: TASK_ID,
    projectId: project().id,
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

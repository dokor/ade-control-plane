import assert from "node:assert/strict";
import test from "node:test";
import { createTask, taskDetail } from "../src/lib/tasks.js";
import { createMemoryPersistence, createMemoryState } from "./helpers/memoryPersistence.js";

const projectId = "11111111-1111-4111-8111-111111111111";
function context() {
  const state = createMemoryState({
    projects: [{
      id: projectId,
      slug: "alpha",
      name: "Alpha",
      repositoryOwner: "dokor",
      repositoryName: "alpha",
      repositoryId: null,
      state: "enabled",
      priority: 50,
      adeAdapter: "local",
      runnerPolicy: {},
      configuration: {},
      createdAt: "2026-08-27T10:00:00.000Z",
      updatedAt: "2026-08-27T10:00:00.000Z",
    }],
  });
  return { state, persistence: createMemoryPersistence(state) };
}

test("creates one task for a registered project and rejects another active task", async () => {
  const { persistence } = context();
  const task = await createTask(
    persistence,
    { projectId, prompt: "Implement the endpoint" },
    "2026-08-27T10:00:00.000Z",
  );
  assert.equal(task.status, "PENDING");
  await assert.rejects(() => createTask(persistence, { projectId, prompt: "Second" }), /CONFLICT/);
});

test("sanitizes bounded logs returned by task detail", async () => {
  const { state, persistence } = context();
  const task = await createTask(persistence, { projectId, prompt: "Run" });
  state.v0TaskLogs.push({
    id: "raw-log",
    taskId: task.id,
    occurredAt: "2026-08-27T10:00:00.000Z",
    stream: "stderr",
    message: "authorization=github_pat_abcdefghijk123456",
  });
  const detail = await taskDetail(persistence, task.id);
  assert.doesNotMatch(detail.logs[0]?.message ?? "", /github_pat_/);
  assert.match(detail.logs[0]?.message ?? "", /redacted/);
});

test("persists a GitHub issue source without copying issue content into the task prompt", async () => {
  const { persistence } = context();
  const task = await createTask(
    persistence,
    { projectId, source: { type: "github-issue", issueNumber: 23 } },
  );
  assert.deepEqual(task.source, { type: "github-issue", issueNumber: 23 });
  assert.equal(task.prompt, "Implement GitHub issue #23");
});

test("creates an explicit ADE initialization task", async () => {
  const { persistence } = context();
  const task = await createTask(
    persistence,
    { projectId, source: { type: "ade-initialize" } },
  );
  assert.deepEqual(task.source, { type: "ade-initialize" });
  assert.match(task.prompt, /^Initialize ADE for this repository/);
});

test("rejects malformed GitHub issue sources at the API boundary", async () => {
  const { persistence } = context();
  await assert.rejects(
    () => createTask(persistence, {
      projectId,
      source: { type: "github-issue", issueNumber: 0 },
    }),
    /INVALID_COMMAND/,
  );
});

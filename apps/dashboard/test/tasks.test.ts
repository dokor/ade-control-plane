import assert from "node:assert/strict";
import test from "node:test";
import { appendSanitizedTaskLog, createTask, taskDetail } from "../src/lib/tasks.js";
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
  const { persistence } = context();
  const task = await createTask(persistence, { projectId, prompt: "Run" });
  await appendSanitizedTaskLog(persistence, task.id, "stderr", "authorization=github_pat_abcdefghijk123456");
  const detail = await taskDetail(persistence, task.id);
  assert.doesNotMatch(detail.logs[0]?.message ?? "", /github_pat_/);
  assert.match(detail.logs[0]?.message ?? "", /redacted/);
});

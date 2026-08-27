import assert from "node:assert/strict";
import test from "node:test";
import { ActiveTaskConflictError } from "../src/index.js";
import { createTestStore } from "./helpers/postgres.js";

if (!process.env.TEST_DATABASE_URL) {
  test.skip("PostgreSQL V0 task tests require TEST_DATABASE_URL.", () => {});
} else {
  test("enforces one active V0 task and persists lifecycle/logs", async () => {
    const context = await createTestStore();
    try {
      const project = await context.store.projects.register({
        adeAdapter: "local",
        name: "Alpha",
        priority: 50,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        slug: "alpha",
      });
      const first = await context.store.v0Tasks.create({
        projectId: project.id,
        prompt: "First",
        createdAt: new Date().toISOString(),
      });
      await assert.rejects(
        () => context.store.v0Tasks.create({
          projectId: project.id,
          prompt: "Second",
          createdAt: new Date().toISOString(),
        }),
        ActiveTaskConflictError,
      );
      const claimed = await context.store.v0Tasks.claimPending(
        new Date().toISOString(),
      );
      assert.equal(claimed?.status, "RUNNING");
      await context.store.v0Tasks.appendLog({
        taskId: first.id,
        occurredAt: new Date().toISOString(),
        stream: "stdout",
        message: "authorization=github_pat_abcdefghijk123456",
      });
      const cancelled = await context.store.v0Tasks.requestCancel(
        first.id,
        new Date().toISOString(),
      );
      assert.equal(cancelled.cancelRequested, true);
      assert.equal(cancelled.status, "RUNNING");
      const logs = await context.store.v0Tasks.listLogs(first.id, 10);
      assert.equal(logs.length, 1);
      assert.doesNotMatch(logs[0]?.message ?? "", /github_pat_/);
      const completed = await context.store.v0Tasks.complete({
        taskId: first.id,
        status: "CANCELLED",
        finishedAt: new Date().toISOString(),
      });
      assert.equal(completed.status, "CANCELLED");
    } finally {
      await context.close();
    }
  });
}

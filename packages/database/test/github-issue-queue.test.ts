import assert from "node:assert/strict";
import test from "node:test";

import { createTestStore } from "./helpers/postgres.js";

const NOW = "2026-09-08T10:00:00.000Z";
const enabled = Boolean(process.env.TEST_DATABASE_URL);

test("persists queue opt-in and an atomically reordered explicit sequence across a store restart", { skip: !enabled }, async () => {
  const context = await createTestStore();
  try {
    const project = await context.store.projects.register({ slug: "queue", name: "Queue", repositoryOwner: "dokor", repositoryName: "queue", adeAdapter: "github-work", priority: 50 });
    await context.store.githubWork.setQueuePreference({ projectId: project.id, issueNumber: 11, runWhenAvailable: true, actorRef: "operator:test", occurredAt: NOW });
    await context.store.githubWork.setQueuePreference({ projectId: project.id, issueNumber: 12, runWhenAvailable: true, actorRef: "operator:test", occurredAt: NOW });
    await context.store.githubWork.reorderQueue({ projectId: project.id, issueNumbers: [12, 11], actorRef: "operator:test", occurredAt: NOW });
    await context.store.githubWork.setQueuePreference({ projectId: project.id, issueNumber: 12, runWhenAvailable: false, actorRef: "operator:test", occurredAt: NOW });

    const reopened = context.reopenStore();
    try {
      assert.deepEqual(await reopened.githubWork.listQueuePreferences(project.id), [
        { projectId: project.id, issueNumber: 11, runWhenAvailable: true, queuePosition: 2, updatedAt: NOW, updatedBy: "operator:test" },
        { projectId: project.id, issueNumber: 12, runWhenAvailable: false, queuePosition: null, updatedAt: NOW, updatedBy: "operator:test" },
      ]);
    } finally {
      await reopened.close();
    }
  } finally {
    await context.close();
  }
});

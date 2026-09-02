import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createTestStore } from "./helpers/postgres.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test.skip("PostgreSQL integration tests require TEST_DATABASE_URL.", () => {});
} else {
  test("persists projects across store restart and state changes", async () => {
    const context = await createTestStore();

    try {
      const projectAlpha = await context.store.projects.register({
        adeAdapter: "local-cli",
        configuration: {
          projectRoot: "/srv/projects/alpha",
        },
        name: "Alpha",
        priority: 90,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        runnerPolicy: {
          requiredRunnerLabels: ["pi"],
        },
        slug: "alpha",
      });
      const projectBeta = await context.store.projects.register({
        adeAdapter: "local-cli",
        name: "Beta",
        priority: 50,
        repositoryName: "beta",
        repositoryOwner: "dokor",
        slug: "beta",
      });

      await context.store.projects.updateState(projectAlpha.id, "paused");
      await context.store.projects.updatePriority(projectBeta.id, 80);
      await context.store.close();

      const reopenedStore = context.reopenStore();
      try {
        const projects = await reopenedStore.projects.list();
        assert.equal(projects.length, 2);

        const reopenedAlpha = projects.find(({ id }) => id === projectAlpha.id);
        const reopenedBeta = projects.find(({ id }) => id === projectBeta.id);
        assert.ok(reopenedAlpha);
        assert.ok(reopenedBeta);
        assert.equal(reopenedAlpha.state, "paused");
        assert.equal(reopenedBeta.priority, 80);
      } finally {
        await reopenedStore.close();
      }
    } finally {
      await context.close();
    }
  });

  test("prevents two workers from acquiring the same active lease", async () => {
    const context = await createTestStore();

    try {
      const project = await context.store.projects.register({
        adeAdapter: "local-cli",
        name: "Alpha",
        priority: 100,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        slug: "alpha",
      });

      const runner = await context.store.runners.register({
        architecture: "arm64",
        kind: "raspberry-local",
        name: "pi-5",
      });

      const ownerOne = "worker-a";
      const ownerTwo = "worker-b";
      const leaseKey = "project:alpha/work:123";
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();

      const storeTwo = context.reopenStore();
      try {
        const [first, second] = await Promise.all([
          context.store.executions.scheduleWithLease({
            execution: {
              capability: "ade.advance",
              projectId: project.id,
              requestedAt: now,
              runnerId: runner.id,
              workRef: "work-123",
            },
            lease: {
              acquiredAt: now,
              expiresAt,
              heartbeatAt: now,
              leaseKey,
              ownerId: ownerOne,
              projectId: project.id,
              runnerId: runner.id,
            },
          }),
          storeTwo.executions.scheduleWithLease({
            execution: {
              capability: "ade.advance",
              projectId: project.id,
              requestedAt: now,
              runnerId: runner.id,
              workRef: "work-123",
            },
            lease: {
              acquiredAt: now,
              expiresAt,
              heartbeatAt: now,
              leaseKey,
              ownerId: ownerTwo,
              projectId: project.id,
              runnerId: runner.id,
            },
          }),
        ]);

        const acquired = [first, second].filter((result) => result !== null);
        assert.equal(acquired.length, 1);

        const activeLease = await context.store.executionLeases.getActiveByLeaseKey(
          leaseKey,
        );
        assert.ok(activeLease);
        assert.ok(
          activeLease.ownerId === ownerOne || activeLease.ownerId === ownerTwo,
        );
      } finally {
        await storeTwo.close();
      }
    } finally {
      await context.close();
    }
  });

  test("persists idempotent ADE delivery stage transitions", async () => {
    const context = await createTestStore();
    try {
      const now = new Date().toISOString();
      const project = await context.store.projects.register({
        adeAdapter: "github-work", name: "Workflow", priority: 50,
        repositoryName: "workflow", repositoryOwner: "dokor", slug: "workflow",
      });
      const scheduled = await context.store.executions.scheduleWithLease({
        execution: { capability: "github-work.codex", projectId: project.id, requestedAt: now, workRef: "github:issue:146" },
        lease: { acquiredAt: now, expiresAt: new Date(Date.parse(now) + 60_000).toISOString(), heartbeatAt: now, leaseKey: "workflow:146", ownerId: "worker", projectId: project.id },
      });
      assert.ok(scheduled);

      const workflow = await context.store.deliveryWorkflows!.start({
        executionId: scheduled.execution.id, projectId: project.id, issueNumber: 146,
        sourceUpdatedAt: now, occurredAt: now, adePlan: { version: "ade.issue-lifecycle/v1" },
      });
      const transitioned = await context.store.deliveryWorkflows!.transition({
        workflowId: workflow.id, expectedStage: "admitted", stage: "planning", attempt: 0,
        reason: "ADE plan accepted", idempotencyKey: "plan:source-revision", occurredAt: now,
      });
      const replayed = await context.store.deliveryWorkflows!.transition({
        workflowId: workflow.id, expectedStage: "admitted", stage: "planning", attempt: 0,
        reason: "ADE plan accepted", idempotencyKey: "plan:source-revision", occurredAt: now,
      });

      assert.equal(transitioned.stage, "planning");
      assert.equal(replayed.stage, "planning");
      assert.equal((await context.store.deliveryWorkflows!.listTransitions(workflow.id)).length, 2);
    } finally {
      await context.close();
    }
  });

  test("returns stale leases as reconciliation candidates", async () => {
    const context = await createTestStore();

    try {
      const project = await context.store.projects.register({
        adeAdapter: "local-cli",
        name: "Alpha",
        priority: 100,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        slug: "alpha",
      });

      const scheduled = await context.store.executions.scheduleWithLease({
        execution: {
          capability: "ade.advance",
          projectId: project.id,
          requestedAt: new Date(Date.now() - 120_000).toISOString(),
          workRef: "work-123",
        },
        lease: {
          acquiredAt: new Date(Date.now() - 120_000).toISOString(),
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
          leaseKey: "project:alpha/work:123",
          ownerId: "worker-a",
          projectId: project.id,
        },
      });

      assert.ok(scheduled);
      const candidates = await context.store.executions.listReconciliationCandidates(
        new Date().toISOString(),
      );

      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.reason, "stale-lease");
      assert.equal(candidates[0]?.execution.id, scheduled.execution.id);
    } finally {
      await context.close();
    }
  });

  test("keeps duplicate completion idempotent and emits audit once", async () => {
    const context = await createTestStore();

    try {
      const project = await context.store.projects.register({
        adeAdapter: "local-cli",
        name: "Alpha",
        priority: 100,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        slug: "alpha",
      });

      const scheduled = await context.store.executions.scheduleWithLease({
        execution: {
          capability: "ade.advance",
          projectId: project.id,
          requestedAt: new Date().toISOString(),
          workRef: "work-456",
        },
        lease: {
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          heartbeatAt: new Date().toISOString(),
          leaseKey: "project:alpha/work:456",
          ownerId: "worker-a",
          projectId: project.id,
        },
      });

      assert.ok(scheduled);
      const finishedAt = new Date().toISOString();
      const completionPayload = {
        auditEvent: {
          action: "execution.completed",
          actorType: "system",
          category: "execution",
          correlationId: randomUUID(),
          metadata: {
            terminalStatus: "succeeded",
          },
          occurredAt: finishedAt,
          projectId: project.id,
          result: "succeeded",
          severity: "info",
        },
        executionId: scheduled.execution.id,
        finishedAt,
        releaseReason: "runner-reported-completion",
        resultSummary: {
          summary: "done",
        },
        status: "succeeded" as const,
      };

      const first = await context.store.executions.complete(completionPayload);
      const second = await context.store.executions.complete(completionPayload);
      const auditEvents = await context.store.auditEvents.listForExecution(
        scheduled.execution.id,
      );

      assert.equal(first.applied, true);
      assert.equal(first.releasedLease, true);
      assert.equal(second.applied, false);
      assert.equal(second.releasedLease, false);
      assert.equal(auditEvents.length, 1);
    } finally {
      await context.close();
    }
  });

  test("deduplicates control commands by source and idempotency key", async () => {
    const context = await createTestStore();

    try {
      const project = await context.store.projects.register({
        adeAdapter: "local-cli",
        name: "Alpha",
        priority: 100,
        repositoryName: "alpha",
        repositoryOwner: "dokor",
        slug: "alpha",
      });

      const first = await context.store.controlCommands.recordReceipt({
        actorRef: "12345",
        actorType: "github-user",
        commandType: "project.pause",
        idempotencyKey: "delivery-1:comment-1:project.pause",
        payload: {
          reason: "maintenance",
        },
        projectId: project.id,
        receivedAt: new Date().toISOString(),
        source: "github",
      });

      const second = await context.store.controlCommands.recordReceipt({
        actorRef: "12345",
        actorType: "github-user",
        commandType: "project.pause",
        idempotencyKey: "delivery-1:comment-1:project.pause",
        payload: {
          reason: "maintenance",
        },
        projectId: project.id,
        receivedAt: new Date().toISOString(),
        source: "github",
      });

      assert.equal(first.id, second.id);
      assert.equal(first.status, "received");
      assert.equal(second.status, "received");
    } finally {
      await context.close();
    }
  });
}

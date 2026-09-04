import assert from "node:assert/strict";
import test from "node:test";
import type { GithubWorkItemInput, ScheduleExecutionWithLeaseInput } from "../src/index.js";
import { createTestStore } from "./helpers/postgres.js";

const NOW = "2026-09-04T10:00:00.000Z";
const LATER = "2026-09-04T10:05:00.000Z";
const enabled = Boolean(process.env.TEST_DATABASE_URL);

async function fixture() {
  const context = await createTestStore();
  const project = await context.store.projects.register({ slug: "cleanup", name: "Cleanup", repositoryOwner: "dokor", repositoryName: "cleanup", adeAdapter: "github-work", priority: 50 });
  const profile = { projectId: project.id, repositoryGithubId: "123", compatible: true, reason: "compatible" as const, observedAt: NOW };
  const item = (issueNumber: number, overrides: Partial<GithubWorkItemInput> = {}): GithubWorkItemInput => ({ projectId: project.id, repositoryGithubId: "123", contractVersion: "ade.github-work/v1", issueNumber,
    issueUrl: `https://github.com/dokor/cleanup/issues/${issueNumber}`, state: "failed", priority: 50, dependsOn: [], retryPolicy: "reconcile-first",
    sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: LATER, ...overrides });
  const reconcile = (...items: GithubWorkItemInput[]) => context.store.githubWork.reconcile({ profile, items });
  const work = (await reconcile(item(1), item(2)))[0]!;
  const remove = (workId = work.id) => context.store.githubWork.remove({ projectId: project.id, issueNumber: 1, workId, actorRef: "operator:test", occurredAt: NOW });
  const schedule = (issueNumber = 1, expectedGithubWorkId?: string): ScheduleExecutionWithLeaseInput => ({
    ...(expectedGithubWorkId ? { expectedGithubWorkId } : {}),
    execution: { projectId: project.id, capability: "github-work.codex", workRef: `github:issue:${issueNumber}`, requestedAt: NOW },
    lease: { projectId: project.id, ownerId: "worker", leaseKey: `github-work:${project.id}:${issueNumber}`, acquiredAt: NOW, heartbeatAt: NOW, expiresAt: LATER },
  });
  return { ...context, project, item, reconcile, work, remove, schedule };
}

test("terminal cleanup cascades only correlated records, survives reconciliation/restart, and permits explicit readmission", { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    const scheduled = await c.store.executions.scheduleWithLease(c.schedule()); assert.ok(scheduled);
    const other = await c.store.executions.scheduleWithLease(c.schedule(2)); assert.ok(other);
    const workflow = await c.store.deliveryWorkflows!.start({ projectId: c.project.id, issueNumber: 1, executionId: scheduled.execution.id, sourceUpdatedAt: NOW, occurredAt: NOW });
    await c.store.deliveryWorkflows!.transition({ workflowId: workflow.id, stage: "waiting-human", attempt: 0, reason: "Decision", idempotencyKey: "decision", occurredAt: NOW, humanDecisionRef: "decision:1" });
    await c.store.adeDecisions.upsert({ projectId: c.project.id, decisionRef: "decision:1", prompt: "Continue?", options: ["yes"], observedAt: NOW });
    await c.store.adeDecisions.upsert({ projectId: c.project.id, decisionRef: "unrelated", prompt: "Keep?", options: ["yes"], observedAt: NOW });
    await c.reconcile(c.item(1, { executionRef: scheduled.execution.id, humanDecisionRef: "decision:1" }), c.item(2));
    await c.store.executions.complete({ executionId: scheduled.execution.id, status: "failed", finishedAt: LATER, releaseReason: "test", auditEvent: { occurredAt: LATER, category: "execution", action: "test.failed", severity: "info", actorType: "system", projectId: c.project.id } });
    const task = await c.store.v0Tasks.create({ projectId: c.project.id, prompt: "Legacy task", source: { type: "github-issue", issueNumber: 1 }, createdAt: NOW });
    await c.store.v0Tasks.claimPending(NOW);
    await c.store.v0Tasks.complete({ taskId: task.id, status: "FAILED", finishedAt: LATER });
    assert.equal(await c.remove(), "removed");
    assert.equal(await c.remove(), "already-removed");
    assert.equal(await c.store.executions.getById(scheduled.execution.id), null);
    assert.ok(await c.store.executions.getById(other.execution.id));
    assert.equal(await c.store.deliveryWorkflows!.getByExecutionId(scheduled.execution.id), null);
    assert.equal(await c.store.v0Tasks.getById(task.id), null);
    assert.equal(await c.store.adeDecisions.getByRef(c.project.id, "decision:1"), null);
    assert.ok(await c.store.adeDecisions.getByRef(c.project.id, "unrelated"));
    const audits = await c.store.auditEvents.listForProject(c.project.id, 100);
    assert.equal(audits.filter((entry) => entry.action === "github-work.removed").length, 1);
    assert.ok(audits.some((entry) => entry.action === "test.failed" && entry.executionId === null));
    assert.deepEqual((await c.reconcile(c.item(1), c.item(2))).map((entry) => entry.issueNumber), [2]);
    const reopened = c.reopenStore();
    try { assert.equal(await reopened.githubWork.getRemoval(c.project.id, 1), NOW); } finally { await reopened.close(); }
    assert.equal(await c.store.executions.scheduleWithLease(c.schedule()), null);
    assert.equal(await c.store.githubWork.readmit({ projectId: c.project.id, issueNumber: 1, removedAt: LATER, actorRef: "operator:test", occurredAt: LATER }), false);
    assert.equal(await c.store.githubWork.readmit({ projectId: c.project.id, issueNumber: 1, removedAt: NOW, actorRef: "operator:test", occurredAt: LATER }), true);
    const restored = (await c.reconcile(c.item(1, { state: "ready" }), c.item(2))).find((entry) => entry.issueNumber === 1)!;
    assert.notEqual(restored.id, c.work.id);
    assert.equal(await c.remove(c.work.id), "ambiguous");
    assert.equal(await c.store.executions.scheduleWithLease(c.schedule(1, c.work.id)), null);
    assert.ok(await c.store.executions.scheduleWithLease(c.schedule(1, restored.id)));
  } finally { await c.close(); }
});

for (const status of ["leased", "running", "unknown"] as const) test(`rejects ${status} execution even with stale evidence`, { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    const scheduled = await c.store.executions.scheduleWithLease(c.schedule()); assert.ok(scheduled);
    if (status === "running") await c.store.executions.markRunning(scheduled.execution.id, NOW);
    if (status === "unknown") await c.store.executions.complete({ executionId: scheduled.execution.id, status: "unknown", finishedAt: LATER, releaseReason: "timeout" });
    assert.equal(await c.remove(), "active");
    assert.ok(await c.store.executions.getById(scheduled.execution.id));
    assert.equal(await c.store.githubWork.getRemoval(c.project.id, 1), null);
  } finally { await c.close(); }
});

test("rejects active legacy tasks and permits cleanup after confirmed cancellation", { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    const task = await c.store.v0Tasks.create({ projectId: c.project.id, prompt: "legacy", source: { type: "github-issue", issueNumber: 1 }, createdAt: NOW });
    assert.equal(await c.remove(), "active");
    await c.store.v0Tasks.claimPending(NOW);
    await c.store.v0Tasks.complete({ taskId: task.id, status: "CANCELLED", finishedAt: LATER });
    assert.equal(await c.remove(), "removed");
    await assert.rejects(c.store.v0Tasks.create({ projectId: c.project.id, prompt: "stale", source: { type: "github-issue", issueNumber: 1 }, createdAt: LATER }));
  } finally { await c.close(); }
});

test("rejects shared decisions, unrelated execution refs and conflicting workflow correlation", { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    await c.reconcile(c.item(1, { humanDecisionRef: "shared" }), c.item(2, { humanDecisionRef: "shared" }));
    assert.equal(await c.remove(), "ambiguous");
    const other = await c.store.executions.scheduleWithLease(c.schedule(2)); assert.ok(other);
    await c.reconcile(c.item(1, { executionRef: other.execution.id }), c.item(2));
    assert.equal(await c.remove(), "ambiguous");
    assert.ok(await c.store.executions.getById(other.execution.id));
    await c.reconcile(c.item(1), c.item(2));
    await c.store.deliveryWorkflows!.start({ projectId: c.project.id, issueNumber: 1, executionId: other.execution.id, sourceUpdatedAt: NOW, occurredAt: NOW });
    assert.equal(await c.remove(), "ambiguous");
    assert.equal((await c.store.githubWork.listForProject(c.project.id)).length, 2);
  } finally { await c.close(); }
});

test("removal and lease creation are serialized without leaving an untracked execution", { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    const [removed, scheduled] = await Promise.all([c.remove(), c.store.executions.scheduleWithLease(c.schedule(1, c.work.id))]);
    if (removed === "removed") { assert.equal(scheduled, null); assert.equal((await c.store.executions.listActive()).length, 0); }
    else { assert.equal(removed, "active"); assert.ok(scheduled); assert.ok(await c.store.executions.getById(scheduled.execution.id)); }
  } finally { await c.close(); }
});

test("cleanup rolls back if its mandatory audit record cannot be inserted", { skip: !enabled }, async () => {
  const c = await fixture();
  try {
    await c.adminPool.query(`CREATE FUNCTION ${c.schemaName}.reject_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'github-work.removed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`);
    await c.adminPool.query(`CREATE TRIGGER reject_cleanup BEFORE INSERT ON ${c.schemaName}.audit_events FOR EACH ROW EXECUTE FUNCTION ${c.schemaName}.reject_cleanup_audit()`);
    await assert.rejects(c.remove(), /audit unavailable/);
    assert.equal(await c.store.githubWork.getRemoval(c.project.id, 1), null);
    assert.equal((await c.store.githubWork.listForProject(c.project.id)).length, 2);
  } finally { await c.close(); }
});

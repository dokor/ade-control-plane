import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEventInput, AuditEventRecord, GithubWorkItemRecord, ProjectRecord } from "@ade-control-plane/database";
import { DeterministicFakeGithubClient } from "@ade-control-plane/github";

import { GithubWorkNotifier } from "../src/GithubWorkNotifier.js";

const project: ProjectRecord = {
  id: "p1", slug: "argos", name: "Argos", repositoryOwner: "dokor", repositoryName: "argos",
  repositoryId: "1", state: "enabled", priority: 80, adeAdapter: "github-work", runnerPolicy: {}, configuration: {},
  createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z",
};
const work: GithubWorkItemRecord = {
  id: "w1", projectId: "p1", repositoryGithubId: "1", contractVersion: "ade.github-work/v1",
  issueNumber: 42, issueUrl: "https://github.com/dokor/argos/issues/42", state: "waiting-human", priority: 80,
  dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: "D42", executionRef: null,
  branchName: null, pullRequestNumber: null, sourceUpdatedAt: "2026-08-28T10:00:00.000Z",
  observedAt: "2026-08-28T10:00:00.000Z", expiresAt: "2026-08-28T10:05:00.000Z", present: true,
};

test("updates one safe waiting-human comment rather than creating notification spam", async () => {
  const client = new DeterministicFakeGithubClient();
  const comments = new Map<string, string>();
  const audits: string[] = [];
  const notifier = new GithubWorkNotifier({
    client, dashboardUrl: "https://ade.example.com/",
    persistence: {
      githubBotComments: {
        find: async (projectId, purpose, type, number) => {
          const commentId = comments.get(`${projectId}:${purpose}:${type}:${number}`);
          return commentId ? { projectId, purpose, subjectType: type, subjectNumber: number, commentId, updatedAt: work.observedAt } : null;
        },
        remember: async (record) => {
          comments.set(`${record.projectId}:${record.purpose}:${record.subjectType}:${record.subjectNumber}`, record.commentId);
          return record;
        },
      },
      auditEvents: { append: async (event) => { audits.push(event.result ?? ""); return auditRecord(event); } },
    },
    now: () => new Date(work.observedAt),
  });

  await notifier.waitingHuman(project, work);
  await notifier.waitingHuman(project, work);

  assert.equal(client.created.length, 1);
  assert.equal(client.updated.length, 1);
  assert.match(client.created[0]?.body ?? "", /Dashboard/);
  assert.doesNotMatch(client.created[0]?.body ?? "", /@ade decide/);
  assert.deepEqual(audits, ["created", "updated"]);
});

test("failure notifications expose only a fixed safe error code", async () => {
  const client = new DeterministicFakeGithubClient();
  const notifier = new GithubWorkNotifier({
    client, dashboardUrl: "https://ade.example.com",
    persistence: {
      githubBotComments: { find: async () => null, remember: async (record) => record },
      auditEvents: { append: async (event) => auditRecord(event) },
    },
  });
  await notifier.failure(project, work, "token=ghp_secret /run/secrets/key");
  const body = client.created[0]?.body ?? "";
  assert.match(body, /EXECUTION_FAILED/);
  assert.doesNotMatch(body, /ghp_|\/run\/secrets/);
});

function auditRecord(event: AuditEventInput): AuditEventRecord {
  return {
    id: "a", occurredAt: event.occurredAt, category: event.category, severity: event.severity,
    actorType: event.actorType, actorRef: event.actorRef ?? null, projectId: event.projectId ?? null,
    executionId: event.executionId ?? null, runnerId: event.runnerId ?? null, action: event.action,
    reason: event.reason ?? null, result: event.result ?? null, correlationId: event.correlationId ?? null,
    metadata: event.metadata ?? {},
  };
}

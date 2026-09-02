import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { DeterministicFakeGithubClient, readGithubWorkMetadata, upsertGithubWorkMetadata, type GithubWorkReader } from "@ade-control-plane/github";

import { handleGithubDelivery } from "../src/lib/githubWebhook.js";
import {
  createMemoryPersistence,
  createMemoryState,
  type MemoryState,
} from "./helpers/memoryPersistence.js";
import { execution, NOW, project, quotaSnapshot, runner, snapshot } from "./helpers/fixtures.js";

const SECRET = "webhook-secret";
const REPOSITORY_ID = "1347812108";
const ACTOR_ID = "11472726";

function baseState(overrides: Partial<MemoryState> = {}): MemoryState {
  return createMemoryState({
    projects: [project({ repositoryId: REPOSITORY_ID })],
    snapshots: [snapshot()],
    runners: [runner()],
    quotaSnapshots: [quotaSnapshot()],
    ...overrides,
  });
}

function payload(body: string, overrides: Record<string, unknown> = {}) {
  return {
    action: "created",
    repository: { id: Number(REPOSITORY_ID), name: "argos", owner: { login: "dokor" } },
    sender: { id: Number(ACTOR_ID), login: "dokor", type: "User" },
    issue: { number: 42 },
    comment: { id: 900, body },
    installation: { id: 555 },
    ...overrides,
  };
}

function delivery(
  state: MemoryState,
  commentBody: string,
  options: {
    deliveryId?: string;
    secret?: string;
    signature?: string;
    payloadOverrides?: Record<string, unknown>;
    client?: DeterministicFakeGithubClient;
    allowedActorIds?: readonly string[];
  } = {},
) {
  const raw = Buffer.from(JSON.stringify(payload(commentBody, options.payloadOverrides)));
  const signature =
    options.signature ??
    `sha256=${createHmac("sha256", options.secret ?? SECRET).update(raw).digest("hex")}`;
  const headers = new Headers({
    "x-github-delivery": options.deliveryId ?? "delivery-1",
    "x-github-event": "issue_comment",
    "x-hub-signature-256": signature,
  });

  return handleGithubDelivery(
    {
      persistence: createMemoryPersistence(state),
      webhookSecret: SECRET,
      policy: { allowedActorIds: options.allowedActorIds ?? [ACTOR_ID] },
      dashboardUrl: "https://ade.example.com",
      quotaProvider: "openai",
      quotaAccountRef: "codex-account-main",
      client: options.client,
      now: NOW,
      correlationId: "corr-1",
    },
    raw,
    headers,
  );
}

test("rejects an invalid signature before any processing", async () => {
  const state = baseState();
  const outcome = await delivery(state, "@ade pause", { secret: "wrong-secret" });

  assert.deepEqual(outcome, { status: "rejected", code: "INVALID_SIGNATURE", httpStatus: 400 });
  // Nothing was persisted: an unsigned flood cannot grow any table.
  assert.equal(state.deliveries.length, 0);
  assert.equal(state.commands.length, 0);
  assert.equal(state.projects[0]?.state, "enabled");
});

test("a duplicate delivery id produces no second effect", async () => {
  const state = baseState();
  await delivery(state, "@ade pause");
  assert.equal(state.commands.length, 1);
  assert.equal(state.projects[0]?.state, "paused");

  const replay = await delivery(state, "@ade pause");
  assert.equal(replay.status, "duplicate");
  assert.equal(state.commands.length, 1);
  assert.equal(state.deliveries.length, 1);
});

test("a verified issues delivery refreshes normalized work once and never dispatches", async () => {
  const state = baseState();
  const raw = Buffer.from(JSON.stringify(payload("", { action: "edited" })));
  const headers = new Headers({
    "x-github-delivery": "issues-refresh-1",
    "x-github-event": "issues",
    "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`,
  });
  const reader: GithubWorkReader = {
    detectRepository: async (repository) => ({ repository, compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [".agents/skills"], observedAt: NOW, reason: "compatible" }),
    listWorkItems: async (repository) => [{
      repository, contractVersion: "ade.github-work/v1", issueNumber: 42,
      issueUrl: "https://github.com/dokor/argos/issues/42", state: "ready", priority: 80,
      dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null,
      executionRef: null, branchName: null, pullRequestNumber: null,
      sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z",
    }],
    getWorkItem: async () => null,
  };
  const dependencies = {
    persistence: createMemoryPersistence(state), webhookSecret: SECRET,
    policy: { allowedActorIds: [ACTOR_ID] }, dashboardUrl: "https://ade.example.com",
    quotaProvider: "openai", quotaAccountRef: "codex-account-main", workReader: reader,
    now: NOW, correlationId: "corr-issues",
  };

  const first = await handleGithubDelivery(dependencies, raw, headers);
  const second = await handleGithubDelivery(dependencies, raw, headers);
  assert.deepEqual(first, { status: "processed", commandId: null, summary: "GitHub work refreshed.", projectId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(second.status, "duplicate");
  assert.equal(state.githubWorkItems.length, 1);
  assert.equal(state.commands.length, 0);
});

test("an unregistered repository is ignored without mutation", async () => {
  const state = baseState({ projects: [project({ repositoryId: "999" })] });
  const outcome = await delivery(state, "@ade pause");

  assert.deepEqual(outcome, { status: "ignored", code: "UNKNOWN_REPOSITORY" });
  assert.equal(state.commands.length, 0);
  assert.equal(state.deliveries[0]?.status, "ignored");
});

test("an unauthorized actor is refused, audited and never answered", async () => {
  const state = baseState();
  const client = new DeterministicFakeGithubClient();
  const outcome = await delivery(state, "@ade pause", {
    allowedActorIds: ["1"],
    client,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(state.commands.length, 0);
  assert.equal(state.projects[0]?.state, "enabled");
  assert.equal(state.deliveries[0]?.status, "rejected");
  assert.equal(state.auditEvents[0]?.category, "security");
  assert.equal(state.auditEvents[0]?.result, "denied");
  // Silence: the control plane does not confirm to a stranger that it manages this repo.
  assert.equal(client.created.length, 0);
});

test("status answers an authorized actor without creating a command", async () => {
  const state = baseState();
  const client = new DeterministicFakeGithubClient();
  const outcome = await delivery(state, "@ade status", { client });

  assert.equal(outcome.status, "processed");
  assert.equal(state.commands.length, 0);
  assert.equal(client.created.length, 1);
  assert.match(client.created[0]?.body ?? "", /Argos/);
  assert.match(client.created[0]?.body ?? "", /Dashboard/);
});

test("pause, resume and priority create durable audited ControlCommands", async () => {
  const state = baseState();
  await delivery(state, "@ade pause", { deliveryId: "d-1" });
  assert.equal(state.projects[0]?.state, "paused");

  await delivery(state, "@ade resume", {
    deliveryId: "d-2",
    payloadOverrides: { comment: { id: 901, body: "@ade resume" } },
  });
  assert.equal(state.projects[0]?.state, "enabled");

  await delivery(state, "@ade priority 30", {
    deliveryId: "d-3",
    payloadOverrides: { comment: { id: 902, body: "@ade priority 30" } },
  });
  assert.equal(state.projects[0]?.priority, 30);

  assert.equal(state.commands.length, 3);
  assert.ok(state.commands.every(({ source }) => source === "github"));
  assert.ok(state.commands.every(({ status }) => status === "applied"));
  assert.ok(state.commands.every(({ actorRef }) => actorRef === `dokor#${ACTOR_ID}`));
  assert.ok(state.auditEvents.some(({ action }) => action === "command.applied"));
});

test("retry is refused when the last execution is reconcile-first", async () => {
  const state = baseState({ executions: [execution({ status: "unknown", errorCode: null })] });
  state.projects = [project({ repositoryId: REPOSITORY_ID })];
  const client = new DeterministicFakeGithubClient();

  const outcome = await delivery(state, "@ade retry", { client });
  assert.deepEqual(outcome, { status: "rejected", code: "RETRY_NOT_SAFE", httpStatus: 202 });
  assert.equal(state.commands[0]?.status, "rejected");
  assert.equal(state.executions[0]?.status, "unknown");
  // The authorized operator is told why, in plain language, with no internals.
  assert.match(client.created[0]?.body ?? "", /reconcile/i);
  assert.doesNotMatch(client.created[0]?.body ?? "", /Error|stack/);
});

test("retry is accepted when the failure is classified safe", async () => {
  const state = baseState({
    executions: [execution({ status: "failed", errorCode: "RUNNER_UNAVAILABLE" })],
  });
  state.projects = [project({ repositoryId: REPOSITORY_ID })];

  const outcome = await delivery(state, "@ade retry");
  assert.equal(outcome.status, "processed");
  assert.equal(state.commands[0]?.status, "applied");
  // Intent only: the webhook never dispatches runner work.
  assert.equal(state.executions[0]?.status, "failed");
});

test("decide resolves only a decision ADE actually exposed", async () => {
  const state = baseState();
  state.decisions = [
    {
      id: "decision-1",
      projectId: project().id,
      decisionRef: "D42",
      prompt: "Which migration strategy?",
      options: ["option-a", "option-b"],
      status: "open",
      resolvedOption: null,
      resolvedBy: null,
      observedAt: NOW,
      resolvedAt: null,
    },
  ];

  const unknown = await delivery(state, "@ade decide D99 option-a", {
    deliveryId: "d-unknown",
  });
  assert.deepEqual(unknown, { status: "rejected", code: "NOT_FOUND", httpStatus: 202 });

  const badOption = await delivery(state, "@ade decide D42 option-z", {
    deliveryId: "d-bad-option",
    payloadOverrides: { comment: { id: 903, body: "@ade decide D42 option-z" } },
  });
  assert.deepEqual(badOption, {
    status: "rejected",
    code: "INVALID_COMMAND",
    httpStatus: 202,
  });
  assert.equal(state.decisions[0]?.status, "open");

  const outcome = await delivery(state, "@ade decide D42 option-a", {
    deliveryId: "d-good",
    payloadOverrides: { comment: { id: 904, body: "@ade decide D42 option-a" } },
  });
  assert.equal(outcome.status, "processed");
  assert.equal(state.decisions[0]?.status, "resolved");
  assert.equal(state.decisions[0]?.resolvedOption, "option-a");
  assert.equal(state.decisions[0]?.resolvedBy, `dokor#${ACTOR_ID}`);
});

test("the same directive replayed under a new delivery id stays idempotent", async () => {
  const state = baseState();
  await delivery(state, "@ade priority 70", { deliveryId: "d-1" });
  await delivery(state, "@ade priority 70", { deliveryId: "d-2" });

  // Same comment identity plus command: one control command, applied once.
  assert.equal(state.commands.length, 1);
  assert.equal(state.projects[0]?.priority, 70);
});

test("ordinary discussion is ignored and never answered", async () => {
  const state = baseState();
  const client = new DeterministicFakeGithubClient();
  const outcome = await delivery(state, "Nice work, let's ship it.", { client });

  assert.deepEqual(outcome, { status: "ignored", code: "NO_COMMAND" });
  assert.equal(client.created.length, 0);
  assert.equal(state.commands.length, 0);
});

test("the bot updates its own comment instead of appending replies", async () => {
  const state = baseState();
  const client = new DeterministicFakeGithubClient();
  await delivery(state, "@ade status", { deliveryId: "d-1", client });
  await delivery(state, "@ade status", {
    deliveryId: "d-2",
    payloadOverrides: { comment: { id: 905, body: "@ade status" } },
    client,
  });

  assert.equal(client.created.length, 1);
  assert.equal(client.updated.length, 1);
});

test("an unknown verb is rejected without touching control-plane state", async () => {
  const state = baseState();
  const outcome = await delivery(state, "@ade exec rm -rf /");

  assert.equal(outcome.status, "rejected");
  assert.equal(state.commands.length, 0);
  assert.equal(state.projects[0]?.state, "enabled");
  assert.equal(state.deliveries[0]?.rejectionCode, "UNKNOWN_COMMAND");
});

test("a merged correlated pull request completes work and refreshes its dependencies", async () => {
  const state = baseState();
  const client = new DeterministicFakeGithubClient();
  client.issues.set(42, {
    number: 42, title: "Delivery", state: "open", url: "https://github.com/dokor/argos/issues/42", updatedAt: NOW,
    labels: ["waiting-human", "pr-ready"],
    body: upsertGithubWorkMetadata("Delivery", {
      state: "waiting-human", priority: 80, dependsOn: [], retryPolicy: "reconcile-first",
      humanDecisionRef: null, executionRef: "execution-1", branchName: "ade/issue-42", pullRequestNumber: 91,
    }),
  });
  state.githubWorkItems.push({
    id: "work-42", projectId: project().id, repositoryGithubId: REPOSITORY_ID, contractVersion: "ade.github-work/v1",
    issueNumber: 42, issueUrl: "https://github.com/dokor/argos/issues/42", state: "waiting-human", priority: 80,
    dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: "execution-1",
    branchName: "ade/issue-42", pullRequestNumber: 91, sourceUpdatedAt: NOW, observedAt: NOW,
    expiresAt: "2026-08-27T10:05:00.000Z", present: true,
  });
  const reader: GithubWorkReader = {
    detectRepository: async (repository) => ({ repository, compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [], observedAt: NOW, reason: "compatible" }),
    listWorkItems: async (repository) => {
      const current = client.issues.get(42)!;
      const metadata = readGithubWorkMetadata(current.body)!;
      return [{ repository, contractVersion: "ade.github-work/v1", issueNumber: 42, issueUrl: "https://github.com/dokor/argos/issues/42", state: metadata.state, priority: metadata.priority, dependsOn: metadata.dependsOn, retryPolicy: metadata.retryPolicy, humanDecisionRef: metadata.humanDecisionRef, executionRef: metadata.executionRef, branchName: metadata.branchName, pullRequestNumber: metadata.pullRequestNumber, sourceUpdatedAt: current.updatedAt, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z" }];
    },
    getWorkItem: async () => null,
  };
  const raw = Buffer.from(JSON.stringify({
    action: "closed", number: 91,
    repository: { id: Number(REPOSITORY_ID), name: "argos", owner: { login: "dokor" } },
    sender: { id: Number(ACTOR_ID), login: "dokor", type: "User" }, installation: { id: 555 },
    pull_request: { merged: true, head: { ref: "ade/issue-42", sha: "0123456789abcdef0123456789abcdef01234567" } },
  }));
  const headers = new Headers({
    "x-github-delivery": "pr-merged-1", "x-github-event": "pull_request",
    "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`,
  });
  const dependencies = { persistence: createMemoryPersistence(state), webhookSecret: SECRET, policy: { allowedActorIds: [ACTOR_ID] }, dashboardUrl: "https://ade.example.com", quotaProvider: "openai", quotaAccountRef: "codex-account-main", client, workReader: reader, now: NOW, correlationId: "corr-pr" };

  const outcome = await handleGithubDelivery(dependencies, raw, headers);
  assert.equal(outcome.status, "processed");
  assert.equal(readGithubWorkMetadata(client.issues.get(42)!.body)?.state, "completed");
  assert.deepEqual(client.issues.get(42)?.labels, ["backlog-refined"]);
  assert.equal(state.githubWorkItems[0]?.state, "completed");
});

test("a closed-unmerged or mismatched pull request is durably blocked", async () => {
  for (const [action, merged, headRef] of [["closed", false, "ade/issue-42"], ["synchronize", false, "unexpected-branch"]] as const) {
    const state = baseState();
    const client = new DeterministicFakeGithubClient();
    client.issues.set(42, {
      number: 42, title: "Delivery", state: "open", url: "https://github.com/dokor/argos/issues/42", updatedAt: NOW, labels: ["waiting-human", "pr-ready"],
      body: upsertGithubWorkMetadata("Delivery", { state: "waiting-human", priority: 80, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: "execution-1", branchName: "ade/issue-42", pullRequestNumber: 91 }),
    });
    state.githubWorkItems.push({
      id: "work-42", projectId: project().id, repositoryGithubId: REPOSITORY_ID, contractVersion: "ade.github-work/v1", issueNumber: 42, issueUrl: "https://github.com/dokor/argos/issues/42", state: "waiting-human", priority: 80, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: "execution-1", branchName: "ade/issue-42", pullRequestNumber: 91, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z", present: true,
    });
    const reader: GithubWorkReader = {
      detectRepository: async (repository) => ({ repository, compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [], observedAt: NOW, reason: "compatible" }),
      listWorkItems: async (repository) => {
        const current = client.issues.get(42)!;
        const metadata = readGithubWorkMetadata(current.body)!;
        return [{ repository, contractVersion: "ade.github-work/v1", issueNumber: 42, issueUrl: "https://github.com/dokor/argos/issues/42", state: metadata.state, priority: metadata.priority, dependsOn: metadata.dependsOn, retryPolicy: metadata.retryPolicy, humanDecisionRef: metadata.humanDecisionRef, executionRef: metadata.executionRef, branchName: metadata.branchName, pullRequestNumber: metadata.pullRequestNumber, sourceUpdatedAt: current.updatedAt, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z" }];
      }, getWorkItem: async () => null,
    };
    const raw = Buffer.from(JSON.stringify({ action, number: 91, repository: { id: Number(REPOSITORY_ID), name: "argos", owner: { login: "dokor" } }, sender: { id: Number(ACTOR_ID), login: "dokor", type: "User" }, installation: { id: 555 }, pull_request: { merged, head: { ref: headRef, sha: "0123456789abcdef0123456789abcdef01234567" } } }));
    const headers = new Headers({ "x-github-delivery": `pr-blocked-${action}-${headRef}`, "x-github-event": "pull_request", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` });
    const outcome = await handleGithubDelivery({ persistence: createMemoryPersistence(state), webhookSecret: SECRET, policy: { allowedActorIds: [ACTOR_ID] }, dashboardUrl: "https://ade.example.com", quotaProvider: "openai", quotaAccountRef: "codex-account-main", client, workReader: reader, now: NOW, correlationId: "corr-pr-blocked" }, raw, headers);
    assert.equal(outcome.status, "processed");
    assert.equal(readGithubWorkMetadata(client.issues.get(42)!.body)?.state, "blocked");
    assert.deepEqual(client.issues.get(42)?.labels, ["blocked"]);
    assert.equal(state.githubWorkItems[0]?.state, "blocked");
  }
});

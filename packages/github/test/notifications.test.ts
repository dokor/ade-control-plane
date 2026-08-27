import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicFakeGithubClient } from "../src/client.js";
import {
  commentMarker,
  isControlPlaneComment,
  renderAcknowledgement,
  renderDecisionRequest,
  renderStatusComment,
  upsertBotComment,
  type BotCommentStore,
} from "../src/notifications.js";
import { escapeForComment, redactSensitive } from "../src/redact.js";

const repository = { id: "1", owner: "dokor", name: "argos" };
const subject = { type: "issue" as const, number: 42 };

function memoryStore(): BotCommentStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async find(projectId, purpose, ref) {
      return entries.get(`${projectId}:${purpose}:${ref.type}:${ref.number}`) ?? null;
    },
    async remember(projectId, purpose, ref, commentId) {
      entries.set(`${projectId}:${purpose}:${ref.type}:${ref.number}`, commentId);
    },
  };
}

test("creates one comment then updates it instead of piling up replies", async () => {
  const client = new DeterministicFakeGithubClient();
  const store = memoryStore();

  const first = await upsertBotComment(client, store, "p1", "status", repository, subject, "one");
  const second = await upsertBotComment(client, store, "p1", "status", repository, subject, "two");

  assert.equal(first.updated, false);
  assert.equal(second.updated, true);
  assert.equal(second.commentId, first.commentId);
  assert.equal(client.created.length, 1);
  assert.deepEqual(client.updated, [{ commentId: first.commentId, body: "two" }]);
});

test("marks its own comments so human content is never rewritten", () => {
  const body = renderStatusComment("p1", {
    projectName: "Argos",
    status: "waiting-human",
    priority: 80,
    waitingReason: null,
    currentWork: null,
    dashboardUrl: "https://ade.example.com/projects/p1",
    observedAt: "2026-08-27T10:00:00.000Z",
  });

  assert.ok(body.includes(commentMarker("status", "p1")));
  assert.equal(isControlPlaneComment(body, "p1"), true);
  assert.equal(isControlPlaneComment("Looks good to me", "p1"), false);
  // Global views are linked, not mirrored into GitHub.
  assert.match(body, /Dashboard/);
});

test("never leaks secrets or host paths into a comment", () => {
  const body = renderAcknowledgement("p1", {
    command: "@ade retry",
    outcome: "refused",
    summary:
      "runner died reading /run/secrets/runner_auth_secret with token ghp_abcdefghijklmnop",
    dashboardUrl: "https://ade.example.com",
  });

  assert.doesNotMatch(body, /ghp_/);
  assert.doesNotMatch(body, /run\/secrets/);
});

test("neutralizes untrusted text echoed back to GitHub", () => {
  const escaped = escapeForComment("@everyone see #1 `rm -rf /` <img src=x>");
  assert.doesNotMatch(escaped, /^@everyone/);
  assert.doesNotMatch(escaped, /[<>]/);
  assert.match(redactSensitive("PASSWORD=hunter2"), /redacted/);
});

test("offers only the options ADE exposed", () => {
  const body = renderDecisionRequest("p1", {
    projectName: "Argos",
    decisionRef: "D42",
    prompt: "Which migration strategy?",
    options: ["option-a", "option-b"],
    dashboardUrl: "https://ade.example.com",
  });

  assert.match(body, /@ade decide D42 option-a/);
  assert.match(body, /@ade decide D42 option-b/);
});

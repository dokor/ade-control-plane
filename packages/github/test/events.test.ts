import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEvent } from "../src/events.js";

function commentPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "created",
    repository: { id: 1347812108, name: "argos", owner: { login: "dokor" } },
    sender: { id: 11472726, login: "dokor", type: "User" },
    issue: { number: 42 },
    comment: { id: 900, body: "@ade status" },
    installation: { id: 555 },
    ...overrides,
  };
}

test("keeps only the fields needed for routing and authorization", () => {
  const event = normalizeEvent("delivery-1", "issue_comment", commentPayload());

  assert.deepEqual(event.repository, {
    id: "1347812108",
    owner: "dokor",
    name: "argos",
  });
  assert.deepEqual(event.actor, { id: "11472726", login: "dokor", bot: false });
  assert.deepEqual(event.subject, { type: "issue", number: 42 });
  assert.equal(event.comment?.body, "@ade status");
  assert.equal(event.installationId, "555");
  // Nothing else from the payload survives normalization.
  assert.deepEqual(Object.keys(event).sort(), [
    "action",
    "actor",
    "comment",
    "deliveryId",
    "event",
    "installationId",
    "pullRequest",
    "repository",
    "subject",
  ]);
});

test("keeps only bounded lifecycle fields from a pull request delivery", () => {
  const event = normalizeEvent("delivery-pr", "pull_request", {
    action: "closed",
    number: 91,
    repository: { id: 1347812108, name: "argos", owner: { login: "dokor" } },
    sender: { id: 11472726, login: "dokor", type: "User" },
    pull_request: { merged: true, head: { ref: "ade/issue-148", sha: "0123456789abcdef0123456789abcdef01234567" } },
  });

  assert.deepEqual(event.subject, { type: "pull_request", number: 91 });
  assert.deepEqual(event.pullRequest, {
    number: 91, merged: true, headRef: "ade/issue-148", headSha: "0123456789abcdef0123456789abcdef01234567",
  });
});

test("recognizes pull request comments and bot senders", () => {
  const onPullRequest = normalizeEvent(
    "delivery-2",
    "issue_comment",
    commentPayload({ issue: { number: 7, pull_request: { url: "https://api" } } }),
  );
  assert.deepEqual(onPullRequest.subject, { type: "pull_request", number: 7 });

  const fromBot = normalizeEvent(
    "delivery-3",
    "issue_comment",
    commentPayload({ sender: { id: 1, login: "ade[bot]", type: "Bot" } }),
  );
  assert.equal(fromBot.actor.bot, true);
});

test("refuses payloads missing identity fields", () => {
  assert.throws(
    () => normalizeEvent("d", "issue_comment", commentPayload({ repository: undefined })),
    /MALFORMED_PAYLOAD/,
  );
  assert.throws(
    () => normalizeEvent("d", "issue_comment", commentPayload({ sender: { login: "x" } })),
    /MALFORMED_PAYLOAD/,
  );
  assert.throws(() => normalizeEvent("d", "issue_comment", "not-an-object"), /MALFORMED_PAYLOAD/);
});

test("refuses a repository id that is not a plain identifier", () => {
  assert.throws(
    () =>
      normalizeEvent(
        "d",
        "issue_comment",
        commentPayload({
          repository: { id: "1; DROP TABLE projects", name: "argos", owner: { login: "dokor" } },
        }),
      ),
    /MALFORMED_PAYLOAD/,
  );
});

test("refuses an oversized comment body", () => {
  assert.throws(
    () =>
      normalizeEvent(
        "d",
        "issue_comment",
        commentPayload({ comment: { id: 1, body: "x".repeat(70_000) } }),
      ),
    /PAYLOAD_TOO_LARGE/,
  );
});

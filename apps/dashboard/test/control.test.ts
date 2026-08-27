import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeMutation,
  authorizeRead,
  isSensitiveCommand,
  validateCommand,
} from "../src/lib/control.js";

const operator = { actorRef: "dokor", canRead: true, canMutate: true };
const readOnly = { actorRef: "viewer", canRead: true, canMutate: false };

test("requires session and same-origin for mutations", () => {
  assert.throws(
    () => authorizeMutation(null, "https://cp", "https://cp", "global.pause"),
    /UNAUTHENTICATED/,
  );
  assert.throws(
    () => authorizeMutation(operator, "https://evil", "https://cp", "global.pause"),
    /CSRF_REJECTED/,
  );
  assert.throws(
    () => authorizeMutation(operator, null, "https://cp", "global.pause"),
    /CSRF_REJECTED/,
  );
});

test("separates read access from mutation rights", () => {
  assert.equal(authorizeRead(readOnly).actorRef, "viewer");
  assert.throws(() => authorizeRead(null), /UNAUTHENTICATED/);
  assert.throws(
    () => authorizeMutation(readOnly, "https://cp", "https://cp", "global.pause"),
    /FORBIDDEN/,
  );
});

test("accepts a same-origin mutation from an authorized operator", () => {
  assert.equal(
    authorizeMutation(operator, "https://cp", "https://cp/", "global.pause").actorRef,
    "dokor",
  );
});

test("rejects unknown command types", () => {
  assert.throws(
    () => authorizeMutation(operator, "https://cp", "https://cp", "runner.exec"),
    /UNKNOWN_COMMAND/,
  );
  assert.throws(() => validateCommand("runner.exec", {}), /UNKNOWN_COMMAND/);
});

test("refuses unsafe retries", () => {
  assert.throws(
    () => validateCommand("execution.safe-retry", { retryability: "reconcile-first" }),
    /RETRY_NOT_SAFE/,
  );
  assert.throws(
    () => validateCommand("execution.safe-retry", { retryability: "never" }),
    /RETRY_NOT_SAFE/,
  );
  assert.throws(
    () => validateCommand("execution.safe-retry", {}),
    /RETRY_NOT_SAFE/,
  );
});

test("validates identifiers and priority bounds", () => {
  assert.throws(() => validateCommand("project.pause", { projectId: "argos" }), /INVALID_COMMAND/);
  assert.throws(
    () =>
      validateCommand("project.reprioritize", {
        projectId: "11111111-1111-4111-8111-111111111111",
        priority: 500,
      }),
    /INVALID_COMMAND/,
  );
  assert.deepEqual(
    validateCommand("project.reprioritize", {
      projectId: "11111111-1111-4111-8111-111111111111",
      priority: 40,
    }),
    {
      type: "project.reprioritize",
      projectId: "11111111-1111-4111-8111-111111111111",
      priority: 40,
    },
  );
});

test("marks privileged actions as sensitive", () => {
  assert.equal(isSensitiveCommand("global.safe-mode"), true);
  assert.equal(isSensitiveCommand("runner.disable"), true);
  assert.equal(isSensitiveCommand("project.pause"), false);
});

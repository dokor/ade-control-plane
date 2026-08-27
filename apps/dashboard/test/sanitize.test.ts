import assert from "node:assert/strict";
import test from "node:test";

import { ControlError } from "../src/lib/errors.js";
import { sanitizeError, sanitizeText } from "../src/lib/sanitize.js";

test("redacts credentials, dsn and host paths", () => {
  const raw =
    "failed with ghp_abcdefghijklmnop and sk-abcdefghijklmnop DATABASE_URL=postgres://u:p@db/x at /run/secrets/runner_auth_secret";
  const sanitized = sanitizeText(raw);
  assert.doesNotMatch(sanitized, /ghp_/);
  assert.doesNotMatch(sanitized, /sk-abcdef/);
  assert.doesNotMatch(sanitized, /postgres:\/\//);
  assert.doesNotMatch(sanitized, /run\/secrets/);
});

test("collapses unexpected errors to INTERNAL without leaking the message", () => {
  const sanitized = sanitizeError(new Error("ENOENT /run/secrets/token"), "corr-1");
  assert.equal(sanitized.code, "INTERNAL");
  assert.equal(sanitized.correlationId, "corr-1");
  assert.doesNotMatch(sanitized.summary, /ENOENT/);
  assert.doesNotMatch(sanitized.summary, /secrets/);
});

test("keeps stable control error codes for the browser", () => {
  const sanitized = sanitizeError(
    new ControlError("RETRY_NOT_SAFE", "Retry is refused."),
    "corr-2",
  );
  assert.equal(sanitized.code, "RETRY_NOT_SAFE");
  assert.equal(sanitized.summary, "Retry is refused.");
});

test("truncates long summaries", () => {
  assert.ok(sanitizeText("x".repeat(1_000)).length <= 240);
});

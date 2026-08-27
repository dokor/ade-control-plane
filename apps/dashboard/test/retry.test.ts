import assert from "node:assert/strict";
import test from "node:test";

import { classifyRetryability } from "../src/lib/retry.js";
import { execution } from "./helpers/fixtures.js";

test("classifies infrastructure failures as safe", () => {
  assert.equal(
    classifyRetryability(execution({ status: "failed", errorCode: "RUNNER_UNAVAILABLE" })),
    "safe",
  );
});

test("keeps ambiguous and in-flight outcomes reconcile-first", () => {
  assert.equal(classifyRetryability(execution({ status: "unknown", errorCode: null })), "reconcile-first");
  assert.equal(classifyRetryability(execution({ status: "running" })), "reconcile-first");
  assert.equal(
    classifyRetryability(execution({ status: "failed", errorCode: "ADE_TASK_FAILED" })),
    "reconcile-first",
  );
  assert.equal(
    classifyRetryability(execution({ status: "failed", errorCode: null })),
    "reconcile-first",
  );
});

test("never retries succeeded or security-blocked executions", () => {
  assert.equal(classifyRetryability(execution({ status: "succeeded", errorCode: null })), "never");
  assert.equal(
    classifyRetryability(execution({ status: "failed", errorCode: "SECURITY_POLICY_VIOLATION" })),
    "never",
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceAdeDeliveryPipeline,
  createAdeDeliveryPipeline,
} from "../src/index.js";

test("keeps issue delivery gates ordered before PR readiness", () => {
  let state = createAdeDeliveryPipeline({ source: "github-issue", issueNumber: 23 });
  assert.equal(state.stage, "issue-enrichment");

  state = advanceAdeDeliveryPipeline(state, "issue-enriched");
  state = advanceAdeDeliveryPipeline(state, "ready-for-dev");
  state = advanceAdeDeliveryPipeline(state, "implementation-complete");
  assert.equal(state.stage, "deterministic-validation");
  state = advanceAdeDeliveryPipeline(state, "deterministic-validation-passed");
  state = advanceAdeDeliveryPipeline(state, "profile-reviews-passed");
  assert.equal(state.stage, "pr-ready");
});

test("bounds review corrections and blocks after the final attempt", () => {
  let state = createAdeDeliveryPipeline({ source: "github-issue", issueNumber: 23, maxReviewAttempts: 2 });
  state = advanceAdeDeliveryPipeline(state, "issue-enriched");
  state = advanceAdeDeliveryPipeline(state, "ready-for-dev");
  state = advanceAdeDeliveryPipeline(state, "implementation-complete");
  state = advanceAdeDeliveryPipeline(state, "deterministic-validation-passed");
  state = advanceAdeDeliveryPipeline(state, "correction-required");
  assert.equal(state.stage, "implementation");
  assert.equal(state.reviewAttempt, 1);
  state = advanceAdeDeliveryPipeline(state, "implementation-complete");
  state = advanceAdeDeliveryPipeline(state, "deterministic-validation-passed");
  state = advanceAdeDeliveryPipeline(state, "correction-required");
  assert.equal(state.stage, "implementation");
  state = advanceAdeDeliveryPipeline(state, "implementation-complete");
  state = advanceAdeDeliveryPipeline(state, "deterministic-validation-passed");
  state = advanceAdeDeliveryPipeline(state, "correction-required");
  assert.equal(state.stage, "blocked");
});

test("rejects issue pipelines without an issue reference", () => {
  assert.throws(() => createAdeDeliveryPipeline({ source: "github-issue" }), /issue delivery requires/i);
  assert.throws(() => createAdeDeliveryPipeline({ source: "prompt", maxReviewAttempts: 4 }), /between 1 and 3/i);
});

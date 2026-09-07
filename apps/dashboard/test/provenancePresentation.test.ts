import assert from "node:assert/strict";
import test from "node:test";

import { formatProvenanceKey } from "../src/lib/provenancePresentation.js";

test("formats ADE provenance keys as readable labels", () => {
  assert.equal(formatProvenanceKey("adeRulePackIds"), "ADE rule pack IDs");
  assert.equal(formatProvenanceKey("adeConfigStatus"), "ADE config status");
  assert.equal(formatProvenanceKey("adeContextStatus"), "ADE context status");
  assert.equal(formatProvenanceKey("adeProfileReview"), "ADE profile review");
  assert.equal(formatProvenanceKey("adeContextProfile"), "ADE context profile");
  assert.equal(formatProvenanceKey("adeRuntimeVersion"), "ADE runtime version");
  assert.equal(formatProvenanceKey("adeSelectedProfiles"), "ADE selected profiles");
  assert.equal(formatProvenanceKey("adeDeterministicReview"), "ADE deterministic review");
  assert.equal(formatProvenanceKey("adeSetupContractVersion"), "ADE setup contract version");
  assert.equal(formatProvenanceKey("adeProfileReviewAttempts"), "ADE profile review attempts");
  assert.equal(formatProvenanceKey("adeSelectedProfileReasons"), "ADE selected profile reasons");
});

test("keeps known acronyms readable and handles separators", () => {
  assert.equal(formatProvenanceKey("api_request_id"), "API request ID");
  assert.equal(formatProvenanceKey("headSha"), "head SHA");
});

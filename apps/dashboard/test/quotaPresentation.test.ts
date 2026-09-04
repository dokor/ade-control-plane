import assert from "node:assert/strict";
import test from "node:test";

import { quotaCapacityColor, quotaCapacityTone } from "../src/lib/quotaPresentation.js";

test("maps quota states to AI capacity tones", () => {
  assert.equal(quotaCapacityTone("normal"), "normal");
  assert.equal(quotaCapacityTone("throttled"), "warning");
  assert.equal(quotaCapacityTone("draining"), "warning");
  assert.equal(quotaCapacityTone("blocked"), "danger");
  assert.equal(quotaCapacityTone("unknown"), "unknown");
});

test("maps AI capacity tones to theme colors", () => {
  assert.equal(quotaCapacityColor("normal"), "var(--ok)");
  assert.equal(quotaCapacityColor("throttled"), "var(--warn)");
  assert.equal(quotaCapacityColor("draining"), "var(--warn)");
  assert.equal(quotaCapacityColor("blocked"), "var(--danger)");
  assert.equal(quotaCapacityColor("unknown"), "var(--muted)");
});

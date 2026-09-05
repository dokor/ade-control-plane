import assert from "node:assert/strict";
import test from "node:test";

import { presentQuotaCapacity, quotaCapacityColor, quotaCapacityTone } from "../src/lib/quotaPresentation.js";

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

test("presents a stale quota as last-known usage that requires refresh", () => {
  const presentation = presentQuotaCapacity({
    state: "unknown",
    usedPercent: 26,
    snapshotAgeMs: 11 * 60_000,
    refreshRequired: true,
    canStartWork: false,
    reason: "Provider quota snapshot is stale or invalid.",
    staleAfterMs: 5 * 60_000,
  });

  assert.equal(presentation.badgeStatus, "stale");
  assert.equal(presentation.badgeLabel, "Stale");
  assert.equal(presentation.usageLabel, "26% used · last known");
  assert.equal(presentation.schedulingMessage, "New work is paused until quota is refreshed.");
  assert.equal(presentation.detailMessage, "Last provider reading is 11 min old; freshness limit is 5 min.");
});

test("distinguishes an invalid quota timestamp from a stale reading", () => {
  const presentation = presentQuotaCapacity({
    state: "unknown",
    usedPercent: 26,
    snapshotAgeMs: null,
    refreshRequired: true,
    canStartWork: false,
    reason: "Provider quota snapshot is stale or invalid.",
    staleAfterMs: 5 * 60_000,
  });

  assert.equal(presentation.badgeStatus, "invalid");
  assert.equal(presentation.badgeLabel, "Invalid data");
  assert.match(presentation.detailMessage, /invalid timestamp/i);
});

test("keeps fresh quota presentation and scheduling decision unchanged", () => {
  const presentation = presentQuotaCapacity({
    state: "normal",
    usedPercent: 26,
    snapshotAgeMs: 60_000,
    refreshRequired: false,
    canStartWork: true,
    reason: "Provider quota allows normal scheduling.",
    staleAfterMs: 5 * 60_000,
  });

  assert.equal(presentation.badgeLabel, "Normal");
  assert.equal(presentation.usageLabel, "26% used");
  assert.equal(presentation.schedulingMessage, "Quota permits new work.");
});

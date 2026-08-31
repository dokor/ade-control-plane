import assert from "node:assert/strict";
import test from "node:test";

import { groupUsageByIssue, summarizeUsage } from "../src/lib/analytics.js";
import type { AgentUsageRecord } from "@ade-control-plane/database";

const base: AgentUsageRecord = {
  id: "usage-1", executionId: "execution-1", taskId: null, projectId: "project-1",
  githubIssueNumber: 182, githubPullRequestNumber: 191, provider: "claude-code",
  model: "claude-sonnet", startedAt: "2026-09-01T10:00:00.000Z", finishedAt: "2026-09-01T10:01:00.000Z",
  wallDurationMs: 60_000, providerDurationMs: 40_000, providerApiDurationMs: 35_000,
  turnCount: 2, inputTokens: 100, outputTokens: 50, totalTokens: 150,
  costAmount: 1.42, costCurrency: "USD", costKind: "provider_reported", usageSource: "claude-code-json",
  providerExecutionRef: "session-1", observedAt: "2026-09-01T10:01:00.000Z",
};

test("aggregates usage while preserving explicit cost provenance", () => {
  const { costAmount, costCurrency, ...withoutCost } = base;
  void costAmount;
  void costCurrency;
  const summary = summarizeUsage([base, { ...withoutCost, id: "usage-2", costKind: "unknown", usageSource: "unknown", finishedAt: null }]);
  assert.equal(summary.executions, 2);
  assert.equal(summary.totalTokens, 300);
  assert.equal(summary.wallDurationMs, 120_000);
  assert.deepEqual(summary.costs, { "provider_reported:USD": 1.42 });
});

test("groups retries under the same issue without losing attempt count", () => {
  const grouped = groupUsageByIssue([base, { ...base, id: "usage-2", wallDurationMs: 90_000, finishedAt: null }]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.attempts, 2);
  assert.equal(grouped[0]?.wallDurationMs, 150_000);
});
